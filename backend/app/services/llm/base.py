from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import ClassVar

from ...schemas import ProviderKind

Message = dict[str, str]


class LLMError(Exception):
    """A failure whose message is safe and useful to show in the UI."""


@dataclass(frozen=True)
class GenerationParams:
    temperature: float
    top_p: float
    max_tokens: int


@dataclass(frozen=True)
class Usage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@dataclass(frozen=True)
class Chunk:
    text: str = ""
    # Thinking tokens from reasoning models, kept apart from the answer.
    reasoning: str = ""
    finish_reason: str | None = None
    usage: Usage | None = None


class LLMProvider(ABC):
    """One configured model, wherever it runs."""

    kind: ClassVar[ProviderKind]
    model: str

    @abstractmethod
    async def load(self) -> dict[str, str]:
        """Make the model ready to answer. Returns facts worth showing (device, context size)."""

    async def unload(self) -> None:
        """Release whatever load() acquired."""

    async def close(self) -> None:
        """Release what the object itself holds, such as an HTTP connection pool."""

    @abstractmethod
    def stream(self, messages: list[Message], params: GenerationParams) -> AsyncIterator[Chunk]:
        """Generate a reply. Closing the iterator early must stop the generation."""
