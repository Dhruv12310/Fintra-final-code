"""
Financial context builder for the agent.
Extracted and generalized from routes/ai_overlook.py.
Provides structured company + financial data to agent tools and OpenAI calls.
"""

from typing import Dict, Any, Optional
from database import supabase


def build_financial_context(company_id: str) -> Dict[str, Any]:
    """
    Fetch and return structured financial context for a company.
    Used by agent tools as shared context so each tool doesn't re-query.
    """
    # Company profile
    company_resp = supabase.table("companies").select("*").eq("id", company_id).execute()
    company = company_resp.data[0] if company_resp.data else {}

    # Chart of Accounts
    accounts_resp = supabase.table("accounts")\
        .select("id, account_code, account_name, account_type, account_subtype, current_balance")\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .execute()
    accounts = accounts_resp.data or []

    # Recent journal entries
    journals_resp = supabase.table("journal_entries")\
        .select("id, journal_number, entry_date, memo, status, total_debit")\
        .eq("company_id", company_id)\
        .eq("status", "posted")\
        .order("entry_date", desc=True)\
        .limit(10)\
        .execute()
    journals = journals_resp.data or []

    # Account totals by type
    by_type: Dict[str, Dict] = {}
    for acc in accounts:
        t = acc.get("account_type", "unknown")
        if t not in by_type:
            by_type[t] = {"count": 0, "total": 0.0, "accounts": []}
        balance = float(acc.get("current_balance") or 0)
        by_type[t]["count"] += 1
        by_type[t]["total"] += balance
        by_type[t]["accounts"].append({
            "id": acc["id"],
            "code": acc.get("account_code", ""),
            "name": acc.get("account_name", ""),
            "subtype": acc.get("account_subtype", ""),
            "balance": balance,
        })

    # Cash & bank balance
    cash_total = sum(
        float(a.get("current_balance") or 0)
        for a in accounts
        if a.get("account_subtype") in ("bank", "cash", "checking", "savings")
    )

    return {
        "company": {
            "id": company.get("id"),
            "name": company.get("name", ""),
            "industry": company.get("industry", ""),
            "business_type": company.get("business_type", ""),
            "city": company.get("city", ""),
            "state": company.get("state", ""),
            "currency": company.get("currency", "USD"),
        },
        "accounts": accounts,
        "accounts_by_type": by_type,
        "cash_balance": cash_total,
        "recent_journals": journals,
        "account_count": len(accounts),
        "journal_count": len(journals),
    }


def build_context_string(ctx: Dict[str, Any]) -> str:
    """
    Format financial context as a human-readable string for injection into OpenAI prompts.
    """
    co = ctx.get("company", {})
    lines = [
        f"Company: {co.get('name', 'Unknown')}",
        f"Industry: {co.get('industry', 'N/A')}",
        f"Location: {co.get('city', '')}, {co.get('state', '')}".strip(", "),
        f"Total Accounts: {ctx.get('account_count', 0)}",
        f"Cash Balance: ${ctx.get('cash_balance', 0):,.2f}",
        "",
        "ACCOUNTS BY TYPE:",
    ]
    for acc_type, data in ctx.get("accounts_by_type", {}).items():
        lines.append(f"  {acc_type}: {data['count']} accounts, Total: ${data['total']:,.2f}")
        sorted_accs = sorted(data["accounts"], key=lambda x: abs(x["balance"]), reverse=True)[:3]
        for acc in sorted_accs:
            lines.append(f"    - {acc['code']}: {acc['name']} = ${acc['balance']:,.2f}")

    recent = ctx.get("recent_journals", [])
    if recent:
        lines.append(f"\nRECENT JOURNALS ({len(recent)}):")
        for j in recent:
            lines.append(f"  - {j.get('entry_date', '?')}: {j.get('memo', 'No memo')} ({j.get('journal_number', '')})")

    return "\n".join(lines)


def resolve_account_id(company_id: str, name_or_code: str) -> Optional[str]:
    """
    Fuzzy-resolve an account name or code to a UUID.
    Used by the journal tool to map natural language to actual account IDs.
    Tries exact code match first, then case-insensitive name match, then partial name match.
    """
    # Exact code match
    r = supabase.table("accounts")\
        .select("id, account_name")\
        .eq("company_id", company_id)\
        .eq("account_code", name_or_code.strip())\
        .execute()
    if r.data:
        return r.data[0]["id"]

    # Exact name match (case-insensitive)
    r = supabase.table("accounts")\
        .select("id, account_name")\
        .eq("company_id", company_id)\
        .ilike("account_name", name_or_code.strip())\
        .execute()
    if r.data:
        return r.data[0]["id"]

    # Partial name match — return first result
    r = supabase.table("accounts")\
        .select("id, account_name")\
        .eq("company_id", company_id)\
        .ilike("account_name", f"%{name_or_code.strip()}%")\
        .execute()
    if r.data:
        return r.data[0]["id"]

    return None
