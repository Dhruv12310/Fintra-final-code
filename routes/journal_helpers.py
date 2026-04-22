"""
Shared helpers for auto-creating journal entries from invoices, bills, and payments.
"""

from fastapi import HTTPException
from database import supabase
from datetime import datetime


def get_account_by_subtype(company_id: str, subtype: str) -> str:
    """Find the first account matching the given subtype for a company."""
    r = supabase.table("accounts")\
        .select("id")\
        .eq("company_id", company_id)\
        .eq("account_subtype", subtype)\
        .limit(1)\
        .execute()
    if not r.data:
        raise HTTPException(
            status_code=400,
            detail=f"No account with subtype '{subtype}' found. Please set up your Chart of Accounts first.",
        )
    return r.data[0]["id"]


def get_ar_account(company_id: str) -> str:
    return get_account_by_subtype(company_id, "accounts_receivable")


def get_ap_account(company_id: str) -> str:
    return get_account_by_subtype(company_id, "accounts_payable")


def create_auto_journal_entry(
    company_id: str,
    entry_date: str,
    memo: str,
    reference: str,
    source: str,
    lines: list,
    created_by: str = None,
    source_type: str = None,
    source_id: str = None,
    reverses_entry_id: str = None,
) -> dict:
    """
    Create a posted journal entry with lines.

    lines: list of dicts with keys: account_id, debit, credit, description, contact_id (optional)
    source_type / source_id: link back to the document that produced this entry
        (invoice, bill, payment, bill_payment, manual). Used by the General Ledger
        drill-down to jump from a journal line to the source doc.
    reverses_entry_id: if set, marks this entry as a reversing entry pointing
        at the original. Used by void_journal_entry_with_reversal.
    Returns the created journal entry dict (with id).
    """
    total_debit = sum(l.get("debit", 0) or 0 for l in lines)
    total_credit = sum(l.get("credit", 0) or 0 for l in lines)

    if abs(total_debit - total_credit) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Journal debits ({total_debit}) must equal credits ({total_credit})",
        )

    year = datetime.strptime(entry_date, "%Y-%m-%d").year
    count_r = supabase.table("journal_entries")\
        .select("id", count="exact")\
        .eq("company_id", company_id)\
        .execute()
    next_number = (count_r.count or 0) + 1
    journal_number = f"JE-{year}-{next_number:04d}"

    journal_data = {
        "company_id": company_id,
        "journal_number": journal_number,
        "entry_date": entry_date,
        "memo": memo,
        "reference_number": reference,
        "source": source,
        "status": "draft",
        "total_debit": total_debit,
        "total_credit": total_credit,
    }
    if source_type:
        journal_data["source_type"] = source_type
    if source_id:
        journal_data["source_id"] = source_id
    if reverses_entry_id:
        journal_data["reverses_entry_id"] = reverses_entry_id

    journal_r = supabase.table("journal_entries").insert(journal_data).execute()
    if not journal_r.data:
        raise HTTPException(status_code=500, detail="Failed to create journal entry")
    journal_entry = journal_r.data[0]

    for idx, line in enumerate(lines, start=1):
        line_data = {
            "journal_entry_id": journal_entry["id"],
            "account_id": line["account_id"],
            "line_number": idx,
            "debit": line.get("debit", 0) or 0,
            "credit": line.get("credit", 0) or 0,
            "description": line.get("description"),
            "contact_id": line.get("contact_id"),
        }
        supabase.table("journal_lines").insert(line_data).execute()

    supabase.table("journal_entries")\
        .update({"status": "posted"})\
        .eq("id", journal_entry["id"])\
        .execute()
    journal_entry["status"] = "posted"

    return journal_entry


def void_journal_entry_with_reversal(
    company_id: str,
    entry_id: str,
    voided_by: str = None,
    reason: str = None,
) -> dict:
    """
    Reverse a posted journal entry by creating a NEW entry that mirror-flips
    debits/credits and marks the original as void. The original entry stays
    intact (immutable). The reversing entry carries reverses_entry_id pointing
    at the original.

    Returns {"original": {...}, "reversal": {...}}.
    """
    orig_r = supabase.table("journal_entries")\
        .select("*, journal_lines(*)")\
        .eq("id", entry_id)\
        .eq("company_id", company_id)\
        .single()\
        .execute()
    orig = orig_r.data
    if not orig:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    if orig.get("status") != "posted":
        raise HTTPException(status_code=400, detail="Only posted entries can be reversed")

    existing = supabase.table("journal_entries")\
        .select("id")\
        .eq("reverses_entry_id", entry_id)\
        .limit(1)\
        .execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Entry already has a reversing entry")

    flipped_lines = [
        {
            "account_id": ln["account_id"],
            "debit": float(ln.get("credit") or 0),
            "credit": float(ln.get("debit") or 0),
            "description": f"Reversal: {ln.get('description') or ''}".strip(),
            "contact_id": ln.get("contact_id"),
        }
        for ln in (orig.get("journal_lines") or [])
    ]

    reversal = create_auto_journal_entry(
        company_id=company_id,
        entry_date=datetime.utcnow().strftime("%Y-%m-%d"),
        memo=f"Reversal of {orig.get('journal_number')}: {reason or 'voided'}",
        reference=orig.get("reference_number") or "",
        source=orig.get("source") or "manual",
        lines=flipped_lines,
        source_type=orig.get("source_type"),
        source_id=orig.get("source_id"),
        reverses_entry_id=entry_id,
    )

    void_update = {
        "status": "void",
        "voided_at": datetime.utcnow().isoformat(),
        "void_reason": reason,
    }
    if voided_by:
        void_update["voided_by"] = voided_by
    supabase.table("journal_entries")\
        .update(void_update)\
        .eq("id", entry_id)\
        .execute()

    return {"original_id": entry_id, "reversal": reversal}
