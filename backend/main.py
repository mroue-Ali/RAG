"""Entry point for `uvicorn main:app`. The application lives in the app package."""

from app.main import app

__all__ = ["app"]
