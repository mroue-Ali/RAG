import asyncio

from ...schemas import LLMSettings, ModelsRequest, ModelsResponse
from . import lmstudio, openai_compat, transformers_local
from .base import LLMError, LLMProvider


def create_provider(settings: LLMSettings, follow_redirects: bool = True) -> LLMProvider:
    """Build the provider the settings point at. Nothing is loaded yet."""
    if settings.provider == "lmstudio":
        config = settings.lmstudio
        _require_model(config.model)
        return lmstudio.LMStudioProvider(config.base_url, config.model, timeout=settings.request_timeout)
    if settings.provider == "openai":
        config = settings.openai
        _require_model(config.model)
        return openai_compat.OpenAICompatProvider(
            config.base_url,
            config.model,
            api_key=config.api_key or "",
            timeout=settings.request_timeout,
            follow_redirects=follow_redirects,
        )
    _require_model(settings.transformers.model)
    return transformers_local.TransformersProvider(settings.transformers)


async def list_models(request: ModelsRequest, saved: LLMSettings, follow_redirects: bool = True) -> ModelsResponse:
    """Models the provider can offer, using unsaved form values where given."""
    if request.provider == "lmstudio":
        base_url = request.base_url or saved.lmstudio.base_url
        return ModelsResponse(models=await lmstudio.list_models(base_url))
    if request.provider == "openai":
        base_url = request.base_url or saved.openai.base_url
        api_key = saved.openai.api_key if request.api_key is None else request.api_key
        models = await openai_compat.list_models(base_url, api_key or "", follow_redirects=follow_redirects)
        note = None if models else "This server does not list its models. Type the model id."
        return ModelsResponse(models=models, note=note)

    versions = transformers_local.runtime()
    if versions is None:
        raise LLMError("The local runtime is not installed. Run: pip install -r requirements-local.txt")
    models_dir = saved.transformers.models_dir if request.models_dir is None else request.models_dir
    models = await asyncio.to_thread(transformers_local.list_models, models_dir)
    return ModelsResponse(models=models, note=versions)


def _require_model(model: str) -> None:
    if not model.strip():
        raise LLMError("No model is selected. Choose one in Settings.")
