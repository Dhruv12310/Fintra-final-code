"""
Credit notes (AR): create, post (auto-journal that REVERSES revenue and AR),
apply to one or more invoices, void.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, List
from database import supabase
from middleware.auth import get_current_user_company, require_min_role
from routes.journal_helpers import create_auto_journal_entry, get_ar_account

router = APIRouter(prefix="/credit-notes", tags=["Credit Notes"])


class CreditLineCreate(BaseModel):
    line_number: int
    description: Optional[str] = None
    quantity: float = 1
    unit_price: float = 0
    amount: Optional[float] = None
    revenue_account_id: Optional[str] = None


class CreditNoteCreate(BaseModel):
    customer_id: str
    credit_date: str
    reason: Optional[str] = None
    memo: Optional[str] = None
    lines: List[CreditLineCreate]


class CreditNoteUpdate(BaseModel):
    status: Optional[str] = None
    reason: Optional[str] = None
    memo: Optional[str] = None


class CreditApplyBody(BaseModel):
    invoice_id: str
    amount_applied: float


@router.get("/")
async def list_credit_notes(
    status: Optional[str] = None,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    cid = auth["company_id"]
    q = supabase.table("credit_notes").select("*, contacts(display_name, email)").eq("company_id", cid)
    if status:
        q = q.eq("status", status)
    return q.order("credit_date", desc=True).execute().data or []


@router.get("/{credit_id}")
async def get_credit_note(
    credit_id: str,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    cid = auth["company_id"]
    r = supabase.table("credit_notes")\
        .select("*, credit_note_lines(*), credit_note_applications(*, invoices(invoice_number)), contacts(display_name, email)")\
        .eq("id", credit_id)\
        .eq("company_id", cid)\
        .single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Credit note not found")
    return r.data


@router.post("/")
async def create_credit_note(
    body: CreditNoteCreate,
    auth: Dict[str, str] = Depends(require_min_role("user")),
):
    cid = auth["company_id"]

    count = supabase.table("credit_notes").select("id", count="exact").eq("company_id", cid).execute().count or 0
    credit_number = f"CN-{count + 1:04d}"

    subtotal = sum((l.amount if l.amount is not None else l.quantity * l.unit_price) for l in body.lines)
    total = subtotal

    cn_r = supabase.table("credit_notes").insert({
        "company_id": cid,
        "customer_id": body.customer_id,
        "credit_number": credit_number,
        "credit_date": body.credit_date,
        "reason": body.reason,
        "memo": body.memo,
        "subtotal": subtotal,
        "total": total,
        "balance_remaining": total,
    }).execute()
    cn = cn_r.data[0]

    for line in body.lines:
        amt = line.amount if line.amount is not None else line.quantity * line.unit_price
        supabase.table("credit_note_lines").insert({
            "credit_note_id": cn["id"],
            "line_number": line.line_number,
            "description": line.description,
            "quantity": line.quantity,
            "unit_price": line.unit_price,
            "amount": amt,
            "revenue_account_id": line.revenue_account_id,
        }).execute()
    return cn


@router.patch("/{credit_id}")
async def update_credit_note(
    credit_id: str,
    body: CreditNoteUpdate,
    auth: Dict[str, str] = Depends(require_min_role("accountant")),
):
    """Update a credit note. Setting status to 'posted' auto-creates a
    reversing journal entry: CR Accounts Receivable, DR each revenue account.

    For a posted transition, the journal entry is created FIRST, and only on
    success do we flip the credit note status. This avoids leaving the credit
    note as 'posted' in the app with no matching GL entry if the JE step
    fails.
    """
    cid = auth["company_id"]
    data = body.dict(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    is_post = data.get("status") == "posted"
    if is_post:
        existing = supabase.table("credit_notes")\
            .select("*, credit_note_lines(*)")\
            .eq("id", credit_id).eq("company_id", cid).single().execute().data
        if not existing:
            raise HTTPException(status_code=404, detail="Credit note not found")
        if existing.get("status") == "posted" and existing.get("linked_journal_entry_id"):
            return existing

        lines = existing.get("credit_note_lines", []) or []
        if not lines:
            raise HTTPException(status_code=400, detail="Credit note has no lines")
        for line in lines:
            if not line.get("revenue_account_id"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Credit note line {line.get('line_number', '?')} is missing a revenue account.",
                )

        ar_account_id = get_ar_account(cid)
        total = float(existing.get("total") or 0)
        if total <= 0:
            raise HTTPException(status_code=400, detail="Credit note total must be positive")

        journal_lines = []
        for line in lines:
            journal_lines.append({
                "account_id": line["revenue_account_id"],
                "debit": float(line.get("amount") or 0),
                "credit": 0,
                "description": line.get("description") or f"Revenue reversal - {existing.get('credit_number', '')}",
                "contact_id": existing.get("customer_id"),
            })
        journal_lines.append({
            "account_id": ar_account_id,
            "debit": 0,
            "credit": total,
            "description": f"AR credit - {existing.get('credit_number', '')}",
            "contact_id": existing.get("customer_id"),
        })

        # Post the JE first; only flip the credit note if the JE lands.
        je = create_auto_journal_entry(
            company_id=cid,
            entry_date=existing.get("credit_date"),
            memo=f"Credit note {existing.get('credit_number', '')} posted",
            reference=existing.get("credit_number", ""),
            source="adjustment",
            lines=journal_lines,
            source_type="credit_note",
            source_id=credit_id,
        )

        merged = {**data, "linked_journal_entry_id": je["id"]}
        r = supabase.table("credit_notes").update(merged).eq("id", credit_id).eq("company_id", cid).execute()
        return r.data[0] if r.data else {**existing, **merged}

    r = supabase.table("credit_notes").update(data).eq("id", credit_id).eq("company_id", cid).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Credit note not found")
    return r.data[0]


@router.post("/{credit_id}/apply")
async def apply_credit_note(
    credit_id: str,
    body: CreditApplyBody,
    auth: Dict[str, str] = Depends(require_min_role("accountant")),
):
    """Apply a posted credit note to an invoice. Reduces invoice balance and
    credit's remaining balance. No new journal entry: the original credit
    posting already reversed AR; this just reallocates the credit against a
    specific invoice for AR aging accuracy."""
    cid = auth["company_id"]

    cn = supabase.table("credit_notes").select("*").eq("id", credit_id).eq("company_id", cid).single().execute().data
    if not cn:
        raise HTTPException(status_code=404, detail="Credit note not found")
    if cn.get("status") not in ("posted", "applied"):
        raise HTTPException(status_code=400, detail="Credit note must be posted before applying")
    if body.amount_applied <= 0:
        raise HTTPException(status_code=400, detail="Application amount must be positive")
    remaining = float(cn.get("balance_remaining") or 0)
    if body.amount_applied > remaining + 0.01:
        raise HTTPException(status_code=400, detail=f"Amount exceeds remaining credit balance ({remaining})")

    inv = supabase.table("invoices").select("*").eq("id", body.invoice_id).eq("company_id", cid).single().execute().data
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    inv_balance = float(inv.get("balance_due") or 0)
    if body.amount_applied > inv_balance + 0.01:
        raise HTTPException(status_code=400, detail=f"Amount exceeds invoice balance due ({inv_balance})")

    supabase.table("credit_note_applications").insert({
        "credit_note_id": credit_id,
        "invoice_id": body.invoice_id,
        "amount_applied": body.amount_applied,
        "applied_by": auth.get("user_id"),
    }).execute()

    new_applied = float(cn.get("amount_applied") or 0) + body.amount_applied
    new_remaining = float(cn.get("total") or 0) - new_applied
    new_status = "applied" if new_remaining <= 0.01 else "posted"
    supabase.table("credit_notes").update({
        "amount_applied": new_applied,
        "balance_remaining": max(0, new_remaining),
        "status": new_status,
    }).eq("id", credit_id).execute()

    new_inv_paid = float(inv.get("amount_paid") or 0) + body.amount_applied
    new_inv_balance = float(inv.get("total") or 0) - new_inv_paid
    supabase.table("invoices").update({
        "amount_paid": new_inv_paid,
        "balance_due": max(0, new_inv_balance),
        "status": "paid" if new_inv_balance <= 0.01 else inv.get("status"),
    }).eq("id", body.invoice_id).execute()

    return {"ok": True, "remaining": max(0, new_remaining)}
