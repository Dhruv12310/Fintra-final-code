"""
Construction industry close handler.

Implements:
1. WIP schedule + percentage-of-completion revenue recognition
2. Retention receivable reclass (split from AR on period close)
3. Job-cost rollup in flux narrative

All journal entries use create_auto_journal_entry from routes/journal_helpers.py.
Account lookups use subtype matching to find the right GL accounts.
"""

import os
from database import supabase
from lib.close.base import CloseHandler, CloseJE, CloseWarning
from lib.close.default import DefaultHandler


class ConstructionHandler(CloseHandler):
    industry_key = "Construction"

    def pre_close_checks(self, company_id: str, period_start: str, period_end: str) -> list[CloseWarning]:
        warnings: list[CloseWarning] = []

        # Check for active projects with no costs recorded this period
        projects = supabase.table("projects")\
            .select("id, name, contract_value, estimated_total_costs")\
            .eq("company_id", company_id)\
            .eq("status", "active")\
            .is_("deleted_at", "null")\
            .execute().data or []

        for p in projects:
            if float(p.get("estimated_total_costs") or 0) == 0:
                warnings.append(CloseWarning(
                    code="project_no_budget",
                    message=f"Project '{p['name']}' has no estimated total cost — WIP % complete cannot be computed.",
                    severity="warn",
                ))

        # Check WIP accounts exist in COA
        for subtype in ("unbilled_revenue", "billings_in_excess"):
            acct = _find_account_by_subtype(company_id, subtype)
            if not acct:
                warnings.append(CloseWarning(
                    code=f"missing_{subtype}_account",
                    message=f"No '{subtype}' account found in Chart of Accounts. "
                            "Add one to enable WIP revenue recognition.",
                    severity="warn",
                ))

        return warnings

    def generate_vertical_schedules(self, company_id: str, period_start: str, period_end: str) -> list[CloseJE]:
        jes: list[CloseJE] = []
        jes.extend(self._wip_entries(company_id, period_end))
        jes.extend(self._retention_reclass(company_id, period_end))
        return jes

    def amortize_prepaids(self, company_id: str, period_end: str) -> list[CloseJE]:
        # Delegate to default implementation
        return DefaultHandler().amortize_prepaids(company_id, period_end)

    def narrate_flux(self, company_id: str, current_period: dict, prior_period: dict) -> str:
        project_summary = self._project_cost_summary(company_id)
        if not os.getenv("ANTHROPIC_API_KEY"):
            return _construction_narrative(current_period, prior_period, project_summary)

        try:
            import anthropic
            client = anthropic.Anthropic()
            c_rev = current_period.get("revenue", 0)
            p_rev = prior_period.get("revenue", 0)
            c_exp = current_period.get("expenses", 0)
            p_exp = prior_period.get("expenses", 0)
            c_ni = current_period.get("net_income", 0)
            p_ni = prior_period.get("net_income", 0)

            proj_lines = "\n".join(
                f"  {p['name']}: ${p['total_cost']:,.0f} costs, "
                f"{p['pct_complete']:.0f}% complete, ${p['earned_revenue']:,.0f} earned"
                for p in project_summary[:5]
            ) or "  No active projects."

            prompt = (
                f"Write a 4-6 sentence construction CFO close narrative. "
                f"Period: Revenue ${c_rev:,.0f}, Expenses ${c_exp:,.0f}, Net ${c_ni:,.0f}. "
                f"Prior: Revenue ${p_rev:,.0f}, Expenses ${p_exp:,.0f}, Net ${p_ni:,.0f}. "
                f"Project status:\n{proj_lines}\n"
                "Mention % complete, over/under-billing if relevant. Professional tone, no markdown."
            )
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            return msg.content[0].text.strip()
        except Exception:
            return _construction_narrative(current_period, prior_period, project_summary)

    # ── Private helpers ─────────────────────────────────────────────

    def _wip_entries(self, company_id: str, period_end: str) -> list[CloseJE]:
        projects = supabase.table("projects")\
            .select("id, name, contract_value, estimated_total_costs, status")\
            .eq("company_id", company_id)\
            .eq("status", "active")\
            .is_("deleted_at", "null")\
            .execute().data or []

        if not projects:
            return []

        revenue_acct = _find_account_by_subtype(company_id, "construction_revenue") \
            or _find_account_by_name(company_id, "construction revenue")
        unbilled_acct = _find_account_by_subtype(company_id, "unbilled_revenue") \
            or _find_account_by_name(company_id, "unbilled revenue")
        overbilled_acct = _find_account_by_subtype(company_id, "billings_in_excess") \
            or _find_account_by_name(company_id, "billings in excess")

        if not revenue_acct or (not unbilled_acct and not overbilled_acct):
            return []

        jes: list[CloseJE] = []

        for proj in projects:
            costs = supabase.table("project_costs")\
                .select("amount")\
                .eq("project_id", proj["id"])\
                .lte("date", period_end)\
                .execute().data or []

            costs_to_date = sum(float(c.get("amount") or 0) for c in costs)
            estimated = float(proj.get("estimated_total_costs") or 0)
            contract = float(proj.get("contract_value") or 0)

            if estimated <= 0 or contract <= 0:
                continue

            pct_complete = min(costs_to_date / estimated, 1.0)
            earned_revenue = round(contract * pct_complete, 2)

            # Billed revenue = sum of posted invoices for this project (if linked)
            billed_invoices = supabase.table("invoices")\
                .select("total")\
                .eq("company_id", company_id)\
                .eq("project_id", proj["id"])\
                .in_("status", ["posted", "paid", "partial"])\
                .lte("invoice_date", period_end)\
                .execute().data or []
            billed_revenue = sum(float(r.get("total") or 0) for r in billed_invoices)

            over_under = earned_revenue - billed_revenue

            # Persist wip snapshot
            supabase.table("wip_entries").upsert({
                "company_id": company_id,
                "project_id": proj["id"],
                "period_end": period_end,
                "costs_to_date": round(costs_to_date, 2),
                "pct_complete": round(pct_complete * 100, 2),
                "earned_revenue": earned_revenue,
                "billed_revenue": round(billed_revenue, 2),
                "over_under_billing": round(over_under, 2),
            }, on_conflict="project_id,period_end").execute()

            if abs(over_under) < 0.01:
                continue

            if over_under > 0 and unbilled_acct:
                # Under-billed: earned more than billed → DR Unbilled Revenue / CR Construction Revenue
                jes.append(CloseJE(
                    memo=f"WIP: Under-billing recognition — {proj['name']}",
                    reference=f"WIP-{proj['id'][:8]}",
                    source="wip",
                    entry_date=period_end,
                    lines=[
                        {"account_id": unbilled_acct, "debit": over_under, "credit": 0,
                         "description": f"Unbilled revenue — {proj['name']} ({pct_complete:.0%} complete)"},
                        {"account_id": revenue_acct, "debit": 0, "credit": over_under,
                         "description": f"Construction revenue — {proj['name']}"},
                    ],
                    metadata={"project_id": proj["id"], "pct_complete": pct_complete},
                ))
            elif over_under < 0 and overbilled_acct:
                # Over-billed: billed more than earned → DR Construction Revenue / CR Billings in Excess
                amt = abs(over_under)
                jes.append(CloseJE(
                    memo=f"WIP: Over-billing deferral — {proj['name']}",
                    reference=f"WIP-{proj['id'][:8]}",
                    source="wip",
                    entry_date=period_end,
                    lines=[
                        {"account_id": revenue_acct, "debit": amt, "credit": 0,
                         "description": f"Defer over-billed revenue — {proj['name']}"},
                        {"account_id": overbilled_acct, "debit": 0, "credit": amt,
                         "description": f"Billings in excess — {proj['name']} ({pct_complete:.0%} complete)"},
                    ],
                    metadata={"project_id": proj["id"], "pct_complete": pct_complete},
                ))

        return jes

    def _retention_reclass(self, company_id: str, period_end: str) -> list[CloseJE]:
        """Reclass retention held on invoices from AR to Retention Receivable."""
        ar_acct = _find_account_by_subtype(company_id, "accounts_receivable")
        ret_acct = _find_account_by_name(company_id, "retention receivable") \
            or _find_account_by_name(company_id, "retainage receivable")

        if not ar_acct or not ret_acct:
            return []

        # Find posted invoices from projects with retention_pct > 0, in this period
        jes: list[CloseJE] = []
        projects_with_ret = supabase.table("projects")\
            .select("id, name, retention_pct")\
            .eq("company_id", company_id)\
            .gt("retention_pct", 0)\
            .is_("deleted_at", "null")\
            .execute().data or []

        for proj in projects_with_ret:
            pct = float(proj.get("retention_pct") or 0) / 100
            if pct <= 0:
                continue

            invoices = supabase.table("invoices")\
                .select("id, invoice_number, total")\
                .eq("company_id", company_id)\
                .eq("project_id", proj["id"])\
                .in_("status", ["posted", "partial"])\
                .gte("invoice_date", period_end[:7] + "-01")\
                .lte("invoice_date", period_end)\
                .execute().data or []

            for inv in invoices:
                retention = round(float(inv.get("total") or 0) * pct, 2)
                if retention < 0.01:
                    continue
                dedupe = f"retention_{inv['id']}"

                jes.append(CloseJE(
                    memo=f"Retention reclass — {inv['invoice_number']} ({proj['name']})",
                    reference=dedupe,
                    source="retention",
                    entry_date=period_end,
                    lines=[
                        {"account_id": ret_acct, "debit": retention, "credit": 0,
                         "description": f"Retention receivable — {inv['invoice_number']}"},
                        {"account_id": ar_acct, "debit": 0, "credit": retention,
                         "description": f"Reclass AR to retention — {inv['invoice_number']}"},
                    ],
                    metadata={"invoice_id": inv["id"], "project_id": proj["id"]},
                ))

        return jes

    def _project_cost_summary(self, company_id: str) -> list[dict]:
        projects = supabase.table("projects")\
            .select("id, name, contract_value, estimated_total_costs")\
            .eq("company_id", company_id)\
            .eq("status", "active")\
            .is_("deleted_at", "null")\
            .execute().data or []

        summary = []
        for p in projects:
            costs = supabase.table("project_costs")\
                .select("amount")\
                .eq("project_id", p["id"])\
                .execute().data or []
            total_cost = sum(float(c.get("amount") or 0) for c in costs)
            estimated = float(p.get("estimated_total_costs") or 1)
            contract = float(p.get("contract_value") or 0)
            pct = min(total_cost / estimated * 100, 100) if estimated else 0
            summary.append({
                "name": p["name"],
                "total_cost": total_cost,
                "pct_complete": pct,
                "earned_revenue": round(contract * pct / 100, 2),
            })
        return summary


