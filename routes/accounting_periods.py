"""
Accounting periods and period close (Step 9: lock the month).
Schema: accounting_periods.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict
from datetime import datetime, timezone
from database import supabase
from middleware.auth import get_current_user_company, require_min_role
from routes.journal_helpers import create_auto_journal_entry

router = APIRouter(prefix="/accounting-periods", tags=["Accounting Periods"])


class PeriodCreate(BaseModel):
    period_start: str
    period_end: str
    lock_date: Optional[str] = None


@router.get("/")
async def list_periods(auth: Dict[str, str] = Depends(get_current_user_company)):
    """List accounting periods for the company."""
    cid = auth["company_id"]
    r = supabase.table("accounting_periods").select("*").eq("company_id", cid).order("period_start", desc=True).execute()
    return r.data or []


@router.post("/")
async def create_period(
    body: PeriodCreate,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    """Create an accounting period."""
    cid = auth["company_id"]
    data = {
        "company_id": cid,
        "period_start": body.period_start,
        "period_end": body.period_end,
        "lock_date": body.lock_date or body.period_end,
        "is_closed": False,
    }
    r = supabase.table("accounting_periods").insert(data).execute()
    if not r.data:
        raise HTTPException(status_code=400, detail="Failed to create period")
    return r.data[0]


@router.patch("/{period_id}/close")
async def close_period(
    period_id: str,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    """Close/lock the period (no more edits to entries on or before lock_date)."""
    cid = auth["company_id"]
    r = supabase.table("accounting_periods").update({
        "is_closed": True,
        "closed_at": datetime.now(timezone.utc).isoformat(),
        "closed_by": auth.get("user_id"),
    }).eq("id", period_id).eq("company_id", cid).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Period not found")
    return r.data[0]


class LockBody(BaseModel):
    sales: Optional[bool] = None
    purchases: Optional[bool] = None
    financial: Optional[bool] = None


@router.patch("/{period_id}/lock")
async def lock_modules(
    period_id: str,
    body: LockBody,
    auth: Dict[str, str] = Depends(require_min_role("accountant")),
):
    """Lock or unlock individual modules (sales / purchases / financial) for
    the period. Locked modules block new posted journals dated inside the
    period via the je_block_post_in_locked_period trigger."""
    cid = auth["company_id"]
    update = {}
    if body.sales is not None:      update["sales_locked"] = body.sales
    if body.purchases is not None:  update["purchases_locked"] = body.purchases
    if body.financial is not None:  update["financial_locked"] = body.financial
    if not update:
        raise HTTPException(status_code=400, detail="No lock flags provided")
    r = supabase.table("accounting_periods").update(update)\
        .eq("id", period_id).eq("company_id", cid).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Period not found")
    return r.data[0]


@router.post("/{period_id}/close-fiscal-year")
async def close_fiscal_year(
    period_id: str,
    auth: Dict[str, str] = Depends(require_min_role("accountant")),
):
    """Close a fiscal year: aggregate revenue and expense balances for the
    period, post a closing journal that zeroes them into Retained Earnings,
    then lock all three modules. The closing entry's source_type is set to
    'period_close' and source_id to the period id."""
    cid = auth["company_id"]

    period_r = supabase.table("accounting_periods")\
        .select("*").eq("id", period_id).eq("company_id", cid).single().execute()
    period = period_r.data
    if not period:
        raise HTTPException(status_code=404, detail="Period not found")
    if period.get("retained_earnings_entry_id"):
        raise HTTPException(status_code=400, detail="Period already closed (retained earnings already rolled)")

    re_r = supabase.rpc("get_retained_earnings_account", {"p_company_id": cid}).execute()
    re_account = re_r.data
    if not re_account:
        raise HTTPException(
            status_code=400,
            detail="No retained earnings account found in COA. Add one with subtype 'retained_earnings'.",
        )

    # Aggregate revenue and expense net activity for the period from posted journal lines.
    rows = supabase.rpc("rpt_general_ledger_accounts", {
        "p_company_id": cid,
        "p_start": period["period_start"],
        "p_end": period["period_end"],
    }).execute().data or []

    revenue_lines = [r for r in rows if r.get("account_type") == "revenue"]
    expense_lines = [r for r in rows if r.get("account_type") == "expense"]
    net_revenue = sum(float(r.get("period_credit") or 0) - float(r.get("period_debit") or 0) for r in revenue_lines)
    net_expense = sum(float(r.get("period_debit") or 0) - float(r.get("period_credit") or 0) for r in expense_lines)
    net_income = round(net_revenue - net_expense, 2)

    # Closing entry: zero out each revenue (debit it down) and expense
    # (credit it down), then post the net to retained earnings.
    journal_lines = []
    for r in revenue_lines:
        bal = float(r.get("period_credit") or 0) - float(r.get("period_debit") or 0)
        if abs(bal) < 0.005:
            continue
        if bal > 0:
            journal_lines.append({"account_id": r["account_id"], "debit": bal, "credit": 0,
                                  "description": f"Close {r['account_name']} to RE"})
        else:
            journal_lines.append({"account_id": r["account_id"], "debit": 0, "credit": -bal,
                                  "description": f"Close {r['account_name']} to RE"})
    for r in expense_lines:
        bal = float(r.get("period_debit") or 0) - float(r.get("period_credit") or 0)
        if abs(bal) < 0.005:
            continue
        if bal > 0:
            journal_lines.append({"account_id": r["account_id"], "debit": 0, "credit": bal,
                                  "description": f"Close {r['account_name']} to RE"})
        else:
            journal_lines.append({"account_id": r["account_id"], "debit": -bal, "credit": 0,
                                  "description": f"Close {r['account_name']} to RE"})

    # Balancing leg to Retained Earnings.
    if net_income > 0:
        journal_lines.append({"account_id": re_account, "debit": 0, "credit": net_income,
                              "description": "Net income to retained earnings"})
    elif net_income < 0:
        journal_lines.append({"account_id": re_account, "debit": -net_income, "credit": 0,
                              "description": "Net loss to retained earnings"})

    if not journal_lines:
        raise HTTPException(status_code=400, detail="No revenue or expense activity in period; nothing to close")

    je = create_auto_journal_entry(
        company_id=cid,
        entry_date=period["period_end"],
        memo=f"Fiscal year close {period['period_start']} to {period['period_end']}",
        reference=f"CLOSE-{period['period_end']}",
        source="adjustment",
        lines=journal_lines,
        source_type="period_close",
        source_id=period_id,
    )

    # Mark the period closed and lock everything.
    supabase.table("accounting_periods").update({
        "is_closed": True,
        "closed_at": datetime.now(timezone.utc).isoformat(),
        "closed_by": auth.get("user_id"),
        "sales_locked": True,
        "purchases_locked": True,
        "financial_locked": True,
        "retained_earnings_entry_id": je["id"],
    }).eq("id", period_id).execute()

    return {
        "ok": True,
        "net_income": net_income,
        "closing_entry_id": je["id"],
        "period_id": period_id,
    }
