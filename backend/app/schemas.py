from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ProviderKind = Literal["lmstudio", "openai", "transformers"]
# Inside an account. What each may do is in app.services.roles.
Role = Literal["owner", "admin", "member"]
# The roles an owner or admin can hand out. There is one owner per account.
AssignableRole = Literal["admin", "member"]

DEFAULT_SYSTEM_TEMPLATE = """\
You are {{assistant_name}}, a personal knowledge assistant for {{user_name}}.
Today is {{date}}.

Answer clearly and get to the point. If you are not sure about something, say so instead of guessing."""

DEFAULT_USER_TEMPLATE = "{{question}}"


# --- Settings -----------------------------------------------------------------


class LMStudioConfig(BaseModel):
    base_url: str = "http://localhost:1234/v1"
    model: str = ""


class OpenAIConfig(BaseModel):
    base_url: str = "https://api.openai.com/v1"
    model: str = ""
    # Write-only over the API. Responses always carry None here and report
    # api_key_set instead; on update, None keeps the stored key and "" clears it.
    api_key: str | None = None
    api_key_set: bool = False


class TransformersConfig(BaseModel):
    # Where to look for models. Empty means the Hugging Face cache.
    models_dir: str = ""
    # The model folder picked from that directory, or a cached repo id.
    model: str = ""
    device: Literal["auto", "cuda", "cpu"] = "auto"
    dtype: Literal["auto", "float16", "bfloat16", "float32"] = "auto"
    quantization: Literal["none", "8bit", "4bit"] = "none"


class LLMSettings(BaseModel):
    provider: ProviderKind = "lmstudio"
    lmstudio: LMStudioConfig = Field(default_factory=LMStudioConfig)
    openai: OpenAIConfig = Field(default_factory=OpenAIConfig)
    transformers: TransformersConfig = Field(default_factory=TransformersConfig)
    # Seconds to wait on an API provider before giving up on a response.
    request_timeout: float = Field(120, ge=5, le=3600)
    auto_load: bool = False


class GenerationSettings(BaseModel):
    temperature: float = Field(0.7, ge=0, le=2)
    top_p: float = Field(0.95, gt=0, le=1)
    max_tokens: int = Field(1024, ge=1, le=32768)
    # How many earlier messages go back to the model each turn. 0 sends them all.
    history_messages: int = Field(20, ge=0, le=500)
    stream: bool = True


class PromptSettings(BaseModel):
    system_template: str = DEFAULT_SYSTEM_TEMPLATE
    user_template: str = DEFAULT_USER_TEMPLATE


class GeneralSettings(BaseModel):
    assistant_name: str = Field("Assistant", max_length=60)


class AppSettings(BaseModel):
    llm: LLMSettings = Field(default_factory=LLMSettings)
    generation: GenerationSettings = Field(default_factory=GenerationSettings)
    prompt: PromptSettings = Field(default_factory=PromptSettings)
    general: GeneralSettings = Field(default_factory=GeneralSettings)


# --- Models and runtime -------------------------------------------------------


class ModelInfo(BaseModel):
    id: str
    name: str | None = None
    architecture: str | None = None
    params: str | None = None
    quantization: str | None = None
    size_bytes: int | None = None
    context_length: int | None = None
    loaded: bool | None = None


class ModelsRequest(BaseModel):
    provider: ProviderKind
    # Unsaved form values, so the list can be fetched before saving.
    base_url: str | None = None
    api_key: str | None = None
    models_dir: str | None = None


class ModelsResponse(BaseModel):
    models: list[ModelInfo]
    note: str | None = None


class FolderPick(BaseModel):
    # The folder the dialog opens in, and afterwards the one chosen (None if cancelled).
    path: str | None = None


class ProviderInfo(BaseModel):
    kind: ProviderKind
    # Every provider is listed everywhere. One this server cannot run is shown
    # disabled, with the reason, so people still learn that it exists.
    available: bool
    reason: str | None = None


class LLMState(BaseModel):
    status: Literal["unloaded", "loading", "ready", "error"] = "unloaded"
    provider: ProviderKind | None = None
    model: str | None = None
    details: dict[str, str] = Field(default_factory=dict)
    error: str | None = None
    loaded_at: datetime | None = None
    load_seconds: float | None = None


# --- Prompt -------------------------------------------------------------------


class PromptVariable(BaseModel):
    name: str
    description: str
    scope: Literal["both", "user"] = "both"


class PromptPreviewRequest(BaseModel):
    prompt: PromptSettings
    general: GeneralSettings
    question: str = ""


class PromptPreview(BaseModel):
    system: str
    user: str
    unknown: list[str]


# --- Chat ---------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)


# --- Accounts and users -------------------------------------------------------


class AccountInfo(BaseModel):
    id: int
    name: str


class UserInfo(BaseModel):
    id: int
    username: str
    display_name: str
    role: Role
    is_superadmin: bool
    # Google-only users have none, so changing it asks for no current password.
    has_password: bool


class MemberInfo(UserInfo):
    created_at: datetime


class SessionInfo(BaseModel):
    """What the client needs before it can decide what to show."""

    app: str
    # None until someone signs in.
    user: UserInfo | None
    account: AccountInfo | None
    # What the signed-in user's role allows, from app.services.roles. Empty when signed out.
    permissions: list[str]
    # How someone new gets in: "setup" until the instance has its first user,
    # then "open" (anyone can create an account) or "closed" (admins add people).
    signup: Literal["setup", "open", "closed"]
    providers: list[ProviderInfo]
    # Set when Sign in with Google is offered.
    google_client_id: str | None


class Credentials(BaseModel):
    username: str
    password: str


class SetupRequest(Credentials):
    account_name: str = Field(min_length=1, max_length=120)


class GoogleCredential(BaseModel):
    credential: str


class AccountUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class NewUser(BaseModel):
    username: str
    display_name: str = Field("", max_length=120)
    password: str
    role: AssignableRole = "member"


class UserUpdate(BaseModel):
    """Only the fields that are set change."""

    display_name: str | None = Field(None, min_length=1, max_length=120)
    role: AssignableRole | None = None
    # Sets a new password without the old one: how an admin lets someone back in.
    password: str | None = None


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


class PasswordChange(BaseModel):
    # Not needed by someone who has no password yet.
    current_password: str = ""
    new_password: str


class AdminAccount(BaseModel):
    """An account as the instance's superadmins see it."""

    id: int
    name: str
    created_at: datetime
    users: list[MemberInfo]


class SuperadminUpdate(BaseModel):
    is_superadmin: bool


# --- Health -------------------------------------------------------------------


class DatabaseStatus(BaseModel):
    backend: str
    location: str
    fallback: bool
    error: str | None


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    app: str
    env: str
    database: DatabaseStatus
