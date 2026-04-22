"""
Read-only query tools for the agent.
These tools never modify data, so they don't require confirmation.
"""

from typing import Dict, Any
from lib.agent.tools.registry import AgentTool, register_tool
from lib.agent.context import build_financial_context
from database import supabase


async def handle_get_financial_summary(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Return a structured financial summary for the company."""
    company_id = context["company_id"]
    ctx = build_financial_context(company_id)
    return {
        "company_name": ctx["company"]["name"],
        "cash_balance": ctx["cash_balance"],
        "account_count": ctx["account_count"],
        "accounts_by_type": {
            t: {"count": d["count"], "total": round(d["total"], 2)}
            for t, d in ctx["accounts_by_type"].items()
        },
        "recent_journals": ctx["recent_journals"],
    }


async def handle_get_account_balance(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Return balance for a specific account or account type."""
    company_id = context["company_id"]
    account_name = arguments.get("account_name", "")
    account_type = arguments.get("account_type", "")

    q = supabase.table("accounts")\
        .select("account_code, account_name, account_type, account_subtype, current_balance")\
        .eq("company_id", company_id)

    if account_type:
        q = q.eq("account_type", account_type.lower())
    if account_name:
        q = q.ilike("account_name", f"%{account_name}%")

    rows = q.order("account_type").execute().data or []
    total = sum(float(r.get("current_balance") or 0) for r in rows)
    return {"accounts": rows, "total_balance": round(total, 2), "count": len(rows)}


async def handle_list_overdue_invoices(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """List unpaid invoices that are overdue, optionally filtered by days overdue."""
    from datetime import date
    company_id = context["company_id"]
    min_days = arguments.get("min_days_overdue", 0)
    today = date.today().isoformat()

    q = supabase.table("invoices")\
        .select("id, invoice_number, invoice_date, due_date, total, status, contacts(display_name)")\
        .eq("company_id", company_id)\
        .in_("status", ["posted", "sent"])\
        .lt("due_date", today)

    rows = q.order("due_date").execute().data or []

    if min_days > 0:
        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=min_days)).isoformat()
        rows = [r for r in rows if r.get("due_date", "") <= cutoff]

    total_overdue = sum(float(r.get("total") or 0) for r in rows)
    return {"invoices": rows, "total_overdue": round(total_overdue, 2), "count": len(rows)}


async def handle_list_unreviewed_transactions(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """List bank transactions awaiting review/categorization."""
    company_id = context["company_id"]
    limit = arguments.get("limit", 20)
    rows = supabase.table("bank_transactions")\
        .select("id, name, merchant_name, amount, posted_date, bank_accounts(name)")\
        .eq("company_id", company_id)\
        .eq("status", "unreviewed")\
        .order("posted_date", desc=True)\
        .limit(limit)\
        .execute().data or []
    return {"transactions": rows, "count": len(rows)}


async def handle_get_report_summary(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Return a quick P&L summary for the requested period."""
    from datetime import date
    company_id = context["company_id"]
    period = arguments.get("period", "this_month")

    today = date.today()
    if period == "this_month":
        start = today.replace(day=1).isoformat()
        end = today.isoformat()
    elif period == "last_month":
        first = today.replace(day=1)
        last_month_end = (first - __import__("datetime").timedelta(days=1))
        start = last_month_end.replace(day=1).isoformat()
        end = last_month_end.isoformat()
    elif period == "ytd":
        start = today.replace(month=1, day=1).isoformat()
        end = today.isoformat()
    else:
        start = today.replace(day=1).isoformat()
        end = today.isoformat()

    # Revenue accounts
    revenue = supabase.table("accounts")\
        .select("account_name, current_balance")\
        .eq("company_id", company_id)\
        .eq("account_type", "revenue")\
        .execute().data or []

    # Expense accounts
    expenses = supabase.table("accounts")\
        .select("account_name, current_balance")\
        .eq("company_id", company_id)\
        .eq("account_type", "expense")\
        .execute().data or []

    total_revenue = sum(float(r.get("current_balance") or 0) for r in revenue)
    total_expenses = sum(float(r.get("current_balance") or 0) for r in expenses)
    net_income = total_revenue - total_expenses

    return {
        "period": period,
        "start_date": start,
        "end_date": end,
        "total_revenue": round(total_revenue, 2),
        "total_expenses": round(total_expenses, 2),
        "net_income": round(net_income, 2),
        "profit_margin_pct": round((net_income / total_revenue * 100) if total_revenue > 0 else 0, 1),
    }


def register():
    """Register all query tools in the global registry."""
    register_tool(AgentTool(
        name="get_financial_summary",
        description="Get a financial summary for the company including cash balance, account totals by type, and recent journal entries.",
        parameters={
            "type": "object",
            "properties": {},
            "required": [],
        },
        handler=handle_get_financial_summary,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="get_account_balance",
        description="Get the current balance of one or more accounts. Can filter by account name (partial match) or account type (asset, liability, equity, revenue, expense).",
        parameters={
            "type": "object",
            "properties": {
                "account_name": {"type": "string", "description": "Full or partial account name to search for"},
                "account_type": {"type": "string", "enum": ["asset", "liability", "equity", "revenue", "expense"], "description": "Filter by account type"},
            },
        },
        handler=handle_get_account_balance,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="list_overdue_invoices",
        description="List customer invoices that are past their due date and unpaid. Optionally filter by minimum days overdue.",
        parameters={
            "type": "object",
            "properties": {
                "min_days_overdue": {"type": "integer", "description": "Minimum number of days past due date. Default 0 (all overdue)."},
            },
        },
        handler=handle_list_overdue_invoices,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="list_unreviewed_transactions",
        description="List bank transactions that haven't been categorized or posted to the general ledger yet.",
        parameters={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Max number of transactions to return. Default 20."},
            },
        },
        handler=handle_list_unreviewed_transactions,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="get_report_summary",
        description="Get a profit and loss summary for a period. Period can be 'this_month', 'last_month', or 'ytd'.",
        parameters={
            "type": "object",
            "properties": {
                "period": {"type": "string", "enum": ["this_month", "last_month", "ytd"], "description": "The reporting period"},
            },
        },
        handler=handle_get_report_summary,
        requires_confirmation=False,
    ))
