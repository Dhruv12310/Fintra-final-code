"""
Agent execution engine — Anthropic Claude backend.

Improvements over the original:
  1. Haiku 4.5 intent classifier gate (smalltalk bypasses tool orchestration)
  2. Streaming text tokens (frontend appends text chunks in real-time)
  3. Proper multi-turn agentic loop with correct tool_result content blocks
  4. Prompt caching on the system prompt (cost savings)
  5. Conversation compaction in memory.py (prevents context overflow)
  6. Max tool iteration cap (prevents infinite loops)
  7. Slot-filling system prompt (ONE question at a time with suggestions)
  8. Full audit trail: embedding_match_scores + model_versions in agent_actions
"""

import json
import os
from typing import AsyncGenerator, Dict, Any, Optional, List
from datetime import datetime, timezone

from lib.agent.memory import (
    load_conversation,
    save_user_message,
    save_assistant_message,
    save_tool_results,
    create_session,
    get_anthropic_messages,
)
from lib.agent.tools.registry import get_tools_for_anthropic, execute_tool, get_tool
from lib.agent.context import build_financial_context, build_context_string
from lib.agent.classifier import classify_intent
from database import supabase

MAX_TOOL_ITERATIONS = 8

_MODEL_REASONING = "claude-sonnet-4-6"
_MODEL_CLASSIFIER = "claude-haiku-4-5-20251001"

SYSTEM_PROMPT_TEMPLATE = """You are Fintra AI, an expert accounting assistant for {company_name}.
You have access to the company's live financial data and can answer questions, analyze finances, and create accounting entries.

Current financial snapshot:
{financial_context}

CRITICAL RULE FOR WRITE REQUESTS:
When the user asks to create, record, or post any accounting entry:
1. Call the appropriate tool AS YOUR FIRST ACTION — output NO text before the tool call.
2. Do this even if you notice issues (negative balance, unusual amount, account name ambiguity).
   The tool handles ALL validation and will surface warnings in the preview card shown to the user.
3. NEVER respond with a text summary, advice, or account numbers instead of calling the tool.
4. NEVER invent account codes. The tool resolves account names — pass the user's words as-is.

SLOT-FILLING PROTOCOL — follow this for write requests:
1. Extract every field the user already provided.
2. Infer what you can: today's date is {today}, default currency is USD, use accounts from the snapshot above.
3. Call the tool with what you have. If required fields are truly missing (e.g., no amount given at all),
   ask for EXACTLY ONE missing field before calling — never ask for multiple things in one message.
4. When asking for an account, include 2–3 specific suggestions from the accounts listed above.
5. NEVER guess amounts. NEVER invent account codes.

ACCOUNT RESOLUTION:
Pass the user's exact wording as the account_name (e.g. "the rent account", "put it against sales", "checking").
The tool resolves these semantically. It will return a clarification request if a name is ambiguous — relay
that question to the user verbatim. Do NOT pre-validate account names yourself.

FX / EXCHANGE RATE QUESTIONS:
You have two tools for currency exchange rates: get_exchange_rate (one pair)
and list_exchange_rates (all rates from one base). Rules:
1. ALWAYS call one of these tools for any FX question. NEVER state a rate from
   memory or training data, even if you think you know it. FX rates change
   daily and inventing them is harmful.
2. Supports any pair the user asks for: USD/EUR, INR/CAD, EUR/GBP, JPY/AUD,
   exotic pairs like BRL/ZAR, etc. The tool covers 200+ currencies.
3. Convert natural language dates ("today", "yesterday", "last Thursday",
   "April 15") to ISO YYYY-MM-DD before calling. Today is {today}; use that
   to anchor relative dates. Future dates are not supported.
4. ALWAYS cite the source from the tool's response (e.g. "source:
   fawazahmed0/currency-api as of 2026-04-22"). Do not paraphrase or omit it.
5. If the tool returns an `error` field, relay that error verbatim to the
   user. Do not fall back to a guessed rate.

GENERAL GUIDELINES:
- Be precise with numbers. Use the actual data from the tools you run.
- For write actions, always show a clear preview and wait for confirmation before executing.
- Keep responses concise and professional.
"""


