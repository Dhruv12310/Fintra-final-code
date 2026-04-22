"""
Agent tool: Smart bank reconciliation.

Tools:
  auto_match_transactions — match bank feed transactions to journal entries, returns proposals
  complete_reconciliation — mark a reconciliation session as complete (requires_confirmation=True)
  get_reconciliation_status — read-only: show current reconciliation state for a bank account
"""

from typing import Dict, Any, List, Optional
from datetime import date, timedelta
from database import supabase
from lib.agent.tools.registry import AgentTool, register_tool


def _similarity_score(a: str, b: str) -> float:
    """Simple word-overlap similarity between two strings."""
    if not a or not b:
        return 0.0
    a_words = set(a.lower().split())
    b_words = set(b.lower().split())
    intersection = a_words & b_words
    union = a_words | b_words
    return len(intersection) / len(union) if union else 0.0


async def handle_auto_match_transactions(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Auto-match bank transactions to journal entry lines.
    Matches by: exact amount (required) + date proximity + description similarity.
    """
    company_id = context["company_id"]
    bank_account_id = arguments.get("bank_account_id")
    period_start = arguments.get("period_start")
    period_end = arguments.get("period_end") or str(date.today())
    session_id = arguments.get("session_id")

    # Determine period start
    if not period_start:
        # Default to first of current month
        today = date.today()
        period_start = str(today.replace(day=1))

    # Get bank account info (need linked GL account)
    if not bank_account_id:
        # Try to get from session
        if session_id:
            sess = supabase.table("reconciliation_sessions")\
                .select("bank_account_id, statement_start, statement_end")\
                .eq("id", session_id)\
                .single().execute()
            if sess.data:
                bank_account_id = sess.data["bank_account_id"]
                period_start = sess.data.get("statement_start", period_start)
                period_end = sess.data.get("statement_end", period_end)

    if not bank_account_id:
        # List available bank accounts
        accts = supabase.table("bank_accounts")\
            .select("id, name, mask, institution_name")\
            .eq("company_id", company_id)\
            .execute().data or []
        if not accts:
            return {"error": "No bank accounts connected. Link a bank first."}
        return {
            "error": "Specify bank_account_id.",
            "available_accounts": [
                {"id": a["id"], "name": f"{a.get('institution_name', 'Bank')} - {a['name']}{' ···' + a['mask'] if a.get('mask') else ''}"}
                for a in accts
            ],
        }

    bank_acct = supabase.table("bank_accounts")\
        .select("id, name, mask, linked_account_id")\
        .eq("id", bank_account_id)\
        .single().execute()
    if not bank_acct.data:
        return {"error": f"Bank account {bank_account_id} not found."}

    bank_gl_id = bank_acct.data.get("linked_account_id")

    # Load posted bank transactions in period
    bank_txns = supabase.table("bank_transactions")\
        .select("id, posted_date, name, merchant_name, amount, is_outflow")\
        .eq("company_id", company_id)\
        .eq("bank_account_id", bank_account_id)\
        .eq("status", "posted")\
        .gte("posted_date", period_start)\
        .lte("posted_date", period_end)\
        .execute().data or []

    if not bank_txns:
        return {
            "message": f"No posted bank transactions found for {period_start} to {period_end}.",
            "period_start": period_start,
            "period_end": period_end,
            "matched": 0,
            "unmatched": 0,
        }

    # Load journal entry lines for the bank's GL account in the same period
    if bank_gl_id:
        je_lines = supabase.table("journal_entry_lines")\
            .select("id, debit, credit, description, journal_entries(id, entry_date, memo, journal_number)")\
            .eq("account_id", bank_gl_id)\
            .gte("journal_entries.entry_date", period_start)\
            .lte("journal_entries.entry_date", period_end)\
            .execute().data or []
    else:
        je_lines = []

    # Get already-cleared items for this session (to avoid re-matching)
    if session_id:
        cleared = supabase.table("reconciliation_items")\
            .select("bank_transaction_id")\
            .eq("reconciliation_session_id", session_id)\
            .eq("cleared", True)\
            .execute().data or []
        cleared_txn_ids = {c["bank_transaction_id"] for c in cleared}
    else:
        cleared_txn_ids = set()

    # Match logic
    matches = []
    unmatched = []
    used_je_lines = set()

    for txn in bank_txns:
        if txn["id"] in cleared_txn_ids:
            continue

        txn_amount = txn["amount"]
        txn_date = date.fromisoformat(txn["posted_date"])
        txn_desc = (txn.get("merchant_name") or txn.get("name") or "").lower()

        best_match = None
        best_score = 0.0

        for jel in je_lines:
            if jel["id"] in used_je_lines:
                continue

            je = jel.get("journal_entries") or {}
            je_date_str = je.get("entry_date")
            if not je_date_str:
                continue

            # Amount must match exactly (outflow ↔ credit, inflow ↔ debit)
            if txn["is_outflow"]:
                je_amount = float(jel.get("credit") or 0)
            else:
                je_amount = float(jel.get("debit") or 0)

            if abs(je_amount - txn_amount) > 0.01:
                continue

            # Date proximity score (within 7 days = 0.5, same day = 1.0)
            je_date = date.fromisoformat(je_date_str)
            day_diff = abs((txn_date - je_date).days)
            if day_diff > 7:
                date_score = 0.2
            elif day_diff == 0:
                date_score = 1.0
            else:
                date_score = max(0.3, 1.0 - day_diff * 0.1)

            # Description similarity
            je_desc = (je.get("memo") or jel.get("description") or "").lower()
            desc_score = _similarity_score(txn_desc, je_desc)

            total_score = (date_score * 0.5) + (desc_score * 0.3) + 0.2  # base 0.2 for amount match

            if total_score > best_score:
                best_score = total_score
                best_match = {"je_line": jel, "je": je, "score": total_score}

        if best_match and best_score >= 0.4:
            used_je_lines.add(best_match["je_line"]["id"])
            je = best_match["je"]
            matches.append({
                "bank_transaction_id": txn["id"],
                "bank_date": txn["posted_date"],
                "bank_description": txn.get("merchant_name") or txn["name"],
                "amount": txn_amount,
                "direction": "outflow" if txn["is_outflow"] else "inflow",
                "journal_entry_id": je.get("id"),
                "journal_number": je.get("journal_number"),
                "journal_date": je.get("entry_date"),
                "journal_memo": je.get("memo"),
                "confidence": round(best_score, 2),
                "confidence_label": "high" if best_score >= 0.8 else "medium" if best_score >= 0.6 else "low",
            })
        else:
            unmatched.append({
                "bank_transaction_id": txn["id"],
                "bank_date": txn["posted_date"],
                "bank_description": txn.get("merchant_name") or txn["name"],
                "amount": txn_amount,
                "direction": "outflow" if txn["is_outflow"] else "inflow",
            })

    total = len(bank_txns) - len(cleared_txn_ids)
    match_rate = round(len(matches) / total * 100, 1) if total else 0

    return {
        "period": f"{period_start} to {period_end}",
        "bank_account": bank_acct.data["name"],
        "total_transactions": total,
        "already_cleared": len(cleared_txn_ids),
        "matched": len(matches),
        "unmatched": len(unmatched),
        "match_rate": match_rate,
        "matches": matches,
        "unmatched_transactions": unmatched[:10],
        "message": (
            f"Auto-matched {len(matches)}/{total} transactions ({match_rate}%). "
            f"{len(unmatched)} need manual review."
            + (" Use complete_reconciliation to finalize." if len(unmatched) == 0 else "")
        ),
    }


async def handle_get_reconciliation_status(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Get the current reconciliation status for a bank account."""
    company_id = context["company_id"]
    bank_account_id = arguments.get("bank_account_id")

    sessions = supabase.table("reconciliation_sessions")\
        .select("*")\
        .eq("company_id", company_id)

    if bank_account_id:
        sessions = sessions.eq("bank_account_id", bank_account_id)

    sessions = sessions.order("statement_end", desc=True).limit(5).execute().data or []

    if not sessions:
        return {"message": "No reconciliation sessions found. Start one in the Banking page.", "sessions": []}

    formatted = []
    for s in sessions:
        items_r = supabase.table("reconciliation_items")\
            .select("id, cleared")\
            .eq("reconciliation_session_id", s["id"])\
            .execute().data or []
        cleared_count = sum(1 for i in items_r if i["cleared"])
        formatted.append({
            "session_id": s["id"],
            "period": f"{s.get('statement_start', '?')} to {s.get('statement_end', '?')}",
            "status": s["status"],
            "statement_ending_balance": s.get("statement_ending_balance"),
            "cleared_items": cleared_count,
            "total_items": len(items_r),
            "difference": s.get("difference"),
        })

    return {
        "sessions": formatted,
        "message": f"{len(sessions)} reconciliation session(s) found.",
    }


async def handle_complete_reconciliation(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Mark matched transactions as cleared and complete the reconciliation session."""
    company_id = context["company_id"]
    session_id = arguments.get("session_id")
    match_data = arguments.get("matches", [])

    if not session_id:
        return {"error": "session_id is required."}

    # Verify session belongs to company
    sess = supabase.table("reconciliation_sessions")\
        .select("id, status, statement_ending_balance, bank_account_id")\
        .eq("id", session_id)\
        .single().execute()
    if not sess.data:
        return {"error": f"Reconciliation session {session_id} not found."}
    if sess.data["status"] == "completed":
        return {"error": "Session is already completed."}

    # Insert cleared items
    cleared = 0
    for match in match_data:
        txn_id = match.get("bank_transaction_id")
        if not txn_id:
            continue
        # Upsert to avoid duplicates
        existing = supabase.table("reconciliation_items")\
            .select("id")\
            .eq("reconciliation_session_id", session_id)\
            .eq("bank_transaction_id", txn_id)\
            .execute().data
        if not existing:
            supabase.table("reconciliation_items").insert({
                "reconciliation_session_id": session_id,
                "bank_transaction_id": txn_id,
                "cleared": True,
            }).execute()
            cleared += 1

    # Mark session complete
    supabase.table("reconciliation_sessions")\
        .update({"status": "completed"})\
        .eq("id", session_id)\
        .execute()

    return {
        "ok": True,
        "session_id": session_id,
        "cleared_count": cleared,
        "message": f"Reconciliation complete. {cleared} transactions cleared and matched.",
    }


def register():
    """Register reconciliation agent tools."""
    register_tool(AgentTool(
        name="auto_match_transactions",
        description=(
            "Auto-match posted bank transactions to journal entries by amount, date, and description. "
            "Returns match proposals with confidence scores (high/medium/low). "
            "Specify a bank account and optional date range or existing session ID."
        ),
        parameters={
            "type": "object",
            "properties": {
                "bank_account_id": {
                    "type": "string",
                    "description": "UUID of the bank account to reconcile",
                },
                "session_id": {
                    "type": "string",
                    "description": "Existing reconciliation session ID (optional)",
                },
                "period_start": {
                    "type": "string",
                    "description": "Start date YYYY-MM-DD. Defaults to first of current month.",
                },
                "period_end": {
                    "type": "string",
                    "description": "End date YYYY-MM-DD. Defaults to today.",
                },
            },
        },
        handler=handle_auto_match_transactions,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="get_reconciliation_status",
        description="Get the reconciliation status for bank accounts. Shows recent sessions, cleared item counts, and any outstanding differences.",
        parameters={
            "type": "object",
            "properties": {
                "bank_account_id": {
                    "type": "string",
                    "description": "Optional: filter to a specific bank account",
                },
            },
        },
        handler=handle_get_reconciliation_status,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="complete_reconciliation",
        description=(
            "Mark matched transactions as cleared and complete a reconciliation session. "
            "Pass the session ID and the list of matched transactions from auto_match_transactions."
        ),
        parameters={
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "UUID of the reconciliation session to complete",
                },
                "matches": {
                    "type": "array",
                    "description": "List of matched transactions to clear, from auto_match_transactions output",
                    "items": {
                        "type": "object",
                        "properties": {
                            "bank_transaction_id": {"type": "string"},
                        },
                    },
                },
            },
            "required": ["session_id", "matches"],
        },
        handler=handle_complete_reconciliation,
        requires_confirmation=True,
    ))
