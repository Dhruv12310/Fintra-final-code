"""
Agent tool: Banking operations.

Tools:
  list_unreviewed_transactions — read-only: list pending bank transactions
  post_bank_transaction        — post a single transaction to journal (requires_confirmation=True)
"""

from typing import Dict, Any
from lib.agent.tools.registry import AgentTool, register_tool
from lib.agent.context import resolve_account_id
from database import supabase


async def handle_list_unreviewed_transactions(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """List unreviewed bank transactions."""
    company_id = context["company_id"]
    limit = int(arguments.get("limit", 20))
    bank_account_id = arguments.get("bank_account_id")

    q = supabase.table("bank_transactions")\
        .select("id, name, merchant_name, amount, posted_date, is_outflow, status, suggested_account_id, user_selected_account_id, bank_accounts(name, mask)")\
        .eq("company_id", company_id)\
        .eq("status", "unreviewed")\
        .order("posted_date", desc=True)\
        .limit(limit)

    if bank_account_id:
        q = q.eq("bank_account_id", bank_account_id)

    txns = q.execute().data or []

    if not txns:
        return {"message": "No unreviewed transactions.", "count": 0, "transactions": []}

    total_in = sum(t["amount"] for t in txns if not t["is_outflow"])
    total_out = sum(t["amount"] for t in txns if t["is_outflow"])

    formatted = [
        {
            "id": t["id"],
            "date": t["posted_date"],
            "description": t["name"],
            "merchant": t.get("merchant_name"),
            "amount": t["amount"],
            "direction": "outflow" if t["is_outflow"] else "inflow",
            "bank_account": ((t.get("bank_accounts") or {}).get("name", "") +
                             (f" ···{t['bank_accounts']['mask']}" if (t.get("bank_accounts") or {}).get("mask") else "")),
            "has_suggestion": bool(t.get("suggested_account_id")),
            "categorized": bool(t.get("user_selected_account_id")),
        }
        for t in txns
    ]

    return {
        "count": len(txns),
        "total_inflow": total_in,
        "total_outflow": total_out,
        "transactions": formatted,
        "message": (
            f"{len(txns)} unreviewed transaction(s): "
            f"${total_out:,.2f} out / ${total_in:,.2f} in. "
            f"{sum(1 for t in formatted if t['has_suggestion'])} have AI suggestions."
        ),
    }


async def handle_post_bank_transaction(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Post a bank transaction to the general journal."""
    company_id = context["company_id"]
    txn_id = arguments.get("transaction_id")
    account_name = arguments.get("account_name", "")
    memo = arguments.get("memo", "")

    if not txn_id:
        return {"error": "transaction_id is required."}

    txn_r = supabase.table("bank_transactions")\
        .select("id, name, merchant_name, amount, posted_date, is_outflow, status, bank_account_id, bank_accounts(name, linked_account_id)")\
        .eq("id", txn_id)\
        .eq("company_id", company_id)\
        .single().execute()

    if not txn_r.data:
        return {"error": f"Transaction {txn_id} not found."}

    txn = txn_r.data
    if txn["status"] == "posted":
        return {"error": "Transaction is already posted."}

    # Resolve offset GL account
    account_id = await resolve_account_id(company_id, account_name) if account_name else None
    if not account_id:
        return {"error": f"Could not find GL account matching '{account_name}'. Provide a valid account name or code."}

    # Get bank's linked GL account
    bank_gl_id = (txn.get("bank_accounts") or {}).get("linked_account_id")
    if not bank_gl_id:
        return {"error": "This bank account has no linked GL account. Link it in Banking settings first."}

    from routes.journal_helpers import create_auto_journal_entry
    amount = txn["amount"]
    txn_memo = memo or txn["name"]
    bank_name = (txn.get("bank_accounts") or {}).get("name", "Bank")

    # Outflow: DR expense/asset account, CR bank
    # Inflow: DR bank, CR income/liability account
    if txn["is_outflow"]:
        lines = [
            {"account_id": account_id, "debit": amount, "credit": 0, "description": txn_memo},
            {"account_id": bank_gl_id, "debit": 0, "credit": amount, "description": f"Payment from {bank_name}"},
        ]
        preview = f"Post outflow: DR {account_name} ${amount:,.2f} / CR {bank_name} ${amount:,.2f}"
    else:
        lines = [
            {"account_id": bank_gl_id, "debit": amount, "credit": 0, "description": f"Deposit to {bank_name}"},
            {"account_id": account_id, "debit": 0, "credit": amount, "description": txn_memo},
        ]
        preview = f"Post inflow: DR {bank_name} ${amount:,.2f} / CR {account_name} ${amount:,.2f}"

    je = create_auto_journal_entry(
        company_id=company_id,
        entry_date=txn["posted_date"],
        memo=txn_memo,
        reference=txn_id[:8],
        source="bank",
        lines=lines,
    )

    # Mark transaction as posted
    supabase.table("bank_transactions").update({
        "status": "posted",
        "user_selected_account_id": account_id,
        "linked_journal_entry_id": je["id"],
    }).eq("id", txn_id).execute()

    return {
        "ok": True,
        "transaction_id": txn_id,
        "journal_number": je.get("journal_number"),
        "preview": preview,
        "message": f"Transaction posted as {je.get('journal_number')}. {preview}.",
    }


def register():
    """Register banking agent tools."""
    register_tool(AgentTool(
        name="list_unreviewed_transactions",
        description=(
            "List unreviewed bank transactions that need to be categorized or posted. "
            "Shows AI suggestions where available. Optionally filter by bank account."
        ),
        parameters={
            "type": "object",
            "properties": {
                "bank_account_id": {
                    "type": "string",
                    "description": "Optional: filter to a specific bank account ID",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max transactions to return. Default 20.",
                    "default": 20,
                },
            },
        },
        handler=handle_list_unreviewed_transactions,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="post_bank_transaction",
        description=(
            "Post a single bank transaction to the general journal. "
            "Creates a double-entry: DR/CR the offset GL account and the bank's GL account. "
            "Requires the transaction ID and the GL account name to post against."
        ),
        parameters={
            "type": "object",
            "properties": {
                "transaction_id": {
                    "type": "string",
                    "description": "UUID of the bank transaction to post",
                },
                "account_name": {
                    "type": "string",
                    "description": "GL account name or code to post against (e.g. 'Office Supplies', '6200')",
                },
                "memo": {
                    "type": "string",
                    "description": "Optional memo for the journal entry",
                },
            },
            "required": ["transaction_id", "account_name"],
        },
        handler=handle_post_bank_transaction,
        requires_confirmation=True,
    ))