async def run_agent(
    message: str,
    session_id: str,
    company_id: str,
    user_id: str,
    role: str = "user",
    confirm_action_id: Optional[str] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Main agent execution loop. Yields SSE-compatible event dicts.

    Event types:
      { type: "text",                content: str }
      { type: "tool_call",           name: str, args: dict }
      { type: "tool_result",         name: str, result: dict }
      { type: "confirmation_request", action_id, preview, message }
      { type: "done",                session_id: str }
      { type: "error",               message: str }
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        yield {"type": "error", "message": "ANTHROPIC_API_KEY is not configured."}
        return

    import anthropic
    client = anthropic.AsyncAnthropic(api_key=api_key)

    # Handle pre-confirmed action (user clicked Approve in the UI)
    if confirm_action_id:
        async for event in _execute_confirmed_action(confirm_action_id, company_id, user_id, session_id):
            yield event
        return

    # Build system prompt with live financial context
    try:
        ctx = build_financial_context(company_id)
        financial_context_str = build_context_string(ctx)
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
            company_name=ctx["company"].get("name", "your company"),
            financial_context=financial_context_str,
            today=__import__("datetime").date.today().isoformat(),
        )
    except Exception:
        system_prompt = "You are Fintra AI, an expert accounting assistant."

    # Cache the system prompt across turns — saves tokens on repeated context
    system_with_cache = [
        {
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }
    ]

    # Persist user message and build history
    save_user_message(session_id, company_id, message)
    messages = get_anthropic_messages(session_id, company_id)
    context = {"company_id": company_id, "user_id": user_id, "role": role}

    # ── Intent classification (Haiku 4.5) ─────────────────────────────────────
    # Extract recent text turns for classifier context
    simple_history: List[Dict] = []
    for m in messages[:-1][-4:]:
        if isinstance(m.get("content"), str):
            simple_history.append({"role": m["role"], "content": m["content"]})

    intent = await classify_intent(message, simple_history)
    print(
        f"[agent] intent={intent!r} history_len={len(simple_history)} "
        f"msg={message[:80]!r}",
        flush=True,
    )

    # Smalltalk: skip tool orchestration, respond directly
    if intent == "smalltalk":
        accumulated = ""
        try:
            async with client.messages.stream(
                model=_MODEL_REASONING,
                max_tokens=256,
                system=system_with_cache,
                messages=messages,
            ) as stream:
                async for event in stream:
                    if (
                        event.type == "content_block_delta"
                        and event.delta.type == "text_delta"
                    ):
                        accumulated += event.delta.text
                        yield {"type": "text", "content": event.delta.text}
        except Exception as e:
            yield {"type": "error", "message": str(e)}
            return
        if accumulated:
            save_assistant_message(session_id, company_id, accumulated)
        yield {"type": "done", "session_id": session_id}
        return

    # ── Agentic tool-use loop ──────────────────────────────────────────────────
    tools = get_tools_for_anthropic()

    # Force tool use on the first iteration for write/workflow/clarification intents.
    # "clarification" is included because slot-fill answers (e.g. "the rent account")
    # should re-enter the write flow, not be answered as prose.
    # For unambiguous journal requests, point directly at create_journal_entry —
    # that's the strongest signal the API supports and rules out "wrong tool" failures.
    first_iter_tool_choice = (
        _pick_forced_tool(message)
        if intent in ("write", "workflow", "clarification")
        else {"type": "auto"}
    )
    print(f"[agent] first_iter_tool_choice={first_iter_tool_choice}", flush=True)

    for iteration in range(MAX_TOOL_ITERATIONS):
        tool_choice = first_iter_tool_choice if iteration == 0 else {"type": "auto"}
        try:
            accumulated_text = ""
            tool_use_blocks: List[Dict] = []
            current_tool: Optional[Dict] = None

            async with client.messages.stream(
                model=_MODEL_REASONING,
                max_tokens=2048,
                system=system_with_cache,
                tools=tools if tools else [],
                messages=messages,
                tool_choice=tool_choice,
            ) as stream:

                async for event in stream:
                    etype = event.type

                    if etype == "content_block_start":
                        blk = event.content_block
                        if blk.type == "tool_use":
                            current_tool = {
                                "type": "tool_use",
                                "id": blk.id,
                                "name": blk.name,
                                "input": {},
                                "_raw": "",
                            }
                            yield {"type": "tool_call", "name": blk.name, "args": {}}
                        else:
                            current_tool = None

                    elif etype == "content_block_delta":
                        delta = event.delta
                        if delta.type == "text_delta":
                            accumulated_text += delta.text
                            # Suppress pre-tool text on the forced first iteration —
                            # tool_choice="any" can still produce text before the call.
                            if tool_choice.get("type") != "any":
                                yield {"type": "text", "content": delta.text}
                        elif delta.type == "input_json_delta" and current_tool:
                            current_tool["_raw"] += delta.partial_json

                    elif etype == "content_block_stop":
                        if current_tool:
                            raw = current_tool.pop("_raw", "{}")
                            try:
                                current_tool["input"] = json.loads(raw) if raw else {}
                            except json.JSONDecodeError:
                                current_tool["input"] = {}
                            tool_use_blocks.append(current_tool)
                            current_tool = None

                final_msg = await stream.get_final_message()
                stop_reason = final_msg.stop_reason

        except Exception as e:
            yield {"type": "error", "message": str(e)}
            return

        # Pure text response — save and exit
        if stop_reason == "end_turn" or not tool_use_blocks:
            if accumulated_text:
                save_assistant_message(session_id, company_id, accumulated_text)
            yield {"type": "done", "session_id": session_id}
            return

        # Tool use — save assistant turn and execute each tool
        save_assistant_message(
            session_id, company_id,
            accumulated_text,
            tool_use_blocks=tool_use_blocks,
        )

        tool_results: List[Dict] = []

        for tb in tool_use_blocks:
            tool_name = tb["name"]
            args = tb["input"]
            tool_id = tb["id"]

            yield {"type": "tool_call", "name": tool_name, "args": args}

            tool_result = await execute_tool(tool_name, args, context)
            result_payload = tool_result.get("result", tool_result)
            yield {"type": "tool_result", "name": tool_name, "result": tool_result}

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": json.dumps(result_payload),
            })

            # Confirmation gate for write operations
            tool_def = get_tool(tool_name)
            if (
                tool_def
                and tool_def.requires_confirmation
                and isinstance(result_payload, dict)
                and result_payload.get("ready_to_create")
            ):
                action_id = _store_pending_action(
                    session_id=session_id,
                    company_id=company_id,
                    user_id=user_id,
                    tool_name=tool_name,
                    arguments={
                        **args,
                        "resolved_lines": result_payload.get("resolved_lines", []),
                    },
                    preview_json=result_payload.get("preview"),
                    embedding_match_scores=result_payload.get("embedding_match_scores", {}),
                )
                preview = result_payload.get("preview", {})
                confirm_message = result_payload.get(
                    "confirmation_message", "Do you want to proceed?"
                )

                save_tool_results(session_id, company_id, tool_results)
                save_assistant_message(session_id, company_id, confirm_message)

                yield {
                    "type": "confirmation_request",
                    "action_id": action_id,
                    "preview": preview,
                    "message": confirm_message,
                }
                yield {"type": "done", "session_id": session_id}
                return

        save_tool_results(session_id, company_id, tool_results)
        messages = get_anthropic_messages(session_id, company_id)

    yield {
        "type": "text",
        "content": "I've reached the maximum number of tool steps. Please try a more focused question.",
    }
    yield {"type": "done", "session_id": session_id}


