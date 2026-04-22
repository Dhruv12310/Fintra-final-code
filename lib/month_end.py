"""
Month-end close engine.

Runs a 6-step checklist to close an accounting period:
  1. Verify bank reconciliation
  2. Flag unposted draft entries
  3. Generate accrual entries (from recurring templates due this period)
  4. Generate depreciation entries (fixed asset schedules)
  5. Snapshot financial reports
  6. Lock the accounting period

Usage:
    from lib.month_end import run_close_checklist, get_close_status, compute_depreciation

    result = await run_close_checklist(company_id, period_start, period_end, user_id)
"""

from datetime import date, timedelta
from typing import Optional, Dict, Any, List
from database import supabase


# ── Step helpers ───────────────────────────────────────────────────

def _step(number: int, title: str, status: str, detail: str, data: Any = None) -> Dict:
    return {
        "step_number": number,
        "title": title,
        "status": status,   # pass | fail | warn | skip | info
        "detail": detail,
        "data": data,
        "completed_at": str(date.today()),
    }


# ── Step 1: Bank reconciliation check ─────────────────────────────

def check_bank_reconciliation(company_id: str, period_start: str, period_end: str) -> Dict:
    """Verify all bank accounts have a completed reconciliation for this period."""
    bank_accounts = supabase.table("bank_accounts")\
        .select("id, name, mask")\
        .eq("company_id", company_id)\
        .execute().data or []

    if not bank_accounts:
        return _step(1, "Bank Reconciliation", "skip",
                     "No bank accounts connected. Skip if you don't use bank feeds.")

    unreconciled = []
    reconciled = []
    for acct in bank_accounts:
        sessions = supabase.table("reconciliation_sessions")\
            .select("id, status, statement_end")\
            .eq("company_id", company_id)\
            .eq("bank_account_id", acct["id"])\
            .eq("status", "completed")\
            .gte("statement_end", period_start)\
            .lte("statement_end", period_end)\
            .execute().data or []
        name = acct["name"] + (f" ···{acct['mask']}" if acct.get("mask") else "")
        if sessions:
            reconciled.append(name)
        else:
            unreconciled.append(name)

    if unreconciled:
        return _step(1, "Bank Reconciliation", "warn",
                     f"{len(unreconciled)} account(s) not reconciled: {', '.join(unreconciled)}. "
                     "Reconcile before closing for accurate cash balances.",
                     {"unreconciled": unreconciled, "reconciled": reconciled})
    return _step(1, "Bank Reconciliation", "pass",
                 f"All {len(reconciled)} bank account(s) reconciled for this period.",
                 {"reconciled": reconciled})


# ── Step 2: Draft entries check ────────────────────────────────────

def check_draft_entries(company_id: str, period_start: str, period_end: str) -> Dict:
    """Find any unposted draft invoices, bills, or journal entries in the period."""
    def in_period(table: str, date_col: str) -> list:
        return supabase.table(table)\
            .select("id, status")\
            .eq("company_id", company_id)\
            .eq("status", "draft")\
            .gte(date_col, period_start)\
            .lte(date_col, period_end)\
            .execute().data or []

    draft_invoices = in_period("invoices", "invoice_date")
    draft_bills = in_period("bills", "bill_date")
    draft_journals = supabase.table("journal_entries")\
        .select("id, status")\
        .eq("company_id", company_id)\
        .eq("status", "draft")\
        .gte("entry_date", period_start)\
        .lte("entry_date", period_end)\
        .execute().data or []

    issues = []
    if draft_invoices:
        issues.append(f"{len(draft_invoices)} draft invoice(s)")
    if draft_bills:
        issues.append(f"{len(draft_bills)} draft bill(s)")
    if draft_journals:
        issues.append(f"{len(draft_journals)} draft journal entr{'y' if len(draft_journals) == 1 else 'ies'}")

    if issues:
        return _step(2, "Unposted Entries", "fail",
                     f"Found {', '.join(issues)}. Post or void these before closing.",
                     {
                         "draft_invoices": len(draft_invoices),
                         "draft_bills": len(draft_bills),
                         "draft_journals": len(draft_journals),
                     })
    return _step(2, "Unposted Entries", "pass",
                 "No draft entries found in this period. All transactions are posted.")


# ── Step 3: Accrual entries (from recurring templates) ────────────

