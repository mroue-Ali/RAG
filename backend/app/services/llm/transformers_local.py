"""A Hugging Face causal LM running inside this process.

torch and transformers are optional (requirements-local.txt). Nothing here
imports them until a model is actually loaded, so the API starts without them
and stays light until then.
"""

import asyncio
import gc
import json
import logging
import threading
from collections.abc import AsyncIterator, Callable
from importlib import metadata
from pathlib import Path
from typing import Any

from ...schemas import ModelInfo, TransformersConfig
from .base import Chunk, GenerationParams, LLMError, LLMProvider, Message, Usage

log = logging.getLogger(__name__)

_INSTALL_HINT = "The local runtime is not installed. Run: pip install -r requirements-local.txt"


def runtime() -> str | None:
    """Installed torch/transformers versions, or None when the runtime is missing."""
    try:
        return f"torch {metadata.version('torch')}, transformers {metadata.version('transformers')}"
    except metadata.PackageNotFoundError:
        return None


class TransformersProvider(LLMProvider):
    kind = "transformers"

    def __init__(self, config: TransformersConfig) -> None:
        self.model = config.model
        self._config = config
        self._model: Any = None
        self._tokenizer: Any = None
        # One generation at a time: a second request waits rather than fighting for the GPU.
        self._generating = threading.Lock()

    async def load(self) -> dict[str, str]:
        if runtime() is None:
            raise LLMError(_INSTALL_HINT)
        return await asyncio.to_thread(self._load)

    async def unload(self) -> None:
        self._model = self._tokenizer = None
        await asyncio.to_thread(_free_memory)

    async def stream(self, messages: list[Message], params: GenerationParams) -> AsyncIterator[Chunk]:
        if self._model is None:
            raise LLMError("The model is no longer loaded.")
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[Chunk | Exception] = asyncio.Queue()
        cancelled = threading.Event()

        def emit(item: Chunk | Exception) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, item)

        threading.Thread(
            target=self._generate, args=(messages, params, emit, cancelled), daemon=True
        ).start()
        try:
            while True:
                item = await queue.get()
                if isinstance(item, Exception):
                    raise item
                yield item
                if item.finish_reason:
                    return
        finally:
            # Reached on normal completion and when the client goes away mid-answer.
            cancelled.set()

    # --- worker thread --------------------------------------------------------

    def _load(self) -> dict[str, str]:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        config = self._config
        has_cuda = torch.cuda.is_available()
        if config.device == "cuda" and not has_cuda:
            raise LLMError("CUDA was requested, but torch cannot see a GPU on this machine.")
        device = "cuda" if has_cuda and config.device != "cpu" else "cpu"
        if config.quantization != "none" and device != "cuda":
            raise LLMError("4-bit and 8-bit loading need a CUDA GPU.")

        kwargs: dict[str, Any] = {}
        try:
            dtype = _resolve_dtype(torch, config, device)
            if config.quantization != "none":
                kwargs["quantization_config"] = _quantization(config.quantization, dtype)
                kwargs["device_map"] = {"": 0}
            tokenizer = AutoTokenizer.from_pretrained(config.model)
            model = AutoModelForCausalLM.from_pretrained(config.model, torch_dtype=dtype, **kwargs)
            if "device_map" not in kwargs:
                model.to(device)
        except ImportError as exc:
            raise LLMError(f"A package needed for this configuration is missing: {exc}") from exc
        except (OSError, ValueError) as exc:
            # Unknown repo id, no network for a first download, or not a causal LM.
            raise LLMError(_first_line(exc)) from exc
        except torch.cuda.OutOfMemoryError as exc:
            raise LLMError(
                "The GPU ran out of memory loading this model. Try 4-bit quantization or a smaller model."
            ) from exc
        model.eval()
        self._model, self._tokenizer = model, tokenizer

        details = {
            "device": torch.cuda.get_device_name(0) if device == "cuda" else "CPU",
            "precision": config.quantization if config.quantization != "none" else str(dtype).removeprefix("torch."),
            "parameters": _humanize(model.num_parameters()),
        }
        if device == "cuda":
            details["GPU memory"] = f"{torch.cuda.memory_allocated() / 1024**3:.1f} GB"
        if not tokenizer.chat_template:
            details["note"] = "No chat template, so messages are sent as plain text."
        return details

    def _generate(
        self,
        messages: list[Message],
        params: GenerationParams,
        emit: Callable[[Chunk | Exception], None],
        cancelled: threading.Event,
    ) -> None:
        import torch
        from transformers import StoppingCriteria, StoppingCriteriaList, TextStreamer

        class Emitter(TextStreamer):
            def on_finalized_text(self, text: str, stream_end: bool = False) -> None:
                if text:
                    emit(Chunk(text=text))

        class StopWhenCancelled(StoppingCriteria):
            def __call__(self, input_ids: Any, scores: Any, **kwargs: Any) -> Any:
                return torch.full((input_ids.shape[0],), cancelled.is_set(), device=input_ids.device)

        try:
            with self._generating:
                model, tokenizer = self._model, self._tokenizer
                if cancelled.is_set():
                    return
                if model is None:
                    emit(LLMError("The model was unloaded before it could answer."))
                    return
                inputs = _encode(tokenizer, messages).to(model.device)
                sampling: dict[str, Any] = {"do_sample": False}
                if params.temperature > 0:
                    sampling = {"do_sample": True, "temperature": params.temperature, "top_p": params.top_p}
                pad = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id
                with torch.inference_mode():
                    output = model.generate(
                        **inputs,
                        max_new_tokens=params.max_tokens,
                        streamer=Emitter(tokenizer, skip_prompt=True, skip_special_tokens=True),
                        stopping_criteria=StoppingCriteriaList([StopWhenCancelled()]),
                        pad_token_id=pad,
                        **sampling,
                    )
            prompt_tokens = inputs["input_ids"].shape[-1]
            completion_tokens = output.shape[-1] - prompt_tokens
            emit(
                Chunk(
                    finish_reason="length" if completion_tokens >= params.max_tokens else "stop",
                    usage=Usage(prompt_tokens, completion_tokens),
                )
            )
        except torch.cuda.OutOfMemoryError:
            _free_memory()
            emit(LLMError("The GPU ran out of memory during generation. Lower the response length or history."))
        except Exception as exc:  # anything else must reach the request, not die in the thread
            log.exception("Generation failed")
            emit(LLMError(f"Generation failed: {_first_line(exc)}"))