# ── Confirmed action handler ───────────────────────────────────────────────────

async def _execute_confirmed_action(
    action_id: str,
    company_id: str,
    user_id: str,
    session_id: str,
) -> AsyncGenerator[Dict[str, Any], None]:
    row = supabase.table("agent_actions")\
        .select("*")\
        .eq("id", action_id)\
        .eq("company_id", company_id)\
        .eq("status", "pending_confirmation")\
        .execute()

    if not row.data:
        yield {"type": "error", "message": "Action not found or already processed."}
        return

    action = row.data[0]
    tool_name = action["tool_name"]
    arguments = action.get("arguments", {})
    context = {"company_id": company_id, "user_id": user_id, "role": "user"}

    supabase.table("agent_actions")\
        .update({
            "status": "confirmed",
            "confirmed_by": user_id,
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
        })\
        .eq("id", action_id)\
        .execute()

    handler_map = {
        "create_journal_entry": _import_confirmed_journal_handler,
    }
    handler_fn = handler_map.get(tool_name)
    if not handler_fn:
        yield {"type": "error", "message": f"No confirmed handler for tool: {tool_name}"}
        return

    try:
        handler = handler_fn()
        result = await handler(arguments, context)

        supabase.table("agent_actions")\
            .update({
                "status": "executed",
                "result": result,
                "executed_at": datetime.now(timezone.utc).isoformat(),
            })\
            .eq("id", action_id)\
            .execute()

        msg = result.get("message", "Action completed successfully.")
        yield {"type": "text", "content": msg}
        save_assistant_message(session_id, company_id, msg)

    except Exception as e:
        supabase.table("agent_actions")\
            .update({"status": "error", "result": {"error": str(e)}})\
            .eq("id", action_id)\
            .execute()
        yield {"type": "error", "message": str(e)}

    yield {"type": "done", "session_id": session_id}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _pick_forced_tool(message: str) -> dict:
    """Return the tightest tool_choice for write intents on iter 0.
    When the message unambiguously targets journal creation, lock to that tool.
    Otherwise fall back to 'any' (model picks from the full registry)."""
    m = message.lower()
    journal_signals = ("journal", "debit ", "credit ", "record ", "post a", "post the")
    if any(k in m for k in journal_signals):
        return {"type": "tool", "name": "create_journal_entry"}
    return {"type": "any"}


def _import_confirmed_journal_handler():
    from lib.agent.tools.journal_tool import handle_confirmed_create_journal_entry
    return handle_confirmed_create_journal_entry


def _store_pending_action(
    session_id: str,
    company_id: str,
    user_id: str,
    tool_name: str,
    arguments: Dict[str, Any],
    preview_json: Optional[Dict] = None,
    embedding_match_scores: Optional[Dict] = None,
) -> str:
    """Save a pending action to agent_actions and return its ID."""
    row = supabase.table("agent_actions").insert({
        "session_id": session_id,
        "company_id": company_id,
        "tool_name": tool_name,
        "arguments": arguments,
        "status": "pending_confirmation",
        "created_by": user_id,
        "source": "ai_agent",
        "conversation_id": session_id,
        "preview_json": preview_json,
        "embedding_match_scores": embedding_match_scores or {},
        "model_versions": {
            "reasoning": _MODEL_REASONING,
            "classifier": _MODEL_CLASSIFIER,
        },
    }).execute()
    if not row.data:
        raise RuntimeError("Failed to store pending action")
    return row.data[0]["id"]
