"""
Agent tool: Recurring entry management.

Tools:
  create_recurring_entry  — set up a recurring journal/invoice/bill (requires_confirmation=True)
  list_recurring_entries  — read-only: list active recurring templates
  run_due_recurring       — process all entries due today (requires_confirmation=False)
"""

from typing import Dict, Any
from datetime import date
from lib.agent.tools.registry import AgentTool, register_tool
from lib.agent.context import resolve_account_id
from database import supabase


async def handle_create_recurring_entry(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Create a recurring template from natural language."""
    company_id = context["company_id"]
    user_id = context.get("user_id")

    template_type = arguments.get("type", "journal").lower()
    name = arguments.get("name", "")
    frequency = arguments.get("frequency", "monthly").lower()
    start_date = arguments.get("start_date") or str(date.today())
    end_date = arguments.get("end_date")
    memo = arguments.get("memo", name)

    if template_type == "journal":
        lines_input = arguments.get("lines", [])
        if not lines_input:
            return {"error": "Journal recurring entry requires at least one line with account, debit/credit amounts."}

        resolved_lines = []
        for line in lines_input:
            acct_id = await resolve_account_id(company_id, line.get("account", ""))
            if not acct_id:
                return {"error": f"Could not find account matching '{line.get('account')}'. Check your Chart of Accounts."}
            resolved_lines.append({
                "account_id": acct_id,
                "account_name": line.get("account", ""),
                "debit": float(line.get("debit", 0)),
                "credit": float(line.get("credit", 0)),
                "description": line.get("description", memo),
            })

        # Validate balance
        total_debit = sum(l["debit"] for l in resolved_lines)
        total_credit = sum(l["credit"] for l in resolved_lines)
        if abs(total_debit - total_credit) > 0.01:
            return {"error": f"Journal entry is not balanced: debits ${total_debit:,.2f} ≠ credits ${total_credit:,.2f}."}

        template_data = {"memo": memo, "lines": resolved_lines}
        preview_lines = [
            f"  DR {l['account_name']} ${l['debit']:,.2f}" if l["debit"] else f"  CR {l['account_name']} ${l['credit']:,.2f}"
            for l in resolved_lines
        ]

    elif template_type == "invoice":
        customer_name = arguments.get("customer_name", "")
        lines_input = arguments.get("lines", [])

        # Resolve customer
        from lib.agent.tools.invoice_tool import _resolve_customer
        customer = _resolve_customer(company_id, customer_name)
        if not customer:
            return {"error": f"No customer found matching '{customer_name}'."}

        resolved_lines = []
        for i, line in enumerate(lines_input):
            acct_id = None
            if line.get("revenue_account"):
                acct_id = await resolve_account_id(company_id, line["revenue_account"])
            resolved_lines.append({
                "description": line.get("description", ""),
                "amount": float(line.get("amount", 0)),
                "quantity": float(line.get("quantity", 1)),
                "unit_price": float(line.get("unit_price", line.get("amount", 0))),
                "revenue_account_id": acct_id,
            })

        template_data = {
            "customer_id": customer["id"],
            "customer_name": customer["display_name"],
            "due_days": int(arguments.get("due_days", 30)),
            "memo": memo,
            "lines": resolved_lines,
        }
        subtotal = sum(l["amount"] for l in resolved_lines)
        preview_lines = [f"  {l['description']} — ${l['amount']:,.2f}" for l in resolved_lines]
        preview_lines.append(f"  Total: ${subtotal:,.2f} for {customer['display_name']}")

    elif template_type == "bill":
        vendor_name = arguments.get("vendor_name", "")
        lines_input = arguments.get("lines", [])

        # Resolve vendor
        vendor_rows = supabase.table("contacts")\
            .select("id, display_name")\
            .eq("company_id", company_id)\
            .eq("contact_type", "vendor")\
            .execute().data or []
        vendor = next((v for v in vendor_rows if vendor_name.lower() in v["display_name"].lower()), None)
        if not vendor:
            return {"error": f"No vendor found matching '{vendor_name}'."}

        resolved_lines = []
        for line in lines_input:
            acct_id = None
            if line.get("expense_account"):
                acct_id = await resolve_account_id(company_id, line["expense_account"])
            resolved_lines.append({
                "description": line.get("description", ""),
                "amount": float(line.get("amount", 0)),
                "quantity": float(line.get("quantity", 1)),
                "unit_price": float(line.get("unit_price", line.get("amount", 0))),
                "expense_account_id": acct_id,
            })

        template_data = {
            "vendor_id": vendor["id"],
            "vendor_name": vendor["display_name"],
            "due_days": int(arguments.get("due_days", 30)),
            "memo": memo,
            "lines": resolved_lines,
        }
        subtotal = sum(l["amount"] for l in resolved_lines)
        preview_lines = [f"  {l['description']} — ${l['amount']:,.2f}" for l in resolved_lines]
        preview_lines.append(f"  Total: ${subtotal:,.2f} from {vendor['display_name']}")

    else:
        return {"error": f"Unknown type '{template_type}'. Use 'journal', 'invoice', or 'bill'."}

    preview = (
        f"Create recurring {template_type}: {name}\n"
        f"  Frequency: {frequency} | Starting: {start_date}"
        + (f" | Until: {end_date}" if end_date else " | Ongoing")
        + "\n"
        + "\n".join(preview_lines)
    )

    from lib.recurring import create_template
    tpl = create_template(
        company_id=company_id,
        name=name,
        template_type=template_type,
        frequency=frequency,
        start_date=start_date,
        template_data=template_data,
        end_date=end_date,
        created_by=user_id,
    )

    return {
        "ok": True,
        "template_id": tpl.get("id"),
        "name": name,
        "type": template_type,
        "frequency": frequency,
        "next_run_date": start_date,
        "preview": preview,
        "message": f"Recurring {template_type} '{name}' set up. First run: {start_date}, then every {frequency}.",
    }


async def handle_list_recurring_entries(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """List active recurring templates."""
    company_id = context["company_id"]
    from lib.recurring import list_templates
    templates = list_templates(company_id, active_only=not arguments.get("include_inactive", False))

    if not templates:
        return {"message": "No active recurring entries.", "count": 0, "templates": []}

    formatted = [
        {
            "id": t["id"],
            "name": t["name"],
            "type": t["template_type"],
            "frequency": t["frequency"],
            "next_run_date": t["next_run_date"],
            "last_run_date": t.get("last_run_date"),
            "run_count": t["run_count"],
            "is_active": t["is_active"],
        }
        for t in templates
    ]

    today = str(date.today())
    due_now = [t for t in formatted if t["next_run_date"] <= today]

    return {
        "count": len(formatted),
        "due_now": len(due_now),
        "templates": formatted,
        "message": f"{len(formatted)} recurring template(s). {len(due_now)} due now.",
    }


async def handle_run_due_recurring(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Process all recurring entries due today."""
    company_id = context["company_id"]
    from lib.recurring import process_due_templates
    result = await process_due_templates(company_id=company_id)

    if result["created"] == 0 and not result["errors"]:
        return {"message": "No recurring entries are due today.", "created": 0}

    msg = f"Processed recurring entries: {result['created']} created"
    if result["skipped"]:
        msg += f", {result['skipped']} skipped (expired)"
    if result["errors"]:
        msg += f", {len(result['errors'])} failed"

    return {
        "ok": True,
        "created": result["created"],
        "skipped": result["skipped"],
        "errors": result["errors"],
        "message": msg,
    }


def register():
    """Register recurring agent tools."""
    register_tool(AgentTool(
        name="create_recurring_entry",
        description=(
            "Set up a recurring journal entry, invoice, or bill. "
            "Specify the type, name, frequency (daily/weekly/biweekly/monthly/quarterly/yearly), "
            "start date, and the entry details (lines, accounts, amounts). "
            "Example: 'Set up monthly rent expense of $3,000 debiting Rent Expense, crediting Cash'."
        ),
        parameters={
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["journal", "invoice", "bill"],
                    "description": "Type of recurring entry",
                },
                "name": {
                    "type": "string",
                    "description": "Display name for this recurring template (e.g. 'Monthly Rent')",
                },
                "frequency": {
                    "type": "string",
                    "enum": ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"],
                    "description": "How often to create this entry",
                },
                "start_date": {
                    "type": "string",
                    "description": "First run date in YYYY-MM-DD. Defaults to today.",
                },
                "end_date": {
                    "type": "string",
                    "description": "Last run date (optional). Omit for ongoing.",
                },
                "memo": {
                    "type": "string",
                    "description": "Memo to use on each created entry",
                },
                "lines": {
                    "type": "array",
                    "description": "Line items. For journal: [{account, debit, credit, description}]. For invoice/bill: [{description, amount, revenue_account or expense_account}].",
                    "items": {"type": "object"},
                },
                "customer_name": {
                    "type": "string",
                    "description": "Customer name (for invoice type only)",
                },
                "vendor_name": {
                    "type": "string",
                    "description": "Vendor name (for bill type only)",
                },
                "due_days": {
                    "type": "integer",
                    "description": "Days until due for invoice/bill. Default 30.",
                    "default": 30,
                },
            },
            "required": ["type", "name", "frequency", "lines"],
        },
        handler=handle_create_recurring_entry,
        requires_confirmation=True,
    ))

    register_tool(AgentTool(
        name="list_recurring_entries",
        description="List all active recurring journal entries, invoices, and bills. Shows next run dates.",
        parameters={
            "type": "object",
            "properties": {
                "include_inactive": {
                    "type": "boolean",
                    "description": "Include deactivated templates. Default false.",
                    "default": False,
                },
            },
        },
        handler=handle_list_recurring_entries,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="run_due_recurring",
        description=(
            "Process all recurring entries that are due today. "
            "Creates journal entries, invoices, or bills as configured. "
            "Safe to run multiple times — only processes entries due on or before today."
        ),
        parameters={"type": "object", "properties": {}},
        handler=handle_run_due_recurring,
        requires_confirmation=False,
    ))
