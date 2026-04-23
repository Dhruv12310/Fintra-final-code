"""
Vendor credits (AP): create, post (auto-journal REVERSES expense and AP),
apply to one or more bills, void.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, List
from database import supabase
from middleware.auth import get_current_user_company, require_min_role
from routes.journal_helpers import create_auto_journal_entry, get_ap_account

router = APIRouter(prefix="/vendor-credits", tags=["Vendor Credits"])


class VendorCreditLineCreate(BaseModel):
    line_number: int
    description: Optional[str] = None
    amount: float = 0
    expense_account_id: Optional[str] = None


class VendorCreditCreate(BaseModel):
    vendor_id: str
    credit_date: str
    reason: Optional[str] = None
    memo: Optional[str] = None
    lines: List[VendorCreditLineCreate]


class VendorCreditUpdate(BaseModel):
    status: Optional[str] = None
    reason: Optional[str] = None
    memo: Optional[str] = None


class VendorCreditApplyBody(BaseModel):
    bill_id: str
    amount_applied: float


@router.get("/")
async def list_vendor_credits(
    status: Optional[str] = None,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    cid = auth["company_id"]
    q = supabase.table("vendor_credits").select("*, contacts(display_name, email)").eq("company_id", cid)
    if status:
        q = q.eq("status", status)
    return q.order("credit_date", desc=True).execute().data or []


@router.get("/{credit_id}")
async def get_vendor_credit(
    credit_id: str,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    cid = auth["company_id"]
    r = supabase.table("vendor_credits")\
        .select("*, vendor_credit_lines(*), vendor_credit_applications(*, bills(bill_number)), contacts(display_name, email)")\
        .eq("id", credit_id).eq("company_id", cid).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Vendor credit not found")
    return r.data


@router.post("/")
async def create_vendor_credit(
    body: VendorCreditCreate,
    auth: Dict[str, str] = Depends(require_min_role("user")),
):
    cid = auth["company_id"]

    count = supabase.table("vendor_credits").select("id", count="exact").eq("company_id", cid).execute().count or 0
    credit_number = f"VC-{count + 1:04d}"

    subtotal = sum(l.amount for l in body.lines)
    total = subtotal

    vc_r = supabase.table("vendor_credits").insert({
        "company_id": cid,
        "vendor_id": body.vendor_id,
        "credit_number": credit_number,
        "credit_date": body.credit_date,
        "reason": body.reason,
        "memo": body.memo,
        "subtotal": subtotal,
        "total": total,
        "balance_remaining": total,
    }).execute()
    vc = vc_r.data[0]

    for line in body.lines:
        supabase.table("vendor_credit_lines").insert({
            "vendor_credit_id": vc["id"],
            "line_number": line.line_number,
            "description": line.description,
            "amount": line.amount,
            "expense_account_id": line.expense_account_id,
        }).execute()
    return vc


@router.patch("/{credit_id}")
async def update_vendor_credit(
    credit_id: str,
    body: VendorCreditUpdate,
    auth: Dict[str, str] = Depends(require_min_role("accountant")),
):
    """Setting status to 'posted' auto-creates a reversing journal entry:
    DR Accounts Payable, CR each expense account.

    The journal entry is created FIRST. The vendor credit only flips to
    posted if the JE lands, so we never leave an 'orphaned' posted credit
    with no GL entry.
    """
    cid = auth["company_id"]
    data = body.dict(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    is_post = data.get("status") == "posted"
    if is_post:
        existing = supabase.table("vendor_credits")\
            .select("*, vendor_credit_lines(*)")\
            .eq("id", credit_id).eq("company_id", cid).single().execute().data
        if not existing:
            raise HTTPException(status_code=404, detail="Vendor credit not found")
        if existing.get("status") == "posted" and existing.get("linked_journal_entry_id"):
            return existing

        lines = existing.get("vendor_credit_lines", []) or []
        if not lines:
            raise HTTPException(status_code=400, detail="Vendor credit has no lines")
        for line in lines:
            if not line.get("expense_account_id"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Vendor credit line {line.get('line_number', '?')} is missing an expense account.",
                )

        ap_account_id = get_ap_account(cid)
        total = float(existing.get("total") or 0)
        if total <= 0:
            raise HTTPException(status_code=400, detail="Vendor credit total must be positive")

        journal_lines = [{
            "account_id": ap_account_id,
            "debit": total,
            "credit": 0,
            "description": f"AP credit - {existing.get('credit_number', '')}",
            "contact_id": existing.get("vendor_id"),
        }]
        for line in lines:
            journal_lines.append({
                "account_id": line["expense_account_id"],
                "debit": 0,
                "credit": float(line.get("amount") or 0),
                "description": line.get("description") or f"Expense reversal - {existing.get('credit_number', '')}",
                "contact_id": existing.get("vendor_id"),
            })

        je = create_auto_journal_entry(
            company_id=cid,
            entry_date=existing.get("credit_date"),
            memo=f"Vendor credit {existing.get('credit_number', '')} posted",
            reference=existing.get("credit_number", ""),
            source="adjustment",
            lines=journal_lines,
            source_type="vendor_credit",
            source_id=credit_id,
        )

        merged = {**data, "linked_journal_entry_id": je["id"]}
        r = supabase.table("vendor_credits").update(merged).eq("id", credit_id).eq("company_id", cid).execute()
        return r.data[0] if r.data else {**existing, **merged}

    r = supabase.table("vendor_credits").update(data).eq("id", credit_id).eq("company_id", cid).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Vendor credit not found")
    return r.data[0]


@router.post("/{credit_id}/apply")
async def apply_vendor_credit(
    credit_id: str,
    body: VendorCreditApplyBody,
    auth: Dict[str, str] = Depends(require_min_role("accountant")),
):
    """Apply a posted vendor credit to a bill. Reduces bill balance and
    credit's remaining balance."""
    cid = auth["company_id"]

    vc = supabase.table("vendor_credits").select("*").eq("id", credit_id).eq("company_id", cid).single().execute().data
    if not vc:
        raise HTTPException(status_code=404, detail="Vendor credit not found")
    if vc.get("status") not in ("posted", "applied"):
        raise HTTPException(status_code=400, detail="Vendor credit must be posted before applying")
    if body.amount_applied <= 0:
        raise HTTPException(status_code=400, detail="Application amount must be positive")
    remaining = float(vc.get("balance_remaining") or 0)
    if body.amount_applied > remaining + 0.01:
        raise HTTPException(status_code=400, detail=f"Amount exceeds remaining credit balance ({remaining})")

    bill = supabase.table("bills").select("*").eq("id", body.bill_id).eq("company_id", cid).single().execute().data
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    bill_balance = float(bill.get("balance_due") or 0)
    if body.amount_applied > bill_balance + 0.01:
        raise HTTPException(status_code=400, detail=f"Amount exceeds bill balance due ({bill_balance})")

    supabase.table("vendor_credit_applications").insert({
        "vendor_credit_id": credit_id,
        "bill_id": body.bill_id,
        "amount_applied": body.amount_applied,
        "applied_by": auth.get("user_id"),
    }).execute()

    new_applied = float(vc.get("amount_applied") or 0) + body.amount_applied
    new_remaining = float(vc.get("total") or 0) - new_applied
    new_status = "applied" if new_remaining <= 0.01 else "posted"
    supabase.table("vendor_credits").update({
        "amount_applied": new_applied,
        "balance_remaining": max(0, new_remaining),
        "status": new_status,
    }).eq("id", credit_id).execute()

    new_bill_paid = float(bill.get("amount_paid") or 0) + body.amount_applied
    new_bill_balance = float(bill.get("total") or 0) - new_bill_paid
    supabase.table("bills").update({
        "amount_paid": new_bill_paid,
        "balance_due": max(0, new_bill_balance),
        "status": "paid" if new_bill_balance <= 0.01 else bill.get("status"),
    }).eq("id", body.bill_id).execute()

    return {"ok": True, "remaining": max(0, new_remaining)}
