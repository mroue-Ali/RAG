import asyncio
import logging
import time
from datetime import datetime, timezone

from ...schemas import LLMSettings, LLMState
from .base import LLMError, LLMProvider
from .registry import create_provider

log = logging.getLogger(__name__)


class LLMManager:
    """Owns the single active model: what is loaded, loading, or failed to load."""

    def __init__(self) -> None:
        self._provider: LLMProvider | None = None
        self._state = LLMState()
        self._task: asyncio.Task[None] | None = None

    @property
    def state(self) -> LLMState:
        return self._state

    def provider(self) -> LLMProvider:
        if self._provider is None or self._state.status != "ready":
            raise LLMError("No model is loaded. Load one first.")
        return self._provider

    async def load(self, settings: LLMSettings) -> LLMState:
        """Start loading the configured model and return at once; poll state for the result."""
        if self._state.status == "loading":
            raise LLMError("A model is already loading.")
        provider = create_provider(settings)
        await self.unload()
        self._state = LLMState(status="loading", provider=provider.kind, model=provider.model)
        self._task = asyncio.create_task(self._load(provider))
        return self._state

    async def unload(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
        provider, self._provider = self._provider, None
        self._task = None
        self._state = LLMState()
        if provider is not None:
            await _release(provider)

    async def _load(self, provider: LLMProvider) -> None:
        started = time.perf_counter()
        try:
            details = await provider.load()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if not isinstance(exc, LLMError):
                log.exception("Loading %s failed", provider.model)
            await _release(provider)
            self._state = self._state.model_copy(update={"status": "error", "error": str(exc)})
            return
        self._provider = provider
        self._state = self._state.model_copy(
            update={
                "status": "ready",
                "details": details,
                "loaded_at": datetime.now(timezone.utc),
                "load_seconds": round(time.perf_counter() - started, 1),
            }
        )


async def _release(provider: LLMProvider) -> None:
    try:
        await provider.unload()
        await provider.close()
    except Exception:
        log.exception("Unloading %s failed", provider.model)
