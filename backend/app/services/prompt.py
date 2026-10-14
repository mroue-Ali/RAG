"""Turns the prompt templates and a conversation into the messages sent to the model.

Templates use {{name}} placeholders. This is the one place that knows which
names exist, so new ones (retrieved context, for instance) are added here and
show up in the settings UI through VARIABLES.
"""

import re
from datetime import datetime

from ..schemas import AppSettings, ChatMessage, GeneralSettings, PromptPreview, PromptSettings, PromptVariable

VARIABLES = [
    PromptVariable(name="assistant_name", description="The assistant's name, from General settings"),
    PromptVariable(name="user_name", description="The name of whoever is chatting, from their profile"),
    PromptVariable(name="date", description="Today's date"),
    PromptVariable(name="time", description="The current time"),
    PromptVariable(name="model", description="The id of the loaded model"),
    PromptVariable(name="question", description="The message being sent", scope="user"),
]

_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_]\w*)\s*\}\}")


def render(template: str, values: dict[str, str]) -> tuple[str, list[str]]:
    """Fill the placeholders. Unknown names are left as written and returned."""
    unknown: list[str] = []

    def substitute(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in values:
            return values[name]
        if name not in unknown:
            unknown.append(name)
        return match.group(0)

    return _PLACEHOLDER.sub(substitute, template), unknown


def preview(
    prompt: PromptSettings, general: GeneralSettings, user_name: str, model: str | None, question: str
) -> PromptPreview:
    values = _values(general, user_name, model)
    system, unknown_system = render(prompt.system_template, values)
    user, unknown_user = render(prompt.user_template, {**values, "question": question})
    # `question` is only defined for the user template; in the system template it is unknown.
    return PromptPreview(
        system=system.strip(),
        user=user.strip(),
        unknown=list(dict.fromkeys(unknown_system + unknown_user)),
    )


def build_messages(
    settings: AppSettings, user_name: str, conversation: list[ChatMessage], model: str
) -> list[dict[str, str]]:
    """The message list for one turn: system prompt, trimmed history, templated question."""
    *history, question = conversation
    limit = settings.generation.history_messages
    if limit:
        history = history[-limit:]

    rendered = preview(settings.prompt, settings.general, user_name, model, question.content)
    messages = [{"role": "system", "content": rendered.system}] if rendered.system else []
    messages += [{"role": message.role, "content": message.content} for message in history]
    # A user template that drops {{question}} would send an empty turn.
    messages.append({"role": "user", "content": rendered.user or question.content})
    return messages


def _values(general: GeneralSettings, user_name: str, model: str | None) -> dict[str, str]:
    now = datetime.now().astimezone()
    return {
        "assistant_name": general.assistant_name.strip() or "Assistant",
        "user_name": user_name.strip() or "the user",
        "date": f"{now:%A}, {now.day} {now:%B %Y}",
        "time": f"{now:%H:%M}",
        "model": model or "no model loaded",
    }
