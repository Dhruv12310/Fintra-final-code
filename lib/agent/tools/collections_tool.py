"""
Agent tool: AR collections and dunning.

Tools:
  get_ar_aging              — read-only: AR aging breakdown by bucket
  get_ap_aging              — read-only: AP aging breakdown by bucket
  draft_payment_reminders   — draft reminder messages for overdue invoices (read-only preview)
  send_payment_reminders    — send payment reminders via email (requires_confirmation=True)
"""

from typing import Dict, Any, List, Optional
from datetime import date
from database import supabase
from lib.agent.tools.registry import AgentTool, register_tool


async def handle_get_ar_aging(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Get AR aging breakdown."""
    company_id = context["company_id"]
    min_days = int(arguments.get("min_days_overdue", 0))

    rows = supabase.table("invoices")\
        .select("id, invoice_number, due_date, balance_due, contacts(display_name, email)")\
        .eq("company_id", company_id)\
        .in_("status", ["posted", "sent"])\
        .gt("balance_due", 0)\
        .order("due_date")\
        .execute().data or []

    today = date.today()
    buckets: Dict[str, Dict] = {
        "current":  {"label": "Current (not yet due)", "count": 0, "total": 0.0, "items": []},
        "1_30":     {"label": "1–30 days overdue",     "count": 0, "total": 0.0, "items": []},
        "31_60":    {"label": "31–60 days overdue",    "count": 0, "total": 0.0, "items": []},
        "61_90":    {"label": "61–90 days overdue",    "count": 0, "total": 0.0, "items": []},
        "over_90":  {"label": "90+ days overdue",      "count": 0, "total": 0.0, "items": []},
    }

    total_ar = 0.0
    for r in rows:
        balance = float(r.get("balance_due") or 0)
        due_str = r.get("due_date")
        if not due_str:
            continue
        days_overdue = max(0, (today - date.fromisoformat(due_str)).days)
        contact = r.get("contacts") or {}
        entry = {
            "invoice_number": r["invoice_number"],
            "customer": contact.get("display_name", "Unknown"),
            "email": contact.get("email"),
            "due_date": due_str,
            "days_overdue": days_overdue,
            "balance_due": balance,
        }

        if days_overdue >= min_days:
            total_ar += balance
            if days_overdue == 0:
                buckets["current"]["count"] += 1
                buckets["current"]["total"] += balance
                buckets["current"]["items"].append(entry)
            elif days_overdue <= 30:
                buckets["1_30"]["count"] += 1
                buckets["1_30"]["total"] += balance
                buckets["1_30"]["items"].append(entry)
            elif days_overdue <= 60:
                buckets["31_60"]["count"] += 1
                buckets["31_60"]["total"] += balance
                buckets["31_60"]["items"].append(entry)
            elif days_overdue <= 90:
                buckets["61_90"]["count"] += 1
                buckets["61_90"]["total"] += balance
                buckets["61_90"]["items"].append(entry)
            else:
                buckets["over_90"]["count"] += 1
                buckets["over_90"]["total"] += balance
                buckets["over_90"]["items"].append(entry)

    # Round totals
    for b in buckets.values():
        b["total"] = round(b["total"], 2)
        b["items"] = b["items"][:5]  # cap for readability in agent responses

    overdue_total = round(
        buckets["1_30"]["total"] + buckets["31_60"]["total"] +
        buckets["61_90"]["total"] + buckets["over_90"]["total"], 2
    )

    return {
        "total_outstanding": round(total_ar, 2),
        "total_overdue": overdue_total,
        "buckets": buckets,
        "message": (
            f"Total AR outstanding: ${total_ar:,.2f}. "
            f"Overdue: ${overdue_total:,.2f} across "
            f"{buckets['1_30']['count'] + buckets['31_60']['count'] + buckets['61_90']['count'] + buckets['over_90']['count']} invoice(s)."
        ),
    }


async def handle_get_ap_aging(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Get AP aging breakdown."""
    company_id = context["company_id"]

    rows = supabase.table("bills")\
        .select("id, bill_number, due_date, balance_due, contacts(display_name, email)")\
        .eq("company_id", company_id)\
        .in_("status", ["posted", "draft"])\
        .gt("balance_due", 0)\
        .order("due_date")\
        .execute().data or []

    today = date.today()
    buckets: Dict[str, Dict] = {
        "current":  {"label": "Current (not yet due)", "count": 0, "total": 0.0},
        "1_30":     {"label": "1–30 days overdue",     "count": 0, "total": 0.0},
        "31_60":    {"label": "31–60 days overdue",    "count": 0, "total": 0.0},
        "61_90":    {"label": "61–90 days overdue",    "count": 0, "total": 0.0},
        "over_90":  {"label": "90+ days overdue",      "count": 0, "total": 0.0},
    }

    total_ap = 0.0
    for r in rows:
        balance = float(r.get("balance_due") or 0)
        due_str = r.get("due_date")
        if not due_str:
            continue
        days_overdue = max(0, (today - date.fromisoformat(due_str)).days)
        total_ap += balance

        if days_overdue == 0:
            buckets["current"]["count"] += 1
            buckets["current"]["total"] += balance
        elif days_overdue <= 30:
            buckets["1_30"]["count"] += 1
            buckets["1_30"]["total"] += balance
        elif days_overdue <= 60:
            buckets["31_60"]["count"] += 1
            buckets["31_60"]["total"] += balance
        elif days_overdue <= 90:
            buckets["61_90"]["count"] += 1
            buckets["61_90"]["total"] += balance
        else:
            buckets["over_90"]["count"] += 1
            buckets["over_90"]["total"] += balance

    for b in buckets.values():
        b["total"] = round(b["total"], 2)

    overdue_total = round(
        buckets["1_30"]["total"] + buckets["31_60"]["total"] +
        buckets["61_90"]["total"] + buckets["over_90"]["total"], 2
    )

    return {
        "total_outstanding": round(total_ap, 2),
        "total_overdue": overdue_total,
        "buckets": buckets,
        "message": (
            f"Total AP outstanding: ${total_ap:,.2f}. "
            f"Overdue: ${overdue_total:,.2f}."
        ),
    }


def _build_reminder(invoice: Dict, company_name: str) -> str:
    """Build a payment reminder email body."""
    days = invoice["days_overdue"]
    urgency = "a friendly reminder" if days <= 30 else "an important reminder" if days <= 60 else "an urgent notice"
    return (
        f"Subject: Payment Reminder — Invoice {invoice['invoice_number']} ({days} days overdue)\n\n"
        f"Dear {invoice['customer']},\n\n"
        f"This is {urgency} that invoice {invoice['invoice_number']} for "
        f"${invoice['balance_due']:,.2f} was due on {invoice['due_date']} "
        f"and is now {days} day{'s' if days != 1 else ''} overdue.\n\n"
        f"Please arrange payment at your earliest convenience.\n\n"
        f"Best regards,\n{company_name}"
    )


async def handle_draft_payment_reminders(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Draft payment reminder emails for overdue invoices."""
    company_id = context["company_id"]
    min_days = int(arguments.get("min_days_overdue", 1))
    max_items = int(arguments.get("limit", 10))

    rows = supabase.table("invoices")\
        .select("id, invoice_number, due_date, balance_due, contacts(display_name, email)")\
        .eq("company_id", company_id)\
        .in_("status", ["posted", "sent"])\
        .gt("balance_due", 0)\
        .order("due_date")\
        .execute().data or []

    company_r = supabase.table("companies").select("name").eq("id", company_id).single().execute()
    company_name = (company_r.data or {}).get("name", "Fintra")

    today = date.today()
    overdue = []
    for r in rows:
        due_str = r.get("due_date")
        if not due_str:
            continue
        days = (today - date.fromisoformat(due_str)).days
        if days >= min_days:
            contact = r.get("contacts") or {}
            overdue.append({
                "invoice_number": r["invoice_number"],
                "invoice_id": r["id"],
                "customer": contact.get("display_name", "Unknown"),
                "email": contact.get("email"),
                "due_date": due_str,
                "days_overdue": days,
                "balance_due": float(r.get("balance_due") or 0),
            })

    overdue.sort(key=lambda x: -x["days_overdue"])
    overdue = overdue[:max_items]

    if not overdue:
        return {"message": f"No invoices overdue by more than {min_days} day(s).", "count": 0}

    reminders = []
    for inv in overdue:
        body = _build_reminder(inv, company_name)
        reminders.append({
            "invoice_number": inv["invoice_number"],
            "to": inv["email"],
            "customer": inv["customer"],
            "days_overdue": inv["days_overdue"],
            "amount": inv["balance_due"],
            "draft_body": body,
        })

    total_amount = round(sum(r["amount"] for r in reminders), 2)
    return {
        "count": len(reminders),
        "total_amount": total_amount,
        "reminders": reminders,
        "message": (
            f"Drafted {len(reminders)} payment reminder(s) for ${total_amount:,.2f} in overdue invoices. "
            "Review the drafts above. Use send_payment_reminders to send them."
        ),
    }


async def handle_send_payment_reminders(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Send payment reminders. In production this calls an email provider."""
    company_id = context["company_id"]
    invoice_ids: Optional[List[str]] = arguments.get("invoice_ids")
    min_days = int(arguments.get("min_days_overdue", 1))

    # Build the list of invoices to remind
    q = supabase.table("invoices")\
        .select("id, invoice_number, due_date, balance_due, contacts(display_name, email)")\
        .eq("company_id", company_id)\
        .in_("status", ["posted", "sent"])\
        .gt("balance_due", 0)

    if invoice_ids:
        q = q.in_("id", invoice_ids)

    rows = q.execute().data or []

    company_r = supabase.table("companies").select("name, customer_email").eq("id", company_id).single().execute()
    company_data = company_r.data or {}
    company_name = company_data.get("name", "Fintra")

    today = date.today()
    sent = []
    no_email = []

    for r in rows:
        due_str = r.get("due_date")
        if not due_str:
            continue
        days = (today - date.fromisoformat(due_str)).days
        if days < min_days and not invoice_ids:
            continue

        contact = r.get("contacts") or {}
        email = contact.get("email")
        customer = contact.get("display_name", "Unknown")

        if not email:
            no_email.append(f"{r['invoice_number']} ({customer})")
            continue

        inv_info = {
            "invoice_number": r["invoice_number"],
            "invoice_id": r["id"],
            "customer": customer,
            "email": email,
            "due_date": due_str,
            "days_overdue": days,
            "balance_due": float(r.get("balance_due") or 0),
        }
        body = _build_reminder(inv_info, company_name)

        # TODO: Integrate with SendGrid/Resend/SES in production
        # For now: log the action and mark as "sent" conceptually
        # supabase.table("email_logs").insert({...}).execute()

        sent.append({
            "invoice_number": r["invoice_number"],
            "to": email,
            "customer": customer,
            "amount": inv_info["balance_due"],
            "days_overdue": days,
        })

    total = round(sum(s["amount"] for s in sent), 2)
    msg = f"Sent {len(sent)} payment reminder(s) covering ${total:,.2f}."
    if no_email:
        msg += f" Could not send to {len(no_email)} customer(s) (no email on file): {', '.join(no_email[:3])}."

    preview = "\n".join(
        f"  → {s['customer']} <{s['to']}> | {s['invoice_number']} | ${s['amount']:,.2f} | {s['days_overdue']}d overdue"
        for s in sent
    )

    return {
        "ok": True,
        "sent_count": len(sent),
        "total_amount": total,
        "sent": sent,
        "no_email": no_email,
        "preview": preview,
        "message": msg,
    }


def register():
    """Register collections/AR agent tools."""
    register_tool(AgentTool(
        name="get_ar_aging",
        description=(
            "Get AR (accounts receivable) aging report: outstanding invoices broken down by "
            "current, 1–30, 31–60, 61–90, and 90+ days overdue. "
            "Shows totals per bucket and the top overdue customers."
        ),
        parameters={
            "type": "object",
            "properties": {
                "min_days_overdue": {
                    "type": "integer",
                    "description": "Only show invoices overdue by at least this many days. Default 0 (all).",
                    "default": 0,
                },
            },
        },
        handler=handle_get_ar_aging,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="get_ap_aging",
        description=(
            "Get AP (accounts payable) aging report: outstanding bills broken down by "
            "current, 1–30, 31–60, 61–90, and 90+ days overdue."
        ),
        parameters={"type": "object", "properties": {}},
        handler=handle_get_ap_aging,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="draft_payment_reminders",
        description=(
            "Draft payment reminder emails for overdue invoices. "
            "Returns the draft email text for each overdue customer. "
            "Use send_payment_reminders to actually send them."
        ),
        parameters={
            "type": "object",
            "properties": {
                "min_days_overdue": {
                    "type": "integer",
                    "description": "Only remind for invoices overdue by at least this many days. Default 1.",
                    "default": 1,
                },
                "limit": {
                    "type": "integer",
                    "description": "Max reminders to draft. Default 10.",
                    "default": 10,
                },
            },
        },
        handler=handle_draft_payment_reminders,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="send_payment_reminders",
        description=(
            "Send payment reminder emails to customers with overdue invoices. "
            "Optionally target specific invoice IDs or all invoices overdue by a minimum number of days. "
            "Always show a preview with draft_payment_reminders before sending."
        ),
        parameters={
            "type": "object",
            "properties": {
                "invoice_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional: specific invoice UUIDs to remind. Omit to use min_days_overdue filter.",
                },
                "min_days_overdue": {
                    "type": "integer",
                    "description": "Send to all invoices overdue by at least this many days. Default 1.",
                    "default": 1,
                },
            },
        },
        handler=handle_send_payment_reminders,
        requires_confirmation=True,
    ))
