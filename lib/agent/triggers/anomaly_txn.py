"""
Sentinel trigger: Bank Transaction Anomaly Detection.

Flags transactions that are statistical outliers for a (company, category) pair:
  - Amount > mean + 3*stddev over the past 90 days
  - Or amount > 5× the rolling median
  - Or round-dollar amount > $1,000 (potential vendor stuffing risk)

Uses sentinel_cursors to scan only newly synced transactions.
"""

import math
from datetime import date, timedelta, timezone, datetime
from typing import List, Dict, Any
from database import supabase


async def scan(company_id: str) -> List[Dict[str, Any]]:
    cursor_key = "anomaly_txn"
    cursor = _get_cursor(company_id, cursor_key)
    alerts: List[Dict[str, Any]] = []

    q = supabase.table("bank_transactions")\
        .select("id, amount, name, posted_date, merchant_name, bank_account_id")\
        .eq("company_id", company_id)

    if cursor:
        q = q.gt("created_at", cursor)

    new_txns = q.order("created_at").limit(200).execute().data or []

    for txn in new_txns:
        alert = _check_txn(company_id, txn)
        if alert:
            alerts.append(alert)

    _update_cursor(company_id, cursor_key)
    return alerts


def _check_txn(company_id: str, txn: dict) -> Dict | None:
    amount = abs(float(txn.get("amount") or 0))
    if amount < 50:
        return None

    merchant = txn.get("merchant_name") or txn.get("name") or "Unknown"
    txn_date = txn.get("posted_date") or str(date.today())

    # Pull 90-day history for this merchant
    since = str(date.fromisoformat(txn_date) - timedelta(days=90))
    q = supabase.table("bank_transactions")\
        .select("amount")\
        .eq("company_id", company_id)\
        .neq("id", txn["id"])\
        .gte("posted_date", since)
    if txn.get("merchant_name"):
        q = q.eq("merchant_name", txn["merchant_name"])
    else:
        q = q.eq("name", txn.get("name", ""))
    history = q.execute().data or []

    amounts = [abs(float(r.get("amount") or 0)) for r in history if float(r.get("amount") or 0) != 0]

    reason = None

    # Round-dollar check
    if amount >= 1000 and amount == int(amount):
        reason = f"round-dollar amount (${amount:,.0f}) — unusual pattern"

    # Statistical check
    if amounts and len(amounts) >= 5:
        mean = sum(amounts) / len(amounts)
        variance = sum((x - mean) ** 2 for x in amounts) / len(amounts)
        stddev = math.sqrt(variance)
        median = sorted(amounts)[len(amounts) // 2]

        if stddev > 0 and amount > mean + 3 * stddev:
            ratio = round(amount / mean, 1)
            reason = f"{ratio}× normal for {merchant} (avg ${mean:,.0f}, std ${stddev:,.0f})"
        elif median > 0 and amount > 5 * median:
            reason = f"{round(amount / median, 1)}× the usual amount for {merchant} (median ${median:,.0f})"

    if not reason:
        return None

    dedupe_key = f"anomaly_txn_{txn['id']}"
    return {
        "title": f"Unusual transaction — {merchant}",
        "body": f"${amount:,.2f} at {merchant} on {txn_date}: {reason}.",
        "severity": "warning",
        "entity_type": "bank_transaction",
        "entity_id": txn["id"],
        "action_payload": {"txn_id": txn["id"], "amount": amount, "merchant": merchant},
        "dedupe_key": dedupe_key,
    }


def _get_cursor(company_id: str, trigger_name: str):
    row = supabase.table("sentinel_cursors")\
        .select("last_scanned_at")\
        .eq("company_id", company_id)\
        .eq("trigger_name", trigger_name)\
        .execute().data
    return (row[0]["last_scanned_at"] if row else None)


def _update_cursor(company_id: str, trigger_name: str):
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("sentinel_cursors").upsert({
        "trigger_name": trigger_name,
        "company_id": company_id,
        "last_scanned_at": now,
    }).execute()
