"""
Agent conversation memory.
Uses the ai_conversations table (messages JSONB column).
Conversations are scoped per company + user + session.

Storage format: each entry in the messages array is:
  { "role": "user"|"assistant", "content": str|list, "timestamp": str }

  - content is a plain string for text-only messages
  - content is a list of Anthropic content blocks for tool_use / tool_result turns:
      [{"type": "tool_use", "id": ..., "name": ..., "input": {...}}]   (assistant)
      [{"type": "tool_result", "tool_use_id": ..., "content": ...}]    (user)

This format maps directly to the Anthropic API — get_anthropic_messages()
returns it as-is, no translation needed.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from database import supabase

# Keep at most this many messages in the live context window.
# When exceeded, the oldest messages are dropped (keeping at least COMPACT_KEEP_RECENT).
COMPACT_MAX_MESSAGES = 60
COMPACT_KEEP_RECENT = 30


# ── Read ──────────────────────────────────────────────────────────────────────

def load_conversation(session_id: str, company_id: str) -> List[Dict[str, Any]]:
    """Load raw message history for a session."""
    row = supabase.table("ai_conversations")\
        .select("messages")\
        .eq("id", session_id)\
        .eq("company_id", company_id)\
        .execute()
    if not row.data:
        return []
    return row.data[0].get("messages") or []


def get_anthropic_messages(session_id: str, company_id: str) -> List[Dict]:
    """
    Return message history formatted for the Anthropic API (system excluded).
    Content is already in Anthropic format (str or list of blocks).
    Consecutive same-role messages are merged to satisfy the alternating-role contract.
    """
    history = load_conversation(session_id, company_id)
    messages: List[Dict] = []

    for msg in history:
        role = msg["role"]
        if role == "system":
            continue
        content = msg.get("content")
        if not content and content != 0:
            continue

        # Merge consecutive same-role messages (can happen after schema migrations)
        if messages and messages[-1]["role"] == role:
            prev = messages[-1]["content"]
            curr = content
            # Normalise both to lists of blocks, then concatenate
            if isinstance(prev, str):
                prev = [{"type": "text", "text": prev}]
            if isinstance(curr, str):
                curr = [{"type": "text", "text": curr}]
            messages[-1]["content"] = prev + curr
        else:
            messages.append({"role": role, "content": content})

    return messages


def list_sessions(company_id: str, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    rows = supabase.table("ai_conversations")\
        .select("id, title, created_at, updated_at")\
        .eq("company_id", company_id)\
        .eq("user_id", user_id)\
        .order("updated_at", desc=True)\
        .limit(limit)\
        .execute()
    return rows.data or []


# ── Write ─────────────────────────────────────────────────────────────────────

def create_session(company_id: str, user_id: str, title: str = "Agent Chat") -> str:
    """Create a new conversation session. Returns the session ID."""
    row = supabase.table("ai_conversations").insert({
        "company_id": company_id,
        "user_id": user_id,
        "title": title,
        "context_type": "general",
        "messages": [],
    }).execute()
    if not row.data:
        raise RuntimeError("Failed to create conversation session")
    return row.data[0]["id"]


def _append_message(session_id: str, company_id: str, entry: Dict[str, Any]):
    """Append one message entry to the conversation, compacting if needed."""
    current = load_conversation(session_id, company_id)
    current.append(entry)

    # Compact: drop oldest messages when the conversation grows too large.
    # Always keep pairs (assistant tool_use + user tool_result) together.
    if len(current) > COMPACT_MAX_MESSAGES:
        current = current[-COMPACT_KEEP_RECENT:]

    supabase.table("ai_conversations")\
        .update({
            "messages": current,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })\
        .eq("id", session_id)\
        .execute()


def save_user_message(session_id: str, company_id: str, text: str):
    """Save a plain user text message."""
    _append_message(session_id, company_id, {
        "role": "user",
        "content": text,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def save_assistant_message(
    session_id: str,
    company_id: str,
    text: str,
    tool_use_blocks: Optional[List[Dict]] = None,
):
    """
    Save an assistant turn.
    If tool_use_blocks is provided, content is stored as a list of Anthropic
    content blocks (text block + tool_use blocks) so the API can replay it.
    """
    if tool_use_blocks:
        content: Any = []
        if text:
            content.append({"type": "text", "text": text})
        content.extend(tool_use_blocks)
    else:
        content = text

    _append_message(session_id, company_id, {
        "role": "assistant",
        "content": content,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def save_tool_results(session_id: str, company_id: str, tool_results: List[Dict]):
    """
    Save tool results as a user-role message with tool_result content blocks.
    This is the format Anthropic requires to continue after a tool_use turn.

    Each entry in tool_results must be:
      {"type": "tool_result", "tool_use_id": str, "content": str}
    """
    if not tool_results:
        return
    _append_message(session_id, company_id, {
        "role": "user",
        "content": tool_results,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


# ── Legacy helpers (kept for backward compat with old callers) ────────────────

def save_message(
    session_id: str,
    company_id: str,
    role: str,
    content: str,
    tool_calls: Optional[List[Dict]] = None,
    tool_results: Optional[List[Dict]] = None,
):
    """
    Legacy save_message — kept for backward compat.
    New code should use save_user_message / save_assistant_message / save_tool_results.
    """
    if role == "user":
        save_user_message(session_id, company_id, content)
    elif role == "assistant":
        save_assistant_message(session_id, company_id, content)
