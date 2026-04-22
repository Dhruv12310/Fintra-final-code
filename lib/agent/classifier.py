"""
Intent classifier using Claude Haiku 4.5.
Runs before the expensive Sonnet reasoning call to route messages efficiently.
"""

import os
from typing import List, Dict, Optional, Literal

Intent = Literal["read", "write", "workflow", "smalltalk", "clarification"]

_SYSTEM = """You are an intent classifier for a double-entry accounting assistant.
Classify the user message into exactly one intent:

- read: user wants information (balances, reports, history, lookups) — no data changes
- write: user wants to create/update/delete a specific record (journal entry, invoice, bill, payment, contact, account)
- workflow: user wants a multi-step process (reconciliation, month-end close, bulk categorize, import)
- smalltalk: greeting, off-topic, general chat not about accounting tasks
- clarification: user is answering a prior question, providing a missing field, or confirming/denying a suggestion

Examples:
- "Create a $3,000 rent journal entry, debit rent credit checking" → write
- "Record that I paid $500 for office supplies" → write
- "Post a journal entry for payroll" → write
- "Debit rent expense and credit checking account for 2500" → write
- "How much cash do I have?" → read
- "Show me the balance sheet" → read
- "yes, go ahead" → clarification
- "the operating account" → clarification
- "thanks!" → smalltalk

Output only the intent word, lowercase, nothing else."""


async def classify_intent(
    message: str,
    recent_messages: Optional[List[Dict]] = None,
) -> Intent:
    """
    Classify user intent using Haiku 4.5. Target latency: <400ms p50.
    Returns one of: read, write, workflow, smalltalk, clarification.
    Defaults to 'write' on error — safe, lets the full orchestrator handle it.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return "write"

    import anthropic
    client = anthropic.AsyncAnthropic(api_key=api_key)

    msgs: List[Dict] = []
    # Only inject history when the last assistant turn was a question — prior
    # prose turns (advice, markdown summaries) contaminate classification and
    # cause legit write requests to be misrouted as "clarification".
    if recent_messages:
        last_assistant = next(
            (m for m in reversed(recent_messages[-4:]) if m.get("role") == "assistant"),
            None,
        )
        last_content = last_assistant.get("content", "") if last_assistant else ""
        if isinstance(last_content, str) and "?" in last_content:
            for m in recent_messages[-4:]:
                role = m.get("role")
                content = m.get("content")
                if role in ("user", "assistant") and isinstance(content, str):
                    msgs.append({"role": role, "content": content})

    msgs.append({"role": "user", "content": message})

    try:
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8,
            system=_SYSTEM,
            messages=msgs,
        )
        raw = resp.content[0].text.strip().lower()
        if raw in ("read", "write", "workflow", "smalltalk", "clarification"):
            return raw  # type: ignore
        return "write"
    except Exception:
        return "write"
