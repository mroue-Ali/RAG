from fastapi import APIRouter

from ..schemas import FolderPick, LLMState, ModelsRequest, ModelsResponse
from ..services.roles import Permission
from .deps import RuntimeDep, SettingsDep, require

router = APIRouter(prefix="/llm", tags=["llm"])


@router.get("/status")
async def status(runtime: RuntimeDep, settings: SettingsDep) -> LLMState:
    return runtime.state(settings.llm)


@router.post("/load", dependencies=[require(Permission.MANAGE_MODEL)])
async def load(runtime: RuntimeDep, settings: SettingsDep) -> LLMState:
    """Local provider: start loading the saved model, then poll /status until it settles.
    Remote provider: test the connection to it and answer with the result."""
    return await runtime.load(settings.llm)


@router.post("/unload", dependencies=[require(Permission.MANAGE_MODEL)])
async def unload(runtime: RuntimeDep) -> LLMState:
    return await runtime.unload()


@router.post("/models", dependencies=[require(Permission.MANAGE_MODEL)])
async def models(request: ModelsRequest, runtime: RuntimeDep, settings: SettingsDep) -> ModelsResponse:
    return await runtime.list_models(request, settings.llm)


@router.post("/pick-folder", dependencies=[require(Permission.MANAGE_MODEL)])
async def pick_folder(request: FolderPick, runtime: RuntimeDep) -> FolderPick:
    """Local only: the backend shows the system folder dialog and answers with the choice."""
    return await runtime.pick_folder(request.path)
