import logging

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Setting
from ..schemas import AppSettings, ProviderKind
from .crypto import Cipher

log = logging.getLogger(__name__)

# api_key_set is derived from api_key, so it is never stored.
_NOT_STORED = {"llm": {"openai": {"api_key_set"}}}


class SettingsStore:
    """Each account's settings, shared by its users, with the API key encrypted at rest."""

    def __init__(self, cipher: Cipher, default_provider: ProviderKind) -> None:
        self._cipher = cipher
        self._default_provider = default_provider

    def defaults(self) -> AppSettings:
        settings = AppSettings()
        settings.llm.provider = self._default_provider
        return settings

    def load(self, session: Session, account_id: int) -> AppSettings:
        stored = {
            row.key: row.value
            for row in session.scalars(select(Setting).where(Setting.account_id == account_id))
        }
        settings = self.defaults()
        for name, field in AppSettings.model_fields.items():
            if name not in stored:
                continue
            try:
                setattr(settings, name, field.annotation.model_validate(stored[name]))
            except ValidationError as exc:
                # A stored section that no longer validates (a hand edit, or a schema
                # change) should not take the whole app down with it.
                log.warning("Stored %r settings for account %s are invalid, using defaults: %s", name, account_id, exc)
        if settings.llm.openai.api_key:
            settings.llm.openai.api_key = self._cipher.decrypt(settings.llm.openai.api_key)
        return settings

    def save(self, session: Session, account_id: int, incoming: AppSettings) -> AppSettings:
        if incoming.llm.openai.api_key is None:
            incoming.llm.openai.api_key = self.load(session, account_id).llm.openai.api_key

        stored = incoming.model_copy(deep=True)
        if stored.llm.openai.api_key:
            stored.llm.openai.api_key = self._cipher.encrypt(stored.llm.openai.api_key)
        for key, value in stored.model_dump(mode="json", exclude=_NOT_STORED).items():
            row = session.get(Setting, (account_id, key))
            if row is None:
                session.add(Setting(account_id=account_id, key=key, value=value))
            else:
                row.value = value
        session.commit()
        return incoming

    @staticmethod
    def public(settings: AppSettings) -> AppSettings:
        """The settings as the API returns them: the API key never leaves the server."""
        redacted = settings.model_copy(deep=True)
        redacted.llm.openai.api_key_set = bool(redacted.llm.openai.api_key)
        redacted.llm.openai.api_key = None
        return redacted
