# Fintra Agent — How to Add a New Tool

## Architecture

```
routes/agent.py          HTTP endpoint (SSE streaming)
lib/agent/engine.py      Agentic loop: classifier → Sonnet → tool dispatch → confirmation gate
lib/agent/classifier.py  Haiku 4.5 intent gate (read/write/workflow/smalltalk/clarification)
lib/agent/tools/
  registry.py            Tool registration + execution dispatcher
  journal_tool.py        Reference implementation (two-phase write + audit)
  query_tool.py          Read-only financial queries
  ...                    Other tools (stubs and implementations)
lib/agent/resolver.py    Semantic account matching (pgvector → fuzzy fallback)
lib/agent/embeddings.py  OpenAI text-embedding-3-small wrapper
lib/agent/memory.py      Conversation persistence (ai_conversations table)
lib/agent/context.py     Financial context builder (injected into system prompt)
```

## Adding a New Write Tool

Write tools have two phases: **preview** (shown to user) and **execute** (runs after approval).

### Step 1 — Create the tool file

```python
# lib/agent/tools/my_tool.py
import datetime
from typing import Dict, Any
from lib.agent.tools.registry import AgentTool, register_tool
from database import supabase


async def handle_my_action(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Phase 1: validate inputs, build preview. No DB writes here."""
    company_id = context["company_id"]

    # Validate
    amount = arguments.get("amount")
    if not amount:
        return {"error": "Amount is required."}

    # Build a structured preview the frontend will render
    return {
        "preview": {
            "type": "my_action",        # used by frontend to pick renderer
            "summary": f"${amount:,.2f} ...",
            # add any fields your frontend PreviewBlock needs
        },
        "ready_to_create": True,        # triggers the confirmation gate in engine.py
        "embedding_match_scores": {},   # include if you used resolver.resolve_account()
        "resolved_data": {...},         # store resolved IDs here for the confirmed handler
        "confirmation_message": f"Ready to record ${amount:,.2f}. Shall I proceed?",
    }


async def handle_confirmed_my_action(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Phase 2: called after user clicks Approve. Write to DB here."""
    # arguments contains everything from phase 1 including resolved_data
    company_id = context["company_id"]
    user_id = context["user_id"]

    # ... DB write ...

    return {
        "created": True,
        "message": "Action completed successfully.",
    }


def register():
    register_tool(AgentTool(
        name="my_action",
        description="Clear description of what this tool does and when to call it.",
        parameters={
            "type": "object",
            "properties": {
                "amount": {"type": "number", "description": "Amount in USD"},
                # add more fields...
            },
            "required": ["amount"],
        },
        handler=handle_my_action,
        requires_confirmation=True,     # always True for write tools
    ))
```

### Step 2 — Register it in registry.py

Add to `_register_defaults()`:

```python
try:
    from lib.agent.tools.my_tool import register as register_my
    register_my()
except ImportError:
    pass
```

### Step 3 — Wire the confirmed handler in engine.py

Add to `handler_map` in `_execute_confirmed_action()`:

```python
handler_map = {
    "create_journal_entry": _import_confirmed_journal_handler,
    "my_action": lambda: _import_handler("lib.agent.tools.my_tool", "handle_confirmed_my_action"),
}
```

Or use the same lazy-import pattern as the journal handler.

### Step 4 — (Optional) Add a frontend preview renderer

For polished demo UX, add a typed interface and renderer in `AgentChat.tsx`:

```tsx
interface MyActionPreview {
  type: 'my_action'
  summary: string
  // ...
}
```

Add a branch in `PreviewBlock` to render it.

### Step 5 — Run migration if new DB columns needed

Create `migrations/0NN_my_tool.sql` and run it in Supabase SQL Editor.

---

## Adding a Read-Only Tool

Read tools don't need confirmation. Just register with `requires_confirmation=False` (default):

```python
register_tool(AgentTool(
    name="get_something",
    description="...",
    parameters={...},
    handler=handle_get_something,
    requires_confirmation=False,
))
```

No confirmed handler needed. The result goes straight back to the model.

---

## Semantic Account Resolution

When your tool takes an account name from the user, use the resolver instead of string matching:

```python
from lib.agent.resolver import resolve_account

result = resolve_account(company_id, user_input)

if result["status"] == "resolved":
    account_id = result["entity"].id
    score = result["entity"].score  # log this in embedding_match_scores

elif result["status"] == "ambiguous":
    # Return this directly — the model will ask the user to pick
    return {
        "needs_clarification": True,
        "clarification": f"Multiple accounts match '{user_input}':\n" + ...,
        "candidates": [...],
    }

else:  # "none"
    return {"error": f"Account not found: {user_input}"}
```

For new orgs or after CoA changes, backfill embeddings:

```python
from lib.agent.embeddings import backfill_org_embeddings
backfill_org_embeddings(company_id)
```

This requires `OPENAI_API_KEY` to be set. When not set, `resolve_account` automatically falls back to fuzzy matching — no code changes needed.

---

## Model Assignments

| Component | Model | Why |
|---|---|---|
| Intent classifier | `claude-haiku-4-5-20251001` | <400ms, cheap, handles simple routing |
| Reasoning + tool calls | `claude-sonnet-4-6` | Best tool-use reliability for write ops |
| Account embeddings | `text-embedding-3-small` (OpenAI) | Cheap, 1536-dim, good semantic matching |

---

## Audit Trail

Every confirmed write creates a row in `agent_actions` with:
- `tool_name`, `arguments` (including `resolved_lines` with UUIDs)
- `preview_json` — what was shown to the user
- `embedding_match_scores` — per-field similarity scores for accountability
- `model_versions` — which models were used
- `source: 'ai_agent'`, `conversation_id` — links back to the session
- `confirmed_at`, `executed_at`, `reversed_at` — full lifecycle timestamps
