"""
Agent tool: Month-end close automation.

Tools:
  run_month_end_close    — run the 6-step close checklist (requires_confirmation=True for lock)
  get_close_status       — read-only: get last close checklist result for a period
  list_fixed_assets      — read-only: list active fixed assets and their depreciation schedule
  add_fixed_asset        — add a fixed asset record (requires_confirmation=True)
"""

from typing import Dict, Any, Optional
from datetime import date
from database import supabase
from lib.agent.tools.registry import AgentTool, register_tool


async def handle_run_month_end_close(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Run the month-end close checklist for a period."""
    company_id = context["company_id"]
    user_id = context.get("user_id", "")

    period_str = arguments.get("period")  # e.g. "2026-03" or "March 2026"
    lock = arguments.get("lock", True)

    # Parse period
    period_start, period_end = _parse_period(period_str)
    if not period_start:
        return {
            "error": f"Could not parse period '{period_str}'. "
                     "Use format 'YYYY-MM', 'March 2026', or provide period_start and period_end.",
        }

    # Override with explicit dates if provided
    period_start = arguments.get("period_start") or period_start
    period_end = arguments.get("period_end") or period_end

    preview = (
        f"Run month-end close for {period_start} to {period_end}\n"
        f"  Steps: (1) Bank reconciliation → (2) Unposted entries → "
        f"(3) Accruals → (4) Depreciation → (5) Reports → (6) Lock period\n"
        f"  Lock period: {'Yes' if lock else 'No (dry run)'}"
    )

    from lib.month_end import run_close_checklist
    result = await run_close_checklist(
        company_id=company_id,
        period_start=period_start,
        period_end=period_end,
        user_id=user_id,
        lock=lock,
    )

    steps_summary = []
    for s in result.get("steps", []):
        icon = {"pass": "✓", "fail": "✗", "warn": "!", "skip": "—", "info": "i"}.get(s["status"], "?")
        steps_summary.append(f"  {icon} Step {s['step_number']}: {s['title']} — {s['detail']}")

    net_income = result.get("net_income")
    locked_msg = "Period locked." if result.get("period_locked") else "Period NOT locked."

    return {
        "ok": result["overall_status"] != "failed",
        "period": f"{period_start} to {period_end}",
        "overall_status": result["overall_status"],
        "period_locked": result.get("period_locked", False),
        "net_income": net_income,
        "blocking_failures": result.get("blocking_failures", 0),
        "steps": result.get("steps", []),
        "preview": preview,
        "message": (
            f"Month-end close for {period_start} to {period_end}: {result['overall_status'].replace('_', ' ').title()}. "
            + (f"Net income: ${net_income:,.2f}. " if net_income is not None else "")
            + locked_msg
            + (" Resolve failures above before closing." if result.get("blocking_failures") else "")
        ),
        "steps_summary": "\n".join(steps_summary),
    }


async def handle_get_close_status(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Get the last close checklist result for a period."""
    company_id = context["company_id"]
    period_str = arguments.get("period")
    period_start = arguments.get("period_start")

    if not period_start and period_str:
        period_start, _ = _parse_period(period_str)

    if not period_start:
        # List recent checklists
        rows = supabase.table("close_checklists")\
            .select("period_start, period_end, overall_status, period_locked, net_income, created_at")\
            .eq("company_id", company_id)\
            .order("period_start", desc=True)\
            .limit(6)\
            .execute().data or []

        if not rows:
            return {"message": "No close checklists found. Run 'close the books for [month]' to start."}

        return {
            "recent_closes": [
                {
                    "period": f"{r['period_start']} to {r['period_end']}",
                    "status": r["overall_status"],
                    "locked": r["period_locked"],
                    "net_income": r.get("net_income"),
                }
                for r in rows
            ],
            "message": f"{len(rows)} close checklist(s) found.",
        }

    from lib.month_end import get_close_status
    result = get_close_status(company_id, period_start)
    if not result:
        return {"message": f"No close checklist found for period starting {period_start}."}

    return {
        "period": f"{result['period_start']} to {result['period_end']}",
        "overall_status": result["overall_status"],
        "period_locked": result["period_locked"],
        "net_income": result.get("net_income"),
        "steps": result.get("steps", []),
        "message": f"Close status for {result['period_start']}: {result['overall_status']}. "
                   f"{'Period is locked.' if result['period_locked'] else 'Period not locked.'}",
    }


async def handle_list_fixed_assets(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """List active fixed assets with depreciation schedules."""
    company_id = context["company_id"]
    include_disposed = arguments.get("include_disposed", False)

    q = supabase.table("fixed_assets")\
        .select("id, name, description, asset_code, purchase_date, cost, salvage_value, "
                "useful_life_months, depreciation_method, accumulated_depreciation, last_depreciation_date")\
        .eq("company_id", company_id)
    if not include_disposed:
        q = q.eq("is_active", True)

    assets = q.order("purchase_date").execute().data or []

    if not assets:
        return {"message": "No fixed assets on record.", "count": 0, "assets": []}

    from lib.month_end import compute_depreciation
    formatted = []
    for a in assets:
        monthly_depr = compute_depreciation(a)
        book_value = float(a["cost"]) - float(a["accumulated_depreciation"])
        remaining_months = int((book_value - float(a["salvage_value"])) / monthly_depr) if monthly_depr else 0
        formatted.append({
            "id": a["id"],
            "name": a["name"],
            "asset_code": a.get("asset_code"),
            "purchase_date": a["purchase_date"],
            "cost": float(a["cost"]),
            "accumulated_depreciation": float(a["accumulated_depreciation"]),
            "book_value": round(book_value, 2),
            "monthly_depreciation": monthly_depr,
            "remaining_months": max(0, remaining_months),
            "method": a["depreciation_method"],
            "last_depreciation_date": a.get("last_depreciation_date"),
        })

    total_cost = sum(a["cost"] for a in formatted)
    total_book_value = sum(a["book_value"] for a in formatted)

    return {
        "count": len(formatted),
        "total_cost": round(total_cost, 2),
        "total_book_value": round(total_book_value, 2),
        "assets": formatted,
        "message": f"{len(assets)} fixed asset(s) on record. Total book value: ${total_book_value:,.2f}.",
    }


async def handle_add_fixed_asset(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Add a new fixed asset to the schedule."""
    company_id = context["company_id"]
    user_id = context.get("user_id")

    name = arguments.get("name", "")
    cost = float(arguments.get("cost", 0))
    purchase_date = arguments.get("purchase_date") or str(date.today())
    useful_life_months = int(arguments.get("useful_life_months", 60))
    salvage_value = float(arguments.get("salvage_value", 0))
    method = arguments.get("depreciation_method", "straight_line")

    if not name:
        return {"error": "Asset name is required."}
    if cost <= 0:
        return {"error": "Cost must be greater than 0."}
    if useful_life_months <= 0:
        return {"error": "useful_life_months must be > 0."}

    # Resolve GL accounts by name if provided
    from lib.agent.context import resolve_account_id
    asset_acct_id = None
    depr_acct_id = None
    accum_acct_id = None
    if arguments.get("asset_account"):
        asset_acct_id = await resolve_account_id(company_id, arguments["asset_account"])
    if arguments.get("depreciation_account"):
        depr_acct_id = await resolve_account_id(company_id, arguments["depreciation_account"])
    if arguments.get("accumulated_account"):
        accum_acct_id = await resolve_account_id(company_id, arguments["accumulated_account"])

    monthly_depr = round((cost - salvage_value) / useful_life_months, 2)
    life_years = useful_life_months / 12

    preview = (
        f"Add fixed asset: {name}\n"
        f"  Cost: ${cost:,.2f} | Purchase date: {purchase_date}\n"
        f"  Useful life: {useful_life_months} months ({life_years:.1f} years)\n"
        f"  Method: {method.replace('_', ' ').title()}\n"
        f"  Monthly depreciation: ${monthly_depr:,.2f} | Salvage value: ${salvage_value:,.2f}"
    )

    r = supabase.table("fixed_assets").insert({
        "company_id": company_id,
        "name": name,
        "description": arguments.get("description"),
        "asset_code": arguments.get("asset_code"),
        "purchase_date": purchase_date,
        "cost": cost,
        "salvage_value": salvage_value,
        "useful_life_months": useful_life_months,
        "depreciation_method": method,
        "accumulated_depreciation": 0,
        "asset_account_id": asset_acct_id,
        "depreciation_account_id": depr_acct_id,
        "accumulated_account_id": accum_acct_id,
        "is_active": True,
        "created_by": user_id,
    }).execute()

    if not r.data:
        return {"error": "Failed to save fixed asset."}

    return {
        "ok": True,
        "asset_id": r.data[0]["id"],
        "name": name,
        "monthly_depreciation": monthly_depr,
        "preview": preview,
        "message": f"Fixed asset '{name}' added. Monthly depreciation: ${monthly_depr:,.2f}.",
    }


def _parse_period(period_str: Optional[str]):
    """Parse a period string into (period_start, period_end) dates."""
    if not period_str:
        # Default to last completed month
        today = date.today()
        first_of_month = today.replace(day=1)
        last_month_end = first_of_month - __import__('datetime').timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)
        return str(last_month_start), str(last_month_end)

    period_str = period_str.strip()

    # Try YYYY-MM format
    if len(period_str) == 7 and period_str[4] == "-":
        try:
            year, month = int(period_str[:4]), int(period_str[5:])
            from calendar import monthrange
            _, last_day = monthrange(year, month)
            start = f"{year}-{month:02d}-01"
            end = f"{year}-{month:02d}-{last_day:02d}"
            return start, end
        except ValueError:
            pass

    # Try "Month YYYY" or "Month, YYYY"
    months = {
        "january": 1, "february": 2, "march": 3, "april": 4,
        "may": 5, "june": 6, "july": 7, "august": 8,
        "september": 9, "october": 10, "november": 11, "december": 12,
    }
    parts = period_str.lower().replace(",", "").split()
    if len(parts) == 2:
        month_num = months.get(parts[0])
        if month_num and parts[1].isdigit():
            year = int(parts[1])
            from calendar import monthrange
            _, last_day = monthrange(year, month_num)
            start = f"{year}-{month_num:02d}-01"
            end = f"{year}-{month_num:02d}-{last_day:02d}"
            return start, end

    return None, None


def register():
    """Register close/fixed asset agent tools."""
    register_tool(AgentTool(
        name="run_month_end_close",
        description=(
            "Run the 6-step month-end close checklist for a period: "
            "(1) verify bank reconciliation, (2) flag draft entries, "
            "(3) post accruals from recurring templates, (4) generate depreciation entries, "
            "(5) snapshot P&L and balance sheet, (6) lock the accounting period. "
            "Specify the period as 'March 2026', '2026-03', or provide period_start/period_end dates. "
            "Set lock=false to do a dry run without locking the period."
        ),
        parameters={
            "type": "object",
            "properties": {
                "period": {
                    "type": "string",
                    "description": "Period to close, e.g. 'March 2026', '2026-03', 'last month'",
                },
                "period_start": {
                    "type": "string",
                    "description": "Override: period start date YYYY-MM-DD",
                },
                "period_end": {
                    "type": "string",
                    "description": "Override: period end date YYYY-MM-DD",
                },
                "lock": {
                    "type": "boolean",
                    "description": "Whether to lock the period after closing. Default true.",
                    "default": True,
                },
            },
        },
        handler=handle_run_month_end_close,
        requires_confirmation=True,
    ))

    register_tool(AgentTool(
        name="get_close_status",
        description=(
            "Get the current status of month-end close for a period. "
            "Shows which steps passed/failed and whether the period is locked. "
            "Omit period to see recent close history."
        ),
        parameters={
            "type": "object",
            "properties": {
                "period": {
                    "type": "string",
                    "description": "Period to check, e.g. 'March 2026' or '2026-03'",
                },
            },
        },
        handler=handle_get_close_status,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="list_fixed_assets",
        description="List all fixed assets with their depreciation schedules, book values, and monthly depreciation amounts.",
        parameters={
            "type": "object",
            "properties": {
                "include_disposed": {
                    "type": "boolean",
                    "description": "Include disposed/inactive assets. Default false.",
                    "default": False,
                },
            },
        },
        handler=handle_list_fixed_assets,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="add_fixed_asset",
        description=(
            "Add a fixed asset to the depreciation schedule. "
            "Specify the asset name, cost, purchase date, useful life in months, and depreciation method. "
            "Straight-line is the default method."
        ),
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Asset name, e.g. 'MacBook Pro 2026'"},
                "cost": {"type": "number", "description": "Purchase cost in USD"},
                "purchase_date": {"type": "string", "description": "Purchase date YYYY-MM-DD"},
                "useful_life_months": {
                    "type": "integer",
                    "description": "Useful life in months (e.g. 60 = 5 years, 36 = 3 years)",
                },
                "salvage_value": {
                    "type": "number",
                    "description": "Estimated salvage/residual value at end of life. Default 0.",
                    "default": 0,
                },
                "depreciation_method": {
                    "type": "string",
                    "enum": ["straight_line", "declining_balance"],
                    "description": "Depreciation method. Default: straight_line.",
                    "default": "straight_line",
                },
                "description": {"type": "string"},
                "asset_code": {"type": "string", "description": "Optional internal asset code e.g. FA-001"},
                "asset_account": {"type": "string", "description": "GL account name for the asset (e.g. 'Equipment')"},
                "depreciation_account": {"type": "string", "description": "GL account name for depreciation expense"},
                "accumulated_account": {"type": "string", "description": "GL account name for accumulated depreciation"},
            },
            "required": ["name", "cost", "useful_life_months"],
        },
        handler=handle_add_fixed_asset,
        requires_confirmation=True,
    ))