# How deep to look below the models directory, e.g. publisher/model/ is two.
_SCAN_DEPTH = 3


def list_models(models_dir: str) -> list[ModelInfo]:
    """Chat models in the chosen directory, or in the Hugging Face cache when none is chosen."""
    if not models_dir.strip():
        return cached_models()
    root = Path(models_dir).expanduser()
    if not root.is_dir():
        raise LLMError(f"The models directory does not exist: {root}")
    # A folder in Hugging Face cache layout (models--org--name) is read as a cache.
    models = cached_models(root) if any(root.glob("models--*")) else []
    models += _folder_models(root, root, _SCAN_DEPTH)
    return sorted(models, key=lambda model: (model.name or model.id).lower())


def _folder_models(root: Path, folder: Path, depth: int) -> list[ModelInfo]:
    architecture = _causal_architecture(folder)
    if architecture:
        size = sum(item.stat().st_size for item in folder.iterdir() if item.is_file())
        name = folder.relative_to(root).as_posix() if folder != root else folder.name
        return [ModelInfo(id=str(folder), name=name, architecture=architecture, size_bytes=size)]
    if depth == 0:
        return []
    found = []
    for child in _subfolders(folder):
        if not child.name.startswith("models--"):
            found += _folder_models(root, child, depth - 1)
    return found


def pick_folder(start: str) -> str | None:
    """Open the system folder dialog on this machine. None when it is cancelled."""
    try:
        import tkinter
        from tkinter import filedialog
    except ImportError as exc:
        raise LLMError("This Python has no tkinter, so it cannot open a folder dialog.") from exc
    root = tkinter.Tk()
    root.withdraw()
    root.attributes("-topmost", True)  # otherwise it can open behind the browser
    try:
        chosen = filedialog.askdirectory(parent=root, initialdir=start or None, title="Choose the models directory")
    finally:
        root.destroy()
    return str(Path(chosen)) if chosen else None


