"""
Recurring entry engine.

Processes due recurring_templates and creates journal entries, invoices, or bills.
Safe to call on a schedule (daily cron) or from the agent on demand.

Usage:
    from lib.recurring import process_due_templates, create_template, advance_next_run_date

    # Process all due entries (call daily)
    results = await process_due_templates(company_id=None)  # None = all companies

    # Create a template
    tpl = create_template(company_id, ...)
"""

from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from typing import Optional, List, Dict, Any
from database import supabase


# ── Date math ──────────────────────────────────────────────────────

def advance_next_run_date(current: date, frequency: str) -> date:
    """Compute the next run date given frequency."""
    if frequency == "daily":
        return current + timedelta(days=1)
    elif frequency == "weekly":
        return current + timedelta(weeks=1)
    elif frequency == "biweekly":
        return current + timedelta(weeks=2)
    elif frequency == "monthly":
        return current + relativedelta(months=1)
    elif frequency == "quarterly":
        return current + relativedelta(months=3)
    elif frequency == "yearly":
        return current + relativedelta(years=1)
    return current + relativedelta(months=1)


# ── Template CRUD ──────────────────────────────────────────────────

def create_template(
    company_id: str,
    name: str,
    template_type: str,
    frequency: str,
    start_date: str,
    template_data: Dict,
    description: str = "",
    end_date: Optional[str] = None,
    created_by: Optional[str] = None,
) -> Dict:
    """Insert a new recurring template."""
    row = {
        "company_id": company_id,
        "name": name,
        "template_type": template_type,
        "frequency": frequency,
        "start_date": start_date,
        "end_date": end_date,
        "next_run_date": start_date,
        "template_data": template_data,
        "description": description,
        "is_active": True,
    }
    if created_by:
        row["created_by"] = created_by

    r = supabase.table("recurring_templates").insert(row).execute()
    return r.data[0] if r.data else {}


def list_templates(company_id: str, active_only: bool = True) -> List[Dict]:
    q = supabase.table("recurring_templates")\
        .select("*")\
        .eq("company_id", company_id)
    if active_only:
        q = q.eq("is_active", True)
    return q.order("next_run_date").execute().data or []


def deactivate_template(template_id: str, company_id: str) -> bool:
    r = supabase.table("recurring_templates")\
        .update({"is_active": False})\
        .eq("id", template_id)\
        .eq("company_id", company_id)\
        .execute()
    return bool(r.data)


# ── Execution engine ───────────────────────────────────────────────

