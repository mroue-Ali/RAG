"""LM Studio: chat goes through its OpenAI-compatible API, model management
through its native REST API (/api/v1), which can list, load and unload."""

import httpx2

from ...schemas import ModelInfo
from . import openai_compat
from .base import LLMError
from .openai_compat import OpenAICompatProvider

# Loading reads gigabytes off disk; a slow drive should not look like a failure.
_LOAD_TIMEOUT = httpx2.Timeout(900, connect=5)


class LMStudioProvider(OpenAICompatProvider):
    kind = "lmstudio"

    async def load(self) -> dict[str, str]:
        models = await list_models(self.base_url)
        entry = next((model for model in models if model.id == self.model), None)
        if entry is None:
            raise LLMError(f"LM Studio has no downloaded model called {self.model!r}.")
        if entry.loaded is None:
            # No native API (LM Studio before 0.4): it loads the model on first use.
            return {"endpoint": self.base_url}

        details = {"endpoint": self.base_url}
        if not entry.loaded:
            reply = await _post(self.base_url, "/api/v1/models/load", {"model": self.model}, _LOAD_TIMEOUT)
            if reply.get("load_time_seconds") is not None:
                details["loaded in"] = f"{reply['load_time_seconds']:.1f}s"
        for label, value in (("size", entry.params), ("quantization", entry.quantization)):
            if value:
                details[label] = value
        return details

    async def unload(self) -> None:
        try:
            await _post(self.base_url, "/api/v1/models/unload", {"instance_id": self.model})
        except LLMError:
            # Already unloaded from the LM Studio side, or the server is gone.
            pass


async def list_models(base_url: str) -> list[ModelInfo]:
    try:
        async with httpx2.AsyncClient(base_url=_root(base_url), timeout=10) as client:
            response = await client.get("/api/v1/models")
    except httpx2.HTTPError as exc:
        raise LLMError(_unreachable(base_url)) from exc
    if response.status_code == 404:
        return await openai_compat.list_models(base_url)
    if response.is_error:
        raise LLMError(f"LM Studio answered {response.status_code}: {_error_message(response)}")

    models = [
        ModelInfo(
            id=item["key"],
            name=item.get("display_name"),
            architecture=item.get("architecture"),
            params=item.get("params_string"),
            quantization=(item.get("quantization") or {}).get("name"),
            size_bytes=item.get("size_bytes"),
            context_length=item.get("max_context_length"),
            loaded=bool(item.get("loaded_instances")),
        )
        for item in response.json().get("models", [])
        if item.get("type") == "llm"
    ]
    return sorted(models, key=lambda model: (model.name or model.id).lower())


async def _post(base_url: str, path: str, payload: dict[str, str], timeout: httpx2.Timeout | float = 30) -> dict:
    try:
        async with httpx2.AsyncClient(base_url=_root(base_url), timeout=timeout) as client:
            response = await client.post(path, json=payload)
    except httpx2.HTTPError as exc:
        raise LLMError(_unreachable(base_url)) from exc
    if response.is_error:
        raise LLMError(f"LM Studio: {_error_message(response)}")
    return response.json()


def _root(base_url: str) -> str:
    return base_url.rstrip("/").removesuffix("/v1")


def _unreachable(base_url: str) -> str:
    return f"Could not reach LM Studio at {_root(base_url)}. Start its local server (Developer tab) and try again."


def _error_message(response: httpx2.Response) -> str:
    try:
        error = response.json().get("error")
    except ValueError:
        return response.text[:200]
    if isinstance(error, dict):
        return str(error.get("message") or error)
    return str(error or response.text[:200])