async def generate_accruals(company_id: str, period_start: str, period_end: str, user_id: str) -> Dict:
    """Process any recurring templates that fall within this period."""
    from lib.recurring import process_due_templates

    # Temporarily set date context to period_end so recurring processes "as of" that date
    due_templates = supabase.table("recurring_templates")\
        .select("id, name, template_type, next_run_date")\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .lte("next_run_date", period_end)\
        .execute().data or []

    if not due_templates:
        return _step(3, "Accrual Entries", "skip",
                     "No recurring templates due in this period.")

    result = await process_due_templates(company_id=company_id)
    created = result.get("created", 0)
    errors = result.get("errors", [])

    if errors:
        return _step(3, "Accrual Entries", "warn",
                     f"Created {created} accrual entr{'y' if created == 1 else 'ies'}, "
                     f"but {len(errors)} template(s) failed.",
                     {"created": created, "errors": errors})
    return _step(3, "Accrual Entries", "pass",
                 f"Created {created} accrual entr{'y' if created == 1 else 'ies'} from recurring templates.",
                 {"created": created})


# ── Step 4: Depreciation ──────────────────────────────────────────

def compute_depreciation(asset: Dict) -> float:
    """Compute monthly depreciation amount for a fixed asset."""
    method = asset.get("depreciation_method", "straight_line")
    cost = float(asset.get("cost", 0))
    salvage = float(asset.get("salvage_value", 0))
    life_months = int(asset.get("useful_life_months", 1)) or 1
    accumulated = float(asset.get("accumulated_depreciation", 0))

    depreciable_base = cost - salvage
    if depreciable_base <= 0:
        return 0.0

    if method == "straight_line":
        monthly = depreciable_base / life_months
    elif method == "declining_balance":
        # Double-declining: 2 × (1/life_years) × book_value_remaining
        book_value = cost - accumulated
        if book_value <= salvage:
            return 0.0
        annual_rate = 2 / (life_months / 12)
        monthly = (annual_rate * book_value) / 12
        monthly = min(monthly, book_value - salvage)
    else:
        monthly = depreciable_base / life_months  # fallback to straight-line

    # Don't depreciate beyond depreciable_base
    remaining = depreciable_base - accumulated
    return round(min(monthly, remaining), 2) if remaining > 0 else 0.0


def generate_depreciation_entries(company_id: str, period_start: str, period_end: str, user_id: str) -> Dict:
    """Generate depreciation journal entries for all active fixed assets."""
    from routes.journal_helpers import create_auto_journal_entry

    assets = supabase.table("fixed_assets")\
        .select("*")\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .execute().data or []

    if not assets:
        return _step(4, "Depreciation Entries", "skip",
                     "No fixed assets on record. Add assets in the Fixed Assets section.")

    created_entries = []
    skipped = []
    errors = []

    for asset in assets:
        # Skip if already depreciated this period
        if asset.get("last_depreciation_date") and asset["last_depreciation_date"] >= period_start:
            skipped.append(asset["name"])
            continue

        depr_amount = compute_depreciation(asset)
        if depr_amount <= 0:
            skipped.append(asset["name"] + " (fully depreciated)")
            continue

        depr_acct = asset.get("depreciation_account_id")
        accum_acct = asset.get("accumulated_account_id")

        if not depr_acct or not accum_acct:
            # Try to find defaults from COA
            depr_acct = depr_acct or _find_account_by_name(company_id, "depreciation expense")
            accum_acct = accum_acct or _find_account_by_name(company_id, "accumulated depreciation")

        if not depr_acct or not accum_acct:
            errors.append(f"{asset['name']}: missing depreciation or accumulated depreciation account")
            continue

        try:
            je = create_auto_journal_entry(
                company_id=company_id,
                entry_date=period_end,
                memo=f"Monthly depreciation — {asset['name']}",
                reference=asset.get("asset_code") or asset["id"][:8],
                source="depreciation",
                lines=[
                    {"account_id": depr_acct, "debit": depr_amount, "credit": 0,
                     "description": f"Depreciation expense — {asset['name']}"},
                    {"account_id": accum_acct, "debit": 0, "credit": depr_amount,
                     "description": f"Accumulated depreciation — {asset['name']}"},
                ],
            )
            # Update asset
            new_accumulated = float(asset["accumulated_depreciation"]) + depr_amount
            supabase.table("fixed_assets").update({
                "accumulated_depreciation": new_accumulated,
                "last_depreciation_date": period_end,
            }).eq("id", asset["id"]).execute()

            created_entries.append({
                "asset": asset["name"],
                "amount": depr_amount,
                "journal_number": je.get("journal_number"),
            })
        except Exception as e:
            errors.append(f"{asset['name']}: {e}")

    detail = (
        f"Created {len(created_entries)} depreciation entr{'y' if len(created_entries) == 1 else 'ies'}."
        + (f" Skipped {len(skipped)} (already done or fully depreciated)." if skipped else "")
        + (f" {len(errors)} error(s)." if errors else "")
    )
    status = "fail" if errors and not created_entries else ("warn" if errors else "pass")

    return _step(4, "Depreciation Entries", status, detail,
                 {"created": created_entries, "skipped": skipped, "errors": errors})


