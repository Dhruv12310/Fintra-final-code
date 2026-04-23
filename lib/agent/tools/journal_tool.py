"""
Agent tool: create journal entries from natural language.

Flow:
  1. Agent calls create_journal_entry with account names + amounts
  2. Tool resolves account names semantically (pgvector → fuzzy fallback)
  3. If ambiguous: returns clarification question with top-3 candidates
  4. If balanced: returns structured preview with warnings + unusual-pattern detection
  5. User approves in the chat UI (ConfirmationCard)
  6. Engine calls handle_confirmed_create_journal_entry to write to DB
"""

import datetime
from typing import Dict, Any, List

from lib.agent.tools.registry import AgentTool, register_tool
from lib.agent.resolver import resolve_account
from routes.journal_helpers import create_auto_journal_entry
from database import supabase


async def handle_create_journal_entry(
    arguments: Dict[str, Any], context: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Phase 1: resolve accounts, validate balance, build preview.
    Actual DB write happens in handle_confirmed_create_journal_entry.
    """
    company_id = context["company_id"]
    lines_input: List[Dict] = arguments.get("lines", [])
    memo: str = arguments.get("memo", "Agent-created journal entry")
    entry_date: str = arguments.get("entry_date") or datetime.date.today().isoformat()

    resolved_lines: List[Dict] = []
    resolution_errors: List[str] = []
    embedding_scores: Dict[str, Any] = {}

    for line in lines_input:
        account_ref = line.get("account_name", "")
        result = resolve_account(company_id, account_ref)

        if result["status"] == "resolved":
            entity = result["entity"]
            resolved_lines.append({
                "account_id": entity.id,
                "account_name": entity.name,
                "debit": float(line.get("debit") or 0),
                "credit": float(line.get("credit") or 0),
                "description": line.get("description", memo),
            })
            embedding_scores[account_ref] = {
                "matched_to": entity.name,
                "score": entity.score,
            }

        elif result["status"] == "ambiguous":
            candidates = result["candidates"]
            candidate_list = "\n".join(
                f"  • {c.name}  (confidence {c.score:.0%})" for c in candidates
            )
            return {
                "needs_clarification": True,
                "clarification": (
                    f"I found multiple accounts matching '{account_ref}':\n{candidate_list}\n\n"
                    f"Which one did you mean? Reply with the name or account code."
                ),
                "candidates": [
                    {"id": c.id, "name": c.name, "score": c.score} for c in candidates
                ],
                "field": "account_name",
                "original_reference": account_ref,
            }

        else:  # "none"
            resolution_errors.append(
                f"No account found matching '{account_ref}'. "
                + (result.get("suggestion") or "Check your Chart of Accounts.")
            )

    if resolution_errors:
        return {"error": "; ".join(resolution_errors)}

    total_debit = sum(l["debit"] for l in resolved_lines)
    total_credit = sum(l["credit"] for l in resolved_lines)

    if abs(total_debit - total_credit) > 0.01:
        return {
            "error": (
                f"Journal entry is not balanced. "
                f"Debits ${total_debit:,.2f} ≠ Credits ${total_credit:,.2f}. "
                f"Adjust the amounts so they match."
            )
        }

    # Detect unusual patterns per line
    warnings: List[str] = []
    unusual_patterns: List[str] = []
    for line in resolved_lines:
        amount = max(line["debit"], line["credit"])
        for p in _detect_unusual_patterns(line["account_id"], line["account_name"], amount):
            if "last used" in p:
                warnings.append(p)
            else:
                unusual_patterns.append(p)

    preview_lines = [
        {
            "account": {"id": l["account_id"], "name": l["account_name"]},
            "debit": l["debit"],
            "credit": l["credit"],
        }
        for l in resolved_lines
    ]

    return {
        "preview": {
            "type": "journal_entry",
            "date": entry_date,
            "memo": memo,
            "lines": preview_lines,
            "balance_check": {
                "debits_total": round(total_debit, 2),
                "credits_total": round(total_credit, 2),
                "balanced": True,
            },
            "warnings": warnings,
            "unusual_patterns": unusual_patterns,
        },
        "ready_to_create": True,
        "embedding_match_scores": embedding_scores,
        "resolved_lines": resolved_lines,
        "confirmation_message": _build_confirm_message(
            entry_date, memo, resolved_lines, total_debit, warnings, unusual_patterns
        ),
    }


async def handle_confirmed_create_journal_entry(
    arguments: Dict[str, Any], context: Dict[str, Any]
) -> Dict[str, Any]:
    """Phase 2: write to DB after user confirmation."""
    company_id = context["company_id"]
    user_id = context["user_id"]
    lines = arguments.get("resolved_lines") or arguments.get("lines", [])
    memo = arguments.get("memo", "Agent-created journal entry")
    entry_date = arguments.get("entry_date") or datetime.date.today().isoformat()

    je = create_auto_journal_entry(
        company_id=company_id,
        entry_date=entry_date,
        memo=memo,
        reference="AI-Agent",
        source="manual",
        lines=lines,
        created_by=user_id,
    )
    return {
        "created": True,
        "journal_entry_id": je["id"],
        "journal_number": je["journal_number"],
        "message": f"Journal entry {je['journal_number']} created and posted successfully.",
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _build_confirm_message(
    entry_date: str,
    memo: str,
    lines: List[Dict],
    total: float,
    warnings: List[str],
    unusual_patterns: List[str],
) -> str:
    msg = f"Ready to create this journal entry:\n{entry_date} — {memo}\n\n"
    for l in lines:
        if l["debit"]:
            msg += f"  DR {l['account_name']}: ${l['debit']:,.2f}\n"
        else:
            msg += f"  CR {l['account_name']}: ${l['credit']:,.2f}\n"
    msg += f"\nTotal: ${total:,.2f}"
    if warnings:
        msg += "\n\n⚠️ " + "\n⚠️ ".join(warnings)
    if unusual_patterns:
        msg += "\n\n🔍 " + "\n🔍 ".join(unusual_patterns)
    return msg


def _detect_unusual_patterns(
    account_id: str, account_name: str, amount: float
) -> List[str]:
    """Compare amount to historical lines for this account. Returns human-readable findings."""
    patterns: List[str] = []
    if amount <= 0:
        return patterns

    try:
        lines_resp = supabase.table("journal_lines")\
            .select("debit, credit, journal_entry_id")\
            .eq("account_id", account_id)\
            .order("created_at", desc=True)\
            .limit(30)\
            .execute()
        lines = lines_resp.data or []
        if not lines:
            return patterns

        je_ids = list({l["journal_entry_id"] for l in lines})
        entries_resp = supabase.table("journal_entries")\
            .select("id, entry_date, status")\
            .in_("id", je_ids)\
            .eq("status", "posted")\
            .execute()
        posted = {e["id"]: e for e in (entries_resp.data or [])}
        posted_lines = [l for l in lines if l["journal_entry_id"] in posted]

        if not posted_lines:
            return patterns

        # Unusual amount — need ≥5 data points to avoid false positives
        amounts = [
            max(float(l.get("debit") or 0), float(l.get("credit") or 0))
            for l in posted_lines
        ]
        amounts = [a for a in amounts if a > 0]
        if len(amounts) >= 5:
            mean = sum(amounts) / len(amounts)
            if mean > 0 and amount > 3 * mean:
                patterns.append(
                    f"Amount ${amount:,.2f} is {amount / mean:.1f}x your typical "
                    f"entry (avg ${mean:,.2f}) for {account_name}"
                )

        # Last-used date
        dates: List[datetime.date] = []
        for l in posted_lines:
            ds = posted.get(l["journal_entry_id"], {}).get("entry_date")
            if ds:
                try:
                    dates.append(datetime.date.fromisoformat(ds))
                except Exception:
                    pass
        if dates:
            last = max(dates)
            days = (datetime.date.today() - last).days
            if days > 90:
                patterns.append(
                    f"{account_name} was last used {days} days ago (on {last})"
                )

    except Exception:
        pass

    return patterns


def register():
    register_tool(AgentTool(
        name="create_journal_entry",
        description=(
            "Create a double-entry journal entry. "
            "Provide a list of lines with account names (or codes), debit amounts, and credit amounts. "
            "Total debits must equal total credits. "
            "Account names can be vague — the tool resolves them semantically. "
            "Shows a preview for confirmation before saving."
        ),
        parameters={
            "type": "object",
            "properties": {
                "memo": {
                    "type": "string",
                    "description": "Description or memo for the journal entry",
                },
                "entry_date": {
                    "type": "string",
                    "description": "Date in YYYY-MM-DD format. Defaults to today.",
                },
                "lines": {
                    "type": "array",
                    "description": "List of journal lines",
                    "items": {
                        "type": "object",
                        "properties": {
                            "account_name": {
                                "type": "string",
                                "description": (
                                    "Account name, code, or natural-language description "
                                    "(e.g. 'Rent Expense', '6100', 'the rent account', 'put it against sales')"
                                ),
                            },
                            "debit": {
                                "type": "number",
                                "description": "Debit amount (0 if this is a credit line)",
                            },
                            "credit": {
                                "type": "number",
                                "description": "Credit amount (0 if this is a debit line)",
                            },
                            "description": {
                                "type": "string",
                                "description": "Optional line-level description",
                            },
                        },
                        "required": ["account_name"],
                    },
                },
            },
            "required": ["memo", "lines"],
        },
        handler=handle_create_journal_entry,
        requires_confirmation=True,
    ))
