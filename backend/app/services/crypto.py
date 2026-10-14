"""Encryption for secrets kept in the database, such as an account's API key."""

import base64
import hashlib
import logging
import secrets
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from ..config import Config

log = logging.getLogger(__name__)

_PREFIX = "enc:v1:"


class Cipher:
    def __init__(self, secret: str) -> None:
        # Fernet wants exactly 32 url-safe bytes; derive them from whatever secret was configured.
        self._fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))

    @classmethod
    def from_config(cls, config: Config) -> "Cipher":
        if config.secret_key:
            return cls(config.secret_key)
        if config.is_production:
            raise RuntimeError(
                "SECRET_KEY must be set in production. It encrypts stored API keys, "
                "so generate a long random value and keep it stable."
            )
        return cls(_local_secret(config.data_dir / "secret.key"))

    def encrypt(self, plaintext: str) -> str:
        return _PREFIX + self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, stored: str) -> str:
        """The plaintext, or "" when it cannot be recovered (the secret key changed)."""
        if not stored.startswith(_PREFIX):
            return stored
        try:
            return self._fernet.decrypt(stored[len(_PREFIX) :].encode()).decode()
        except InvalidToken:
            log.warning("A stored secret could not be decrypted. Was SECRET_KEY changed?")
            return ""


def _local_secret(path: Path) -> str:
    """Development needs no setup: make a key on first run and keep it beside the database."""
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_urlsafe(48)
    path.write_text(secret, encoding="utf-8")
    return secret