def _find_account_by_name(company_id: str, name_fragment: str) -> Optional[str]:
    rows = supabase.table("accounts")\
        .select("id, account_name")\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .ilike("account_name", f"%{name_fragment}%")\
        .limit(1).execute().data or []
    return rows[0]["id"] if rows else None


# ── Step 5: Report snapshots ───────────────────────────────────────

def snapshot_reports(company_id: str, period_start: str, period_end: str) -> Dict:
    """Generate P&L and balance sheet snapshots for the period."""
    try:
        # Compute P&L figures directly from journal entries
        rows = supabase.table("journal_entry_lines")\
            .select("debit, credit, accounts(account_type)")\
            .eq("journal_entries.company_id", company_id)\
            .execute().data or []

        # Simple approach: query accounts with balances
        accounts = supabase.table("accounts")\
            .select("id, account_type, current_balance")\
            .eq("company_id", company_id)\
            .eq("is_active", True)\
            .execute().data or []

        revenue = sum(float(a.get("current_balance") or 0) for a in accounts if a["account_type"] == "revenue")
        expenses = sum(float(a.get("current_balance") or 0) for a in accounts if a["account_type"] == "expense")
        assets = sum(float(a.get("current_balance") or 0) for a in accounts if a["account_type"] == "asset")
        liabilities = sum(float(a.get("current_balance") or 0) for a in accounts if a["account_type"] == "liability")
        equity_total = sum(float(a.get("current_balance") or 0) for a in accounts if a["account_type"] == "equity")

        net_income = round(revenue - expenses, 2)

        return _step(5, "Report Snapshots", "pass",
                     f"Period P&L: Revenue ${revenue:,.2f} | Expenses ${expenses:,.2f} | "
                     f"Net Income ${net_income:,.2f}",
                     {
                         "period_start": period_start,
                         "period_end": period_end,
                         "revenue": round(revenue, 2),
                         "expenses": round(expenses, 2),
                         "net_income": net_income,
                         "total_assets": round(assets, 2),
                         "total_liabilities": round(liabilities, 2),
                         "total_equity": round(equity_total + net_income, 2),
                     })
    except Exception as e:
        return _step(5, "Report Snapshots", "warn",
                     f"Could not snapshot reports: {e}")


# ── Step 6: Lock period ────────────────────────────────────────────

def lock_period(company_id: str, period_start: str, period_end: str, user_id: str) -> Dict:
    """Create or update an accounting_periods record to lock the period."""
    # Check if already locked
    existing = supabase.table("accounting_periods")\
        .select("id, is_closed")\
        .eq("company_id", company_id)\
        .eq("period_start", period_start)\
        .execute().data

    if existing and existing[0].get("is_closed"):
        return _step(6, "Lock Period", "info",
                     f"Period {period_start} to {period_end} is already locked.")

    try:
        if existing:
            supabase.table("accounting_periods")\
                .update({"is_closed": True, "closed_by": user_id, "closed_at": "now()"})\
                .eq("id", existing[0]["id"])\
                .execute()
        else:
            supabase.table("accounting_periods").insert({
                "company_id": company_id,
                "period_start": period_start,
                "period_end": period_end,
                "is_closed": True,
            }).execute()

        return _step(6, "Lock Period", "pass",
                     f"Period {period_start} to {period_end} has been locked. "
                     "No further entries can be posted to this period.")
    except Exception as e:
        return _step(6, "Lock Period", "fail", f"Failed to lock period: {e}")


# ── Main orchestrator ──────────────────────────────────────────────

