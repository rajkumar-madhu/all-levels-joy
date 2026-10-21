"""Anthropic client for the support assistant (replaces the Lovable AI gateway).

`get_client()` is the single seam tests replace with a fake; nothing else imports the SDK.
"""

import functools

from django.conf import settings

# Server-side refusal fallback, routed by refusal category (no model list to maintain).
FALLBACK_BETA = "server-side-fallback-2026-07-01"

PROPOSE_TICKET_TOOL = {
    "name": "propose_ticket",
    "description": (
        "Propose an incident ticket for the employee to confirm. Use it when the problem is not "
        "self-serviceable, is urgent, affects several people, or the employee asks to log it. "
        "It does not create anything: the employee reviews and confirms the proposal."
    ),
    "strict": True,
    "eager_input_streaming": True,
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["title", "description", "category", "subcategory", "impact", "urgency"],
        "properties": {
            "title": {"type": "string", "description": "Short summary, 5-160 characters."},
            "description": {"type": "string", "description": "What is happening, who is affected, since when."},
            "category": {"type": "string", "enum": ["network", "hardware", "software", "database", "inquiry"]},
            "subcategory": {"type": "string", "description": "Optional detail, or an empty string."},
            "impact": {"type": "integer", "enum": [1, 2, 3], "description": "1 high, 2 medium, 3 low"},
            "urgency": {"type": "integer", "enum": [1, 2, 3], "description": "1 high, 2 medium, 3 low"},
        },
    },
}


@functools.cache
def get_client():
    from anthropic import AsyncAnthropic

    return AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)


def is_configured() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


def stream_reply(system: str, messages: list[dict]):
    """Async context manager for the SDK's beta message stream."""
    return get_client().beta.messages.stream(
        model=settings.ANTHROPIC_MODEL,
        max_tokens=settings.ASSISTANT_MAX_TOKENS,
        system=system,
        messages=messages,
        tools=[PROPOSE_TICKET_TOOL],
        tool_choice={"type": "auto"},
        # Short chat answers: low effort keeps latency and cost down.
        output_config={"effort": "low"},
        betas=[FALLBACK_BETA],
        fallbacks="default",
    )
