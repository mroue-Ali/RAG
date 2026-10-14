"""How models are run. What differs is the provider, not the instance.

Local providers (transformers, LM Studio) run on this machine. One model is
kept loaded for the whole process: load it, chat with it, unload it. A server
started with LOCAL_MODELS off refuses them, but still lists them.

The remote provider (any OpenAI-compatible API) keeps nothing: every request
builds a client from the account's settings, so "loading" it is only a
connection test. Without local models, its address must also be public.

The routes talk to the Runtime and do not need to know which kind they have.
"""

import asyncio

from ...schemas import FolderPick, LLMSettings, LLMState, ModelsRequest, ModelsResponse, ProviderInfo, ProviderKind
from .. import net
from . import registry, transformers_local
from .base import LLMError, LLMProvider
from .manager import LLMManager

PROVIDER_ORDER: tuple[ProviderKind, ...] = ("transformers", "lmstudio", "openai")
LOCAL_PROVIDERS: frozenset[ProviderKind] = frozenset({"transformers", "lmstudio"})

_NOT_HERE = "Runs on your own machine. Available when you run rag yourself."


class Runtime:
    def __init__(self, local_models: bool, allow_private_urls: bool = False) -> None:
        self.local_models = local_models
        # A machine of your own may call anything on its own network: that is where LM Studio lives.
        self._check_urls = not (local_models or allow_private_urls)
        self._manager = LLMManager()

    @property
    def default_provider(self) -> ProviderKind:
        return "lmstudio" if self.local_models else "openai"

    def providers(self) -> list[ProviderInfo]:
        return [
            ProviderInfo(kind=kind, available=self._available(kind), reason=None if self._available(kind) else _NOT_HERE)
            for kind in PROVIDER_ORDER
        ]

    def check(self, llm: LLMSettings) -> None:
        """Refuse settings this server will not run. May resolve a hostname, so it blocks."""
        self._check_provider(llm.provider)
        self._check_url(llm.openai.base_url)

    def state(self, llm: LLMSettings) -> LLMState:
        if llm.provider in LOCAL_PROVIDERS:
            return self._manager.state if self.local_models else LLMState()
        # Nothing is loaded for a remote provider: "ready" means it is filled in.
        if llm.openai.model.strip():
            return LLMState(status="ready", provider=llm.provider, model=llm.openai.model.strip())
        return LLMState()

    async def load(self, llm: LLMSettings) -> LLMState:
        """Local: start loading and return at once; poll state() for the result.
        Remote: test the connection and answer with the result."""
        await asyncio.to_thread(self.check, llm)
        if llm.provider in LOCAL_PROVIDERS:
            return await self._manager.load(llm)
        provider = registry.create_provider(llm, follow_redirects=not self._check_urls)
        try:
            details = await provider.load()
        finally:
            await provider.close()
        return LLMState(status="ready", provider=provider.kind, model=provider.model, details=details)

    async def unload(self) -> LLMState:
        if not self.local_models:
            raise LLMError("This server keeps no model in memory, so there is nothing to unload.")
        await self._manager.unload()
        return self._manager.state

    async def acquire(self, llm: LLMSettings) -> LLMProvider:
        """The provider for one chat turn. Hand it back to release() afterwards."""
        await asyncio.to_thread(self.check, llm)
        if llm.provider in LOCAL_PROVIDERS:
            return self._manager.provider()
        return registry.create_provider(llm, follow_redirects=not self._check_urls)

    async def release(self, provider: LLMProvider) -> None:
        # A local model stays loaded for the next turn; a remote client was made for this one.
        if provider.kind not in LOCAL_PROVIDERS:
            await provider.close()

    async def list_models(self, request: ModelsRequest, llm: LLMSettings) -> ModelsResponse:
        self._check_provider(request.provider)
        if request.provider == "openai":
            await asyncio.to_thread(self._check_url, request.base_url or llm.openai.base_url)
        return await registry.list_models(request, llm, follow_redirects=not self._check_urls)

    async def pick_folder(self, start: str | None) -> FolderPick:
        """Open the system folder dialog on the machine the backend runs on."""
        self._check_provider("transformers")
        return FolderPick(path=await asyncio.to_thread(transformers_local.pick_folder, start or ""))

    def _available(self, kind: ProviderKind) -> bool:
        return self.local_models or kind not in LOCAL_PROVIDERS

    def _check_provider(self, provider: ProviderKind) -> None:
        if not self._available(provider):
            raise LLMError("That provider is only available when you run rag on your own machine.")

    def _check_url(self, url: str) -> None:
        if self._check_urls:
            net.ensure_public_url(url)