async def run_close_checklist(
    company_id: str,
    period_start: str,
    period_end: str,
    user_id: str,
    lock: bool = True,
) -> Dict[str, Any]:
    """
    Run the full month-end close checklist.
    Returns a dict with steps list, overall_status, net_income, and period_locked.
    """
    steps = []

    # Step 1
    steps.append(check_bank_reconciliation(company_id, period_start, period_end))

    # Step 2
    steps.append(check_draft_entries(company_id, period_start, period_end))

    # Step 3 — accruals from recurring templates
    accrual_step = await generate_accruals(company_id, period_start, period_end, user_id)
    steps.append(accrual_step)

    # Step 4 — fixed asset depreciation
    steps.append(generate_depreciation_entries(company_id, period_start, period_end, user_id))

    # Step 4b — industry-specific close (WIP, prepaids, retention, etc.)
    industry_step = await generate_industry_close(company_id, period_start, period_end, user_id)
    if industry_step:
        steps.append(industry_step)

    # Step 5 — report snapshots
    report_step = snapshot_reports(company_id, period_start, period_end)
    steps.append(report_step)

    # Determine if we can proceed to lock
    blocking_failures = [s for s in steps if s["status"] == "fail"]

    # Step 6 — lock period (only if no blocking failures and lock=True)
    if lock and not blocking_failures:
        steps.append(lock_period(company_id, period_start, period_end, user_id))
    elif blocking_failures:
        steps.append(_step(6, "Lock Period", "skip",
                           f"Cannot lock: {len(blocking_failures)} step(s) failed. "
                           "Resolve issues above, then re-run close."))
    else:
        steps.append(_step(6, "Lock Period", "skip", "Lock skipped (dry run mode)."))

    # Determine overall status
    statuses = [s["status"] for s in steps]
    if "fail" in statuses:
        overall = "failed"
    elif "warn" in statuses:
        overall = "completed_with_warnings"
    else:
        overall = "completed"

    period_locked = any(s["title"] == "Lock Period" and s["status"] in ("pass", "info") for s in steps)
    net_income = (report_step.get("data") or {}).get("net_income")

    # Persist checklist record
    try:
        existing_checklist = supabase.table("close_checklists")\
            .select("id")\
            .eq("company_id", company_id)\
            .eq("period_start", period_start)\
            .execute().data

        checklist_data = {
            "company_id": company_id,
            "period_start": period_start,
            "period_end": period_end,
            "steps": steps,
            "overall_status": overall if overall != "completed_with_warnings" else "completed",
            "period_locked": period_locked,
            "net_income": net_income,
            "initiated_by": user_id,
        }
        if period_locked:
            checklist_data["completed_at"] = "now()"

        if existing_checklist:
            supabase.table("close_checklists")\
                .update(checklist_data)\
                .eq("id", existing_checklist[0]["id"])\
                .execute()
        else:
            supabase.table("close_checklists").insert(checklist_data).execute()
    except Exception:
        pass  # Non-blocking

    return {
        "period_start": period_start,
        "period_end": period_end,
        "overall_status": overall,
        "period_locked": period_locked,
        "net_income": net_income,
        "steps": steps,
        "blocking_failures": len(blocking_failures),
    }


async def generate_industry_close(
    company_id: str, period_start: str, period_end: str, user_id: str
) -> Optional[Dict]:
    """
    Dispatch to the industry-specific close handler for vertical-aware JEs.
    Returns a step dict, or None if nothing to do for this industry.
    """
    from routes.journal_helpers import create_auto_journal_entry

    co = supabase.table("companies").select("industry").eq("id", company_id).execute()
    industry = (co.data or [{}])[0].get("industry") or ""

    try:
        from lib.close import get_close_handler
        handler = get_close_handler(industry)
    except ImportError:
        return None

    created = []
    errors = []

    # Prepaid amortization (all industries)
    try:
        prepaids = handler.amortize_prepaids(company_id, period_end)
        for cje in prepaids:
            try:
                je = create_auto_journal_entry(
                    company_id=company_id,
                    entry_date=cje.entry_date,
                    memo=cje.memo,
                    reference=cje.reference,
                    source=cje.source,
                    lines=cje.lines,
                )
                created.append({"memo": cje.memo, "journal_number": je.get("journal_number")})
            except Exception as e:
                errors.append(f"{cje.memo}: {e}")
    except Exception as e:
        errors.append(f"Prepaid amortization: {e}")

    # Vertical-specific schedules (WIP, retention, etc.)
    try:
        vertical_jes = handler.generate_vertical_schedules(company_id, period_start, period_end)
        for cje in vertical_jes:
            try:
                je = create_auto_journal_entry(
                    company_id=company_id,
                    entry_date=cje.entry_date,
                    memo=cje.memo,
                    reference=cje.reference,
                    source=cje.source,
                    lines=cje.lines,
                )
                created.append({"memo": cje.memo, "journal_number": je.get("journal_number")})
            except Exception as e:
                errors.append(f"{cje.memo}: {e}")
    except Exception as e:
        errors.append(f"Vertical schedules: {e}")

    if not created and not errors:
        return None

    label = f"Industry Close ({industry})" if industry else "Prepaid Amortization"
    status = "fail" if errors and not created else ("warn" if errors else "pass")
    detail = f"Created {len(created)} entr{'y' if len(created) == 1 else 'ies'}."
    if errors:
        detail += f" {len(errors)} error(s): {'; '.join(errors[:2])}"

    return _step(5, label, status, detail, {"created": created, "errors": errors})


