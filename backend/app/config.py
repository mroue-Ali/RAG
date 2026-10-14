from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Config(BaseSettings):
    """Process configuration, read from the environment and backend/.env.

    What people edit in the UI (model, prompt, generation) is not here: that
    lives in the database, per account, as app.schemas.AppSettings.

    There is one kind of instance. Every one has accounts, users and sign-in;
    these settings only decide what this particular server can do.
    """

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    app_name: str = "rag"
    app_env: str = "development"
    database_url: str = ""
    data_dir: Path = BACKEND_DIR / "data"

    # Whether this server runs models on its own machine: transformers in its
    # memory, and LM Studio on its localhost. On for your own computer. Off for a
    # shared server, where those providers are still listed but cannot be picked.
    local_models: bool = True
    # Whether anyone who reaches the sign-in page can create an account. Off, the
    # first visitor sets the instance up and admins add everyone after that.
    open_signup: bool = False

    # Encrypts stored API keys. Required in production; elsewhere one is
    # generated into data_dir when this is empty.
    secret_key: str = ""
    session_days: int = 30
    # Web client ID from Google Cloud. Sign in with Google is offered only when set.
    google_client_id: str = ""
    # The built frontend (frontend/dist). When set, the backend serves it too, so one
    # container answers for the whole site. In development Vite serves it instead.
    static_dir: Path | None = None
    # Without local models, provider addresses on private networks are refused.
    # Turn this on to try that setup against a model server on your own machine.
    allow_private_urls: bool = False

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}


@lru_cache
def get_config() -> Config:
    return Config()