def _subfolders(folder: Path) -> list[Path]:
    try:
        children = [child for child in folder.iterdir() if child.is_dir() and not child.name.startswith((".", "$"))]
    except OSError:
        return []
    return sorted(children, key=lambda child: child.name.lower())


def cached_models(cache_dir: Path | None = None) -> list[ModelInfo]:
    """Chat-capable models already in a Hugging Face cache on this machine."""
    try:
        from huggingface_hub import scan_cache_dir

        repos = scan_cache_dir(cache_dir).repos
    except Exception:  # hub not installed, or no cache directory yet
        return []

    models = []
    for repo in repos:
        if repo.repo_type != "model" or not repo.revisions:
            continue
        revision = max(repo.revisions, key=lambda revision: revision.last_modified)
        architecture = _causal_architecture(revision.snapshot_path)
        if architecture:
            # A cache other than the default is loaded by its snapshot folder, not the repo id.
            model_id, name = (str(revision.snapshot_path), repo.repo_id) if cache_dir else (repo.repo_id, None)
            models.append(ModelInfo(id=model_id, name=name, architecture=architecture, size_bytes=repo.size_on_disk))
    return sorted(models, key=lambda model: model.id.lower())


def _causal_architecture(snapshot: Path) -> str | None:
    """The model class if this snapshot is a complete text-generation model."""
    try:
        config = json.loads((snapshot / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    has_weights = any(snapshot.glob("*.safetensors")) or any(snapshot.glob("*.bin"))
    for name in config.get("architectures") or []:
        if name.endswith(("ForCausalLM", "LMHeadModel")) and has_weights:
            return name
    return None


def _resolve_dtype(torch: Any, config: TransformersConfig, device: str) -> Any:
    if config.dtype != "auto":
        return getattr(torch, config.dtype)
    if device == "cpu":
        return torch.float32
    # On GPU keep the half precision the checkpoint was saved in, and halve
    # float32 checkpoints: full precision rarely fits and buys nothing for chat.
    from transformers import AutoConfig

    model_config = AutoConfig.from_pretrained(config.model)
    declared = getattr(model_config, "torch_dtype", None) or getattr(model_config, "dtype", None)
    return declared if declared in (torch.float16, torch.bfloat16) else torch.float16


def _quantization(level: str, dtype: Any) -> Any:
    from transformers import BitsAndBytesConfig

    if level == "8bit":
        return BitsAndBytesConfig(load_in_8bit=True)
    return BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=dtype,
    )


def _encode(tokenizer: Any, messages: list[Message]) -> Any:
    if not tokenizer.chat_template:
        return tokenizer(_plain_prompt(messages), return_tensors="pt")
    options = {"add_generation_prompt": True, "return_tensors": "pt", "return_dict": True}
    try:
        return tokenizer.apply_chat_template(messages, **options)
    except Exception:
        # Some templates (older Gemma) refuse a system role. Fold it into the first user turn.
        return tokenizer.apply_chat_template(_fold_system(messages), **options)


def _fold_system(messages: list[Message]) -> list[Message]:
    system = "\n\n".join(message["content"] for message in messages if message["role"] == "system")
    rest = [dict(message) for message in messages if message["role"] != "system"]
    if system and rest and rest[0]["role"] == "user":
        rest[0]["content"] = f"{system}\n\n{rest[0]['content']}"
    return rest


def _plain_prompt(messages: list[Message]) -> str:
    labels = {"system": "System", "user": "User", "assistant": "Assistant"}
    turns = [f"{labels[message['role']]}: {message['content']}" for message in messages]
    return "\n\n".join(turns) + "\n\nAssistant:"


def _free_memory() -> None:
    gc.collect()
    try:
        import torch
    except ImportError:
        return
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _humanize(count: int) -> str:
    for size, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if count >= size:
            return f"{count / size:.1f}{suffix}"
    return str(count)


def _first_line(exc: Exception) -> str:
    lines = [line.strip() for line in str(exc).splitlines() if line.strip()]
    return lines[0] if lines else type(exc).__name__