def transition_close_state(
    company_id: str, period_start: str, new_status: str, user_id: str
) -> Dict:
    """
    Move a close checklist to the next state in the review workflow.
    Allowed transitions: in_progress → vertical_review → controller_review → approved → locked
    """
    valid_states = [
        "in_progress", "vertical_review", "controller_review", "approved", "locked"
    ]
    if new_status not in valid_states:
        return {"ok": False, "error": f"Invalid state: {new_status}"}

    checklist = supabase.table("close_checklists")\
        .select("id, overall_status")\
        .eq("company_id", company_id)\
        .eq("period_start", period_start)\
        .order("created_at", desc=True)\
        .limit(1)\
        .execute().data

    if not checklist:
        return {"ok": False, "error": "No close checklist found for this period."}

    row = checklist[0]
    update: Dict = {"overall_status": new_status}

    if new_status == "controller_review":
        update["reviewed_by"] = user_id
    elif new_status == "approved":
        update["approved_by"] = user_id
    elif new_status == "locked":
        # Actually lock the period
        existing = supabase.table("accounting_periods")\
            .select("id")\
            .eq("company_id", company_id)\
            .eq("period_start", period_start)\
            .execute().data
        if existing:
            supabase.table("accounting_periods")\
                .update({"is_closed": True, "closed_by": user_id, "closed_at": "now()"})\
                .eq("id", existing[0]["id"]).execute()
        else:
            pe = supabase.table("close_checklists")\
                .select("period_end")\
                .eq("id", row["id"]).execute().data
            period_end = (pe[0]["period_end"] if pe else period_start)
            supabase.table("accounting_periods").insert({
                "company_id": company_id,
                "period_start": period_start,
                "period_end": period_end,
                "is_closed": True,
            }).execute()
        update["period_locked"] = True
        update["completed_at"] = "now()"

    supabase.table("close_checklists")\
        .update(update)\
        .eq("id", row["id"])\
        .execute()

    return {"ok": True, "checklist_id": row["id"], "new_status": new_status}


def generate_flux_narrative(company_id: str, period_start: str, period_end: str) -> str:
    """Generate LLM-narrated flux commentary for the close packet."""
    # Current period snapshot
    accounts = supabase.table("accounts")\
        .select("account_type, current_balance")\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .execute().data or []

    current = {
        "revenue": sum(float(a.get("current_balance") or 0) for a in accounts if a["account_type"] == "revenue"),
        "expenses": sum(float(a.get("current_balance") or 0) for a in accounts if a["account_type"] == "expense"),
    }
    current["net_income"] = round(current["revenue"] - current["expenses"], 2)

    # Prior period — use last checklist
    prior_checklist = supabase.table("close_checklists")\
        .select("net_income, steps")\
        .eq("company_id", company_id)\
        .lt("period_start", period_start)\
        .order("period_start", desc=True)\
        .limit(1)\
        .execute().data or []

    prior = {"revenue": 0, "expenses": 0, "net_income": 0}
    if prior_checklist:
        pc = prior_checklist[0]
        prior["net_income"] = float(pc.get("net_income") or 0)
        for step in (pc.get("steps") or []):
            if step.get("step_number") == 5 and step.get("data"):
                d = step["data"]
                prior["revenue"] = float(d.get("revenue") or 0)
                prior["expenses"] = float(d.get("expenses") or 0)
                break

    try:
        co = supabase.table("companies").select("industry").eq("id", company_id).execute()
        industry = (co.data or [{}])[0].get("industry") or ""
        from lib.close import get_close_handler
        handler = get_close_handler(industry)
        return handler.narrate_flux(company_id, current, prior)
    except Exception:
        return (
            f"Net income: ${current['net_income']:,.0f} "
            f"(revenue ${current['revenue']:,.0f}, expenses ${current['expenses']:,.0f})."
        )


def get_close_status(company_id: str, period_start: str) -> Optional[Dict]:
    """Retrieve the latest close checklist for a period."""
    r = supabase.table("close_checklists")\
        .select("*")\
        .eq("company_id", company_id)\
        .eq("period_start", period_start)\
        .order("created_at", desc=True)\
        .limit(1)\
        .execute()
    return r.data[0] if r.data else None
