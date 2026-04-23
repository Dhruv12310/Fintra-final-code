"""
Agent tool: Invoice operations.

Tools:
  create_invoice       — create a draft invoice (requires_confirmation=True)
  post_invoice         — post a draft invoice, auto-creates AR journal entry (requires_confirmation=True)
  list_overdue_invoices — read-only: list invoices past due date with amounts
"""

from typing import Dict, Any, List, Optional
from datetime import date, timedelta
from lib.agent.tools.registry import AgentTool, register_tool
from lib.agent.context import resolve_account_id
from database import supabase


def _resolve_customer(company_id: str, name: str) -> Optional[Dict]:
    """Fuzzy-match a customer name against contacts."""
    rows = supabase.table("contacts")\
        .select("id, display_name, email")\
        .eq("company_id", company_id)\
        .eq("contact_type", "customer")\
        .execute().data or []
    name_lower = name.lower()
    # Exact match first
    for r in rows:
        if r.get("display_name", "").lower() == name_lower:
            return r
    # Partial match
    for r in rows:
        if name_lower in r.get("display_name", "").lower():
            return r
    return None


async def handle_create_invoice(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Create a draft invoice for a customer."""
    company_id = context["company_id"]

    customer_name = arguments.get("customer_name", "")
    invoice_date = arguments.get("invoice_date") or str(date.today())
    due_days = int(arguments.get("due_days", 30))
    due_date = arguments.get("due_date") or str(date.fromisoformat(invoice_date) + timedelta(days=due_days))
    memo = arguments.get("memo", "")
    lines_input: List[Dict] = arguments.get("lines", [])

    # Resolve customer
    customer = _resolve_customer(company_id, customer_name)
    if not customer:
        return {"error": f"No customer found matching '{customer_name}'. Check Contacts or create the customer first."}

    # Resolve revenue accounts for each line
    resolved_lines = []
    for i, line in enumerate(lines_input):
        acct_id = None
        if line.get("revenue_account"):
            acct_id = await resolve_account_id(company_id, line["revenue_account"])
        amount = float(line.get("amount", 0))
        quantity = float(line.get("quantity", 1))
        unit_price = float(line.get("unit_price", amount / quantity if quantity else 0))
        resolved_lines.append({
            "line_number": i + 1,
            "description": line.get("description", ""),
            "quantity": quantity,
            "unit_price": unit_price,
            "amount": amount or round(quantity * unit_price, 2),
            "revenue_account_id": acct_id,
            "revenue_account_name": line.get("revenue_account", ""),
        })

    subtotal = sum(l["amount"] for l in resolved_lines)

    # Build preview
    preview_lines = [
        f"  Line {l['line_number']}: {l['description']} — ${l['amount']:,.2f}"
        + (f" → {l['revenue_account_name']}" if l["revenue_account_name"] else " (no revenue account assigned)")
        for l in resolved_lines
    ]
    preview = (
        f"Create invoice for {customer['display_name']}\n"
        f"  Date: {invoice_date} | Due: {due_date}\n"
        f"  Memo: {memo or '—'}\n"
        + "\n".join(preview_lines)
        + f"\n  Subtotal: ${subtotal:,.2f}"
    )

    # Execute
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
        "customer_id": customer["id"],
        "invoice_number": next_num,
        "invoice_date": invoice_date,
        "due_date": due_date,
        "memo": memo,
        "subtotal": subtotal,
        "tax_total": 0,
        "total": subtotal,
        "amount_paid": 0,
        "balance_due": subtotal,
        "status": "draft",
    }).execute()
    if not inv_r.data:
        return {"error": "Failed to create invoice in database."}

    inv = inv_r.data[0]
    for line in resolved_lines:
        supabase.table("invoice_lines").insert({
            "invoice_id": inv["id"],
            "line_number": line["line_number"],
            "description": line["description"],
            "quantity": line["quantity"],
            "unit_price": line["unit_price"],
            "amount": line["amount"],
            "revenue_account_id": line["revenue_account_id"],
        }).execute()

    return {
        "ok": True,
        "invoice_id": inv["id"],
        "invoice_number": next_num,
        "customer": customer["display_name"],
        "total": subtotal,
        "status": "draft",
        "preview": preview,
        "message": f"Created draft invoice {next_num} for {customer['display_name']} — ${subtotal:,.2f}. Use post_invoice to record the AR journal entry.",
    }


async def handle_post_invoice(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Post a draft invoice — creates the AR journal entry (DR AR / CR Revenue)."""
    company_id = context["company_id"]
    invoice_id = arguments.get("invoice_id")
    invoice_number = arguments.get("invoice_number")

    # Resolve by ID or number
    if not invoice_id and invoice_number:
        r = supabase.table("invoices")\
            .select("id, invoice_number, status, total, customer_id, contacts(display_name)")\
            .eq("company_id", company_id)\
            .eq("invoice_number", invoice_number)\
            .single().execute()
        if r.data:
            invoice_id = r.data["id"]

    if not invoice_id:
        return {"error": "Provide invoice_id or invoice_number to post."}

    inv_r = supabase.table("invoices")\
        .select("*, invoice_lines(*), contacts(display_name)")\
        .eq("id", invoice_id)\
        .eq("company_id", company_id)\
        .single().execute()
    if not inv_r.data:
        return {"error": f"Invoice {invoice_id} not found."}

    inv = inv_r.data
    if inv["status"] not in ("draft", "sent"):
        return {"error": f"Invoice is already '{inv['status']}'. Only draft or sent invoices can be posted."}
    if inv.get("linked_journal_entry_id"):
        return {"error": "Invoice already has a journal entry linked."}

    lines = inv.get("invoice_lines", [])
    missing_acct = [l for l in lines if not l.get("revenue_account_id")]
    if missing_acct:
        return {
            "error": f"{len(missing_acct)} line(s) are missing a revenue account. Assign them in the Invoices page before posting.",
            "lines_missing_account": [l.get("description", f"line {l.get('line_number')}") for l in missing_acct],
        }

    # Build preview
    customer_name = (inv.get("contacts") or {}).get("display_name", "Unknown Customer")
    preview = (
        f"Post invoice {inv['invoice_number']} for {customer_name}\n"
        f"  Total: ${inv['total']:,.2f}\n"
        f"  Journal: DR Accounts Receivable ${inv['total']:,.2f} / CR Revenue lines\n"
        f"  Status will change: {inv['status']} → posted"
    )

    # Execute via invoices route logic
    from routes.journal_helpers import create_auto_journal_entry, get_ar_account
    ar_account_id = get_ar_account(company_id)
    total = inv.get("total", 0) or 0

    journal_lines = [{
        "account_id": ar_account_id,
        "debit": total,
        "credit": 0,
        "description": f"AR for {inv['invoice_number']}",
        "contact_id": inv.get("customer_id"),
    }]
    for line in lines:
        journal_lines.append({
            "account_id": line["revenue_account_id"],
            "debit": 0,
            "credit": line.get("amount", 0) or 0,
            "description": line.get("description") or f"Revenue - {inv['invoice_number']}",
            "contact_id": inv.get("customer_id"),
        })

    je = create_auto_journal_entry(
        company_id=company_id,
        entry_date=inv.get("invoice_date"),
        memo=f"Invoice {inv['invoice_number']} posted",
        reference=inv["invoice_number"],
        source="invoice",
        lines=journal_lines,
    )

    supabase.table("invoices").update({
        "status": "posted",
        "linked_journal_entry_id": je["id"],
    }).eq("id", invoice_id).execute()

    return {
        "ok": True,
        "invoice_number": inv["invoice_number"],
        "journal_number": je.get("journal_number"),
        "total": total,
        "preview": preview,
        "message": f"Invoice {inv['invoice_number']} posted. Journal entry {je.get('journal_number')} created — DR AR ${total:,.2f}.",
    }


async def handle_list_overdue_invoices(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """List overdue invoices (past due date, unpaid)."""
    company_id = context["company_id"]
    today = str(date.today())
    limit = int(arguments.get("limit", 20))

    rows = supabase.table("invoices")\
        .select("id, invoice_number, invoice_date, due_date, total, balance_due, status, contacts(display_name, email)")\
        .eq("company_id", company_id)\
        .in_("status", ["posted", "sent"])\
        .lt("due_date", today)\
        .gt("balance_due", 0)\
        .order("due_date", desc=False)\
        .limit(limit)\
        .execute().data or []

    total_overdue = sum(r.get("balance_due", 0) for r in rows)

    formatted = []
    for r in rows:
        days_overdue = (date.today() - date.fromisoformat(r["due_date"])).days
        bucket = "90+" if days_overdue > 90 else "61-90" if days_overdue > 60 else "31-60" if days_overdue > 30 else "1-30"
        formatted.append({
            "invoice_number": r["invoice_number"],
            "customer": (r.get("contacts") or {}).get("display_name", "Unknown"),
            "due_date": r["due_date"],
            "days_overdue": days_overdue,
            "aging_bucket": bucket,
            "balance_due": r["balance_due"],
        })

    if not formatted:
        return {"message": "No overdue invoices.", "count": 0, "total_overdue": 0}

    summary = f"{len(formatted)} overdue invoice(s) totaling ${total_overdue:,.2f}."
    buckets: Dict[str, float] = {}
    for r in formatted:
        buckets[r["aging_bucket"]] = buckets.get(r["aging_bucket"], 0) + r["balance_due"]

    return {
        "count": len(formatted),
        "total_overdue": total_overdue,
        "aging_buckets": buckets,
        "invoices": formatted,
        "message": summary,
    }


def register():
    """Register invoice agent tools."""
    register_tool(AgentTool(
        name="create_invoice",
        description=(
            "Create a new draft invoice for a customer. "
            "Specify the customer name, line items (description, amount, revenue account), "
            "invoice date, and due date or payment terms. "
            "Returns the invoice number and a preview before saving."
        ),
        parameters={
            "type": "object",
            "properties": {
                "customer_name": {
                    "type": "string",
                    "description": "Customer name as it appears in Contacts",
                },
                "lines": {
                    "type": "array",
                    "description": "Invoice line items",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "amount": {"type": "number", "description": "Line total amount in USD"},
                            "quantity": {"type": "number", "default": 1},
                            "unit_price": {"type": "number"},
                            "revenue_account": {"type": "string", "description": "Revenue account name or code (e.g. 'Service Revenue', '4000')"},
                        },
                        "required": ["description", "amount"],
                    },
                },
                "invoice_date": {
                    "type": "string",
                    "description": "Invoice date in YYYY-MM-DD format. Defaults to today.",
                },
                "due_date": {
                    "type": "string",
                    "description": "Due date in YYYY-MM-DD format.",
                },
                "due_days": {
                    "type": "integer",
                    "description": "Days until due (used if due_date not provided). Default 30.",
                    "default": 30,
                },
                "memo": {
                    "type": "string",
                    "description": "Optional memo or note on the invoice",
                },
            },
            "required": ["customer_name", "lines"],
        },
        handler=handle_create_invoice,
        requires_confirmation=True,
    ))

    register_tool(AgentTool(
        name="post_invoice",
        description=(
            "Post a draft or sent invoice. Creates the accounting journal entry: "
            "DR Accounts Receivable / CR Revenue. Changes invoice status to 'posted'. "
            "Requires revenue accounts to be assigned to all line items."
        ),
        parameters={
            "type": "object",
            "properties": {
                "invoice_id": {
                    "type": "string",
                    "description": "UUID of the invoice to post",
                },
                "invoice_number": {
                    "type": "string",
                    "description": "Invoice number (e.g. 'INV-042') — alternative to invoice_id",
                },
            },
        },
        handler=handle_post_invoice,
        requires_confirmation=True,
    ))

    register_tool(AgentTool(
        name="list_overdue_invoices",
        description=(
            "List all overdue invoices (past due date with outstanding balance). "
            "Returns aging breakdown (1-30, 31-60, 61-90, 90+ days) and total AR overdue."
        ),
        parameters={
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Max invoices to return. Default 20.",
                    "default": 20,
                },
            },
        },
        handler=handle_list_overdue_invoices,
        requires_confirmation=False,
    ))
