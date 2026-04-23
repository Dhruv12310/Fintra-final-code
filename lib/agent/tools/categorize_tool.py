"""
Agent tool: AI bank transaction categorization.
Loads unreviewed transactions, runs rule engine + OpenAI, writes suggested_account_id.

Confidence thresholds:
  >= 0.85  → auto-apply (writes to DB immediately, shows count in response)
  0.5–0.84 → suggest only (writes suggested_account_id, user accepts/rejects in UI)
  < 0.5    → skip (no suggestion written)
"""

from typing import Dict, Any, List
from lib.agent.tools.registry import AgentTool, register_tool
from lib.categorization import categorize_transaction
from database import supabase


async def handle_categorize_transactions(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Categorize all unreviewed bank transactions for the company.
    Returns a summary of what was categorized.
    """
    company_id = context["company_id"]
    bank_account_id = arguments.get("bank_account_id")
    limit = int(arguments.get("limit", 100))

    # Load unreviewed transactions
    q = supabase.table("bank_transactions")\
        .select("id, name, merchant_name, amount, posted_date, raw, bank_accounts(name)")\
        .eq("company_id", company_id)\
        .eq("status", "unreviewed")\
        .is_("user_selected_account_id", "null")\
        .order("posted_date", desc=True)\
        .limit(limit)

    if bank_account_id:
        q = q.eq("bank_account_id", bank_account_id)

    txns = q.execute().data or []

    if not txns:
        return {"message": "No unreviewed transactions to categorize.", "count": 0}

    # Load COA once (shared across all transactions)
    accounts = supabase.table("accounts")\
        .select("id, account_code, account_name, account_type, account_subtype")\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .execute().data or []

    # Load historical corrections once
    from lib.categorization import _load_historical
    historical = _load_historical(company_id)

    auto_applied = []
    suggested = []
    skipped = []

    for txn in txns:
        result = await categorize_transaction(
            company_id=company_id,
            txn=txn,
            accounts=accounts,
            historical=historical,
        )

        if not result:
            skipped.append(txn["id"])
            continue

        confidence = result.get("confidence", 0)
        account_id = result["account_id"]

        if confidence >= 0.85:
            # Auto-apply: write suggested_account_id
            supabase.table("bank_transactions").update({
                "suggested_account_id": account_id,
            }).eq("id", txn["id"]).execute()
            auto_applied.append({
                "txn_id": txn["id"],
                "name": txn.get("name"),
                "account_name": result.get("account_name"),
                "confidence": round(confidence, 2),
                "source": result.get("source"),
            })
        elif confidence >= 0.5:
            # Suggest only
            supabase.table("bank_transactions").update({
                "suggested_account_id": account_id,
            }).eq("id", txn["id"]).execute()
            suggested.append({
                "txn_id": txn["id"],
                "name": txn.get("name"),
                "account_name": result.get("account_name"),
                "confidence": round(confidence, 2),
                "source": result.get("source"),
            })
        else:
            skipped.append(txn["id"])

    total = len(txns)
    return {
        "total_processed": total,
        "auto_applied": len(auto_applied),
        "suggested": len(suggested),
        "skipped": len(skipped),
        "auto_applied_details": auto_applied[:10],  # cap for readability
        "suggested_details": suggested[:10],
        "message": (
            f"Categorized {total} transaction(s): "
            f"{len(auto_applied)} auto-applied (high confidence), "
            f"{len(suggested)} suggested (review needed), "
            f"{len(skipped)} skipped (low confidence)."
        ),
    }


async def handle_accept_suggestion(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Accept the AI suggestion for a specific transaction (moves suggested → user_selected)."""
    company_id = context["company_id"]
    user_id = context["user_id"]
    txn_id = arguments.get("transaction_id")

    if not txn_id:
        return {"error": "transaction_id is required"}

    txn = supabase.table("bank_transactions")\
        .select("id, name, merchant_name, suggested_account_id")\
        .eq("id", txn_id)\
        .eq("company_id", company_id)\
        .single().execute()

    if not txn.data or not txn.data.get("suggested_account_id"):
        return {"error": "Transaction not found or no suggestion exists"}

    account_id = txn.data["suggested_account_id"]

    # Accept: copy suggestion → user_selected
    supabase.table("bank_transactions").update({
        "user_selected_account_id": account_id,
    }).eq("id", txn_id).execute()

    # Learn from acceptance
    from lib.categorization import learn_from_correction
    learn_from_correction(company_id, txn.data, account_id, user_id)

    return {"ok": True, "transaction_id": txn_id, "message": "Suggestion accepted and rule learned."}


def register():
    """Register categorization tools."""
    register_tool(AgentTool(
        name="categorize_transactions",
        description=(
            "Automatically categorize unreviewed bank transactions using AI and learned rules. "
            "High-confidence results (>85%) are applied immediately. "
            "Medium-confidence (50–85%) are shown as suggestions for review. "
            "Optionally filter to a specific bank account."
        ),
        parameters={
            "type": "object",
            "properties": {
                "bank_account_id": {
                    "type": "string",
                    "description": "Optional: only categorize transactions from this bank account ID"
                },
                "limit": {
                    "type": "integer",
                    "description": "Max transactions to process in one run. Default 100."
                },
            },
        },
        handler=handle_categorize_transactions,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="accept_transaction_suggestion",
        description="Accept the AI-suggested category for a specific bank transaction and learn from it.",
        parameters={
            "type": "object",
            "properties": {
                "transaction_id": {"type": "string", "description": "The bank transaction ID to accept"},
            },
            "required": ["transaction_id"],
        },
        handler=handle_accept_suggestion,
        requires_confirmation=False,
    ))