async def process_due_templates(company_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Find all templates due today or earlier and execute them.
    Returns a summary: { created: int, skipped: int, errors: list }.
    """
    today = str(date.today())

    q = supabase.table("recurring_templates")\
        .select("*")\
        .eq("is_active", True)\
        .lte("next_run_date", today)

    if company_id:
        q = q.eq("company_id", company_id)

    templates = q.execute().data or []

    created = 0
    skipped = 0
    errors = []

    for tpl in templates:
        # Check end_date
        if tpl.get("end_date") and tpl["end_date"] < today:
            supabase.table("recurring_templates")\
                .update({"is_active": False})\
                .eq("id", tpl["id"]).execute()
            skipped += 1
            continue

        try:
            je_id = await _execute_template(tpl)
            next_run = str(advance_next_run_date(date.fromisoformat(tpl["next_run_date"]), tpl["frequency"]))
            supabase.table("recurring_templates").update({
                "last_run_date": today,
                "next_run_date": next_run,
                "run_count": tpl["run_count"] + 1,
                "last_journal_entry_id": je_id,
            }).eq("id", tpl["id"]).execute()
            created += 1
        except Exception as e:
            errors.append({"template_id": tpl["id"], "name": tpl["name"], "error": str(e)})

    return {"created": created, "skipped": skipped, "errors": errors}


async def _execute_template(tpl: Dict) -> Optional[str]:
    """Execute a single template and return the created entity ID."""
    ttype = tpl["template_type"]
    data = tpl.get("template_data", {})
    company_id = tpl["company_id"]
    run_date = tpl["next_run_date"]

    if ttype == "journal":
        return _execute_journal(company_id, tpl, data, run_date)
    elif ttype == "invoice":
        return await _execute_invoice(company_id, tpl, data, run_date)
    elif ttype == "bill":
        return await _execute_bill(company_id, tpl, data, run_date)
    else:
        raise ValueError(f"Unknown template_type: {ttype}")


def _execute_journal(company_id: str, tpl: Dict, data: Dict, run_date: str) -> str:
    from routes.journal_helpers import create_auto_journal_entry
    lines = data.get("lines", [])
    if not lines:
        raise ValueError("Journal template has no lines.")

    je = create_auto_journal_entry(
        company_id=company_id,
        entry_date=run_date,
        memo=data.get("memo") or tpl["name"],
        reference=f"REC-{tpl['run_count'] + 1}",
        source="recurring",
        lines=lines,
    )
    return je["id"]


async def _execute_invoice(company_id: str, tpl: Dict, data: Dict, run_date: str) -> str:
    """Create a recurring invoice. Returns invoice ID."""
    from datetime import date as d
    customer_id = data.get("customer_id")
    if not customer_id:
        raise ValueError("Invoice template missing customer_id.")

    due_days = int(data.get("due_days", 30))
    due_date = str(d.fromisoformat(run_date) + timedelta(days=due_days))
    lines = data.get("lines", [])
    subtotal = sum(float(l.get("amount", 0)) for l in lines)

    # Next invoice number
    num_r = supabase.table("invoices").select("invoice_number").eq("company_id", company_id)\
        .order("created_at", desc=True).limit(1).execute()
    next_num = "INV-001"
    if num_r.data and num_r.data[0].get("invoice_number"):
        try:
            last = num_r.data[0]["invoice_number"]
            if last.startswith("INV-"):
                next_num = f"INV-{int(last[4:]) + 1:03d}"
        except Exception:
            pass

    inv_r = supabase.table("invoices").insert({
        "company_id": company_id,
        "customer_id": customer_id,
        "invoice_number": next_num,
        "invoice_date": run_date,
        "due_date": due_date,
        "memo": data.get("memo") or tpl["name"],
        "subtotal": subtotal,
        "tax_total": 0,
        "total": subtotal,
        "amount_paid": 0,
        "balance_due": subtotal,
        "status": "draft",
    }).execute()
    if not inv_r.data:
        raise ValueError("Failed to create invoice from template.")

    inv_id = inv_r.data[0]["id"]
    for i, line in enumerate(lines):
        supabase.table("invoice_lines").insert({
            "invoice_id": inv_id,
            "line_number": i + 1,
            "description": line.get("description", ""),
            "quantity": float(line.get("quantity", 1)),
            "unit_price": float(line.get("unit_price", line.get("amount", 0))),
            "amount": float(line.get("amount", 0)),
            "revenue_account_id": line.get("revenue_account_id"),
        }).execute()

    return inv_id


async def _execute_bill(company_id: str, tpl: Dict, data: Dict, run_date: str) -> str:
    """Create a recurring bill. Returns bill ID."""
    from datetime import date as d
    vendor_id = data.get("vendor_id")
    if not vendor_id:
        raise ValueError("Bill template missing vendor_id.")

    due_days = int(data.get("due_days", 30))
    due_date = str(d.fromisoformat(run_date) + timedelta(days=due_days))
    lines = data.get("lines", [])
    subtotal = sum(float(l.get("amount", 0)) for l in lines)

    num_r = supabase.table("bills").select("bill_number").eq("company_id", company_id)\
        .order("created_at", desc=True).limit(1).execute()
    next_num = "BILL-001"
    if num_r.data and num_r.data[0].get("bill_number"):
        try:
            last = num_r.data[0]["bill_number"]
            if last.startswith("BILL-"):
                next_num = f"BILL-{int(last[5:]) + 1:03d}"
        except Exception:
            pass

    bill_r = supabase.table("bills").insert({
        "company_id": company_id,
        "vendor_id": vendor_id,
        "bill_number": next_num,
        "bill_date": run_date,
        "due_date": due_date,
        "memo": data.get("memo") or tpl["name"],
        "subtotal": subtotal,
        "tax_total": 0,
        "total": subtotal,
        "amount_paid": 0,
        "balance_due": subtotal,
        "status": "draft",
    }).execute()
    if not bill_r.data:
        raise ValueError("Failed to create bill from template.")

    bill_id = bill_r.data[0]["id"]
    for i, line in enumerate(lines):
        supabase.table("bill_lines").insert({
            "bill_id": bill_id,
            "line_number": i + 1,
            "description": line.get("description", ""),
            "quantity": float(line.get("quantity", 1)),
            "unit_price": float(line.get("unit_price", line.get("amount", 0))),
            "amount": float(line.get("amount", 0)),
            "expense_account_id": line.get("expense_account_id"),
        }).execute()

    return bill_id
