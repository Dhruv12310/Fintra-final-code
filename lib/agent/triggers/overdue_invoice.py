"""
Sentinel trigger: Overdue Invoice → Dunning Draft.

Fires once per invoice when it crosses a 30/60/90-day threshold past due.
Creates an alert with a pre-drafted email body. On user acceptance,
routes/alerts.py sends the email via lib/notify/email.py.
"""

from datetime import date, timezone, datetime
from typing import List, Dict, Any
from database import supabase


THRESHOLDS = [30, 60, 90]


async def scan(company_id: str) -> List[Dict[str, Any]]:
    alerts: List[Dict[str, Any]] = []
    today = date.today()

    # Only open (unpaid) invoices with a due_date
    invoices = supabase.table("invoices")\
        .select("id, invoice_number, due_date, total, balance_due, contacts(display_name, email)")\
        .eq("company_id", company_id)\
        .in_("status", ["posted", "sent"])\
        .lt("due_date", str(today))\
        .execute().data or []

    for inv in invoices:
        due = inv.get("due_date")
        if not due:
            continue
        try:
            days_overdue = (today - date.fromisoformat(due)).days
        except ValueError:
            continue

        threshold = _applicable_threshold(days_overdue)
        if not threshold:
            continue

        contact = inv.get("contacts") or {}
        customer = contact.get("display_name", "Customer")
        email = contact.get("email")
        balance = float(inv.get("balance_due") or inv.get("total") or 0)
        inv_number = inv.get("invoice_number", "?")

        dedupe_key = f"overdue_{inv['id']}_d{threshold}"

        co = supabase.table("companies").select("name").eq("id", company_id).execute()
        company_name = (co.data or [{}])[0].get("name", "Your Vendor")

        email_body = _build_dunning_email(customer, inv_number, balance, days_overdue, due, company_name, threshold)

        alerts.append({
            "title": f"Invoice {inv_number} overdue {days_overdue} days — {customer}",
            "body": (
                f"{customer} owes ${balance:,.2f} on {inv_number} "
                f"(due {due}, {days_overdue} days ago)."
                + (f" Draft reminder ready to send to {email}." if email else " No email on file.")
            ),
            "severity": "warning" if days_overdue < 60 else "critical",
            "entity_type": "invoice",
            "entity_id": inv["id"],
            "action_payload": {
                "invoice_id": inv["id"],
                "invoice_number": inv_number,
                "customer_email": email,
                "customer_name": customer,
                "amount": balance,
                "days_overdue": days_overdue,
                "email_subject": f"Payment reminder: {inv_number}",
                "email_body": email_body,
            },
            "dedupe_key": dedupe_key,
        })

    return alerts


def _applicable_threshold(days: int) -> int | None:
    for t in sorted(THRESHOLDS, reverse=True):
        if days >= t:
            return t
    return None


def _build_dunning_email(customer, inv_number, balance, days_overdue, due_date, company_name, threshold):
    if threshold >= 90:
        tone = (
            f"This is a final notice regarding invoice {inv_number} for ${balance:,.2f}, "
            f"which is now {days_overdue} days past due. "
            "Please remit payment immediately or contact us to discuss resolution, "
            "as we may need to escalate this matter."
        )
    elif threshold >= 60:
        tone = (
            f"Our records show invoice {inv_number} for ${balance:,.2f} remains unpaid "
            f"and is now {days_overdue} days overdue (due {due_date}). "
            "Please arrange payment at your earliest convenience."
        )
    else:
        tone = (
            f"This is a friendly reminder that invoice {inv_number} for ${balance:,.2f} "
            f"was due on {due_date} and remains outstanding. "
            "If you have already sent payment, please disregard this notice."
        )

    return f"""Hi {customer},

{tone}

If you have any questions about this invoice, please don't hesitate to reach out.

Best regards,
{company_name}"""
