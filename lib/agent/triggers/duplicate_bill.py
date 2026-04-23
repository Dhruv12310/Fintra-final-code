"""
Sentinel trigger: Duplicate Bill Detection.

Fires when a new bill looks like a duplicate of a recent one from the same vendor:
  - Same vendor_id
  - Amount within 5%
  - Dated within 30 days of an existing posted/draft bill

Bills identified as duplicates are flagged status='held_duplicate'.
"""

from datetime import date, timedelta
from typing import List, Dict, Any
from database import supabase


async def scan(company_id: str) -> List[Dict[str, Any]]:
    """Return a list of alert dicts for new duplicate bills found."""
    cursor_key = "duplicate_bill"
    cursor = _get_cursor(company_id, cursor_key)
    alerts: List[Dict[str, Any]] = []

    q = supabase.table("bills")\
        .select("id, bill_number, vendor_id, total, bill_date, status, contacts(display_name)")\
        .eq("company_id", company_id)\
        .in_("status", ["draft", "posted"])

    if cursor:
        q = q.gt("created_at", cursor)

    new_bills = q.order("created_at").execute().data or []
    if not new_bills:
        return alerts

    for bill in new_bills:
        dupes = _find_duplicates(company_id, bill)
        for dup in dupes:
            vendor_name = (bill.get("contacts") or {}).get("display_name", "Unknown vendor")
            amount = float(bill.get("total") or 0)
            dup_number = dup.get("bill_number", "?")
            bill_number = bill.get("bill_number", "?")
            dedupe_key = f"dup_bill_{bill['id']}"

            # Hold the bill
            if bill.get("status") in ("draft",):
                supabase.table("bills").update({"status": "held_duplicate"})\
                    .eq("id", bill["id"]).execute()

            alerts.append({
                "title": f"Possible duplicate bill — {vendor_name}",
                "body": (
                    f"Bill {bill_number} (${amount:,.2f} on {bill.get('bill_date')}) "
                    f"looks like a duplicate of {dup_number}. "
                    f"Review before posting. Bill has been held."
                ),
                "severity": "warning",
                "entity_type": "bill",
                "entity_id": bill["id"],
                "action_payload": {
                    "bill_id": bill["id"],
                    "duplicate_of_id": dup["id"],
                    "actions": ["accept_and_post", "reject_and_void"],
                },
                "dedupe_key": dedupe_key,
            })

    _update_cursor(company_id, cursor_key)
    return alerts


def _find_duplicates(company_id: str, bill: dict) -> List[dict]:
    vendor_id = bill.get("vendor_id")
    amount = float(bill.get("total") or 0)
    bill_date = bill.get("bill_date")

    if not vendor_id or amount <= 0 or not bill_date:
        return []

    try:
        dt = date.fromisoformat(bill_date)
        window_start = str(dt - timedelta(days=30))
        window_end = str(dt + timedelta(days=30))
    except ValueError:
        return []

    candidates = supabase.table("bills")\
        .select("id, bill_number, total, bill_date, status")\
        .eq("company_id", company_id)\
        .eq("vendor_id", vendor_id)\
        .neq("id", bill["id"])\
        .in_("status", ["draft", "posted", "paid"])\
        .gte("bill_date", window_start)\
        .lte("bill_date", window_end)\
        .execute().data or []

    dupes = []
    for c in candidates:
        c_amount = float(c.get("total") or 0)
        if c_amount > 0 and abs(c_amount - amount) / c_amount <= 0.05:
            dupes.append(c)

    return dupes


def _get_cursor(company_id: str, trigger_name: str):
    row = supabase.table("sentinel_cursors")\
        .select("last_scanned_at")\
        .eq("company_id", company_id)\
        .eq("trigger_name", trigger_name)\
        .execute().data
    return (row[0]["last_scanned_at"] if row else None)


def _update_cursor(company_id: str, trigger_name: str):
    from datetime import timezone
    from datetime import datetime
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("sentinel_cursors").upsert({
        "trigger_name": trigger_name,
        "company_id": company_id,
        "last_scanned_at": now,
    }).execute()