# ── Account lookup helpers ─────────────────────────────────────────────────

def _find_account_by_subtype(company_id: str, subtype: str):
    rows = supabase.table("accounts")\
        .select("id")\
        .eq("company_id", company_id)\
        .eq("account_subtype", subtype)\
        .eq("is_active", True)\
        .limit(1).execute().data or []
    return rows[0]["id"] if rows else None


def _find_account_by_name(company_id: str, name_fragment: str):
    rows = supabase.table("accounts")\
        .select("id")\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .ilike("account_name", f"%{name_fragment}%")\
        .limit(1).execute().data or []
    return rows[0]["id"] if rows else None


def _construction_narrative(current: dict, prior: dict, projects: list) -> str:
    lines = [
        f"Net income: ${current.get('net_income', 0):,.0f} "
        f"(prior: ${prior.get('net_income', 0):,.0f}).",
        f"Revenue: ${current.get('revenue', 0):,.0f}, Expenses: ${current.get('expenses', 0):,.0f}.",
    ]
    for p in projects[:3]:
        lines.append(
            f"{p['name']}: ${p['total_cost']:,.0f} in costs, "
            f"{p['pct_complete']:.0f}% complete, ${p['earned_revenue']:,.0f} earned revenue."
        )
    return " ".join(lines)
