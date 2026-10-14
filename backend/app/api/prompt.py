from fastapi import APIRouter

from ..schemas import PromptPreview, PromptPreviewRequest, PromptVariable
from ..services import prompt
from .deps import RuntimeDep, SettingsDep, UserDep

router = APIRouter(prefix="/prompt", tags=["prompt"])


@router.get("/variables")
def variables(user: UserDep) -> list[PromptVariable]:
    return prompt.VARIABLES


@router.post("/preview")
def preview(
    request: PromptPreviewRequest, runtime: RuntimeDep, settings: SettingsDep, user: UserDep
) -> PromptPreview:
    """Render unsaved templates exactly as a chat turn would, for the settings editor."""
    model = runtime.state(settings.llm).model
    return prompt.preview(request.prompt, request.general, user.display_name, model, request.question)
