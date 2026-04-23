"""
Default close handler — works for any industry.
Handles prepaid amortization and generates a generic flux narrative.
"""

import os
from typing import Any
from database import supabase
from lib.close.base import CloseHandler, CloseJE, CloseWarning


class DefaultHandler(CloseHandler):
    industry_key = "default"

    def pre_close_checks(self, company_id, period_start, period_end):
        return []

    def generate_vertical_schedules(self, company_id, period_start, period_end):
        return []

    def amortize_prepaids(self, company_id: str, period_end: str) -> list[CloseJE]:
        """Release one month of amortization for active prepaid schedules."""
        from datetime import date
        from lib.month_end import compute_depreciation

        schedules = supabase.table("amortization_schedules")\
            .select("*")\
            .eq("company_id", company_id)\
            .eq("status", "active")\
            .lte("start_date", period_end)\
            .gte("end_date", period_end)\
            .execute().data or []

        jes: list[CloseJE] = []

        for sch in schedules:
            try:
                s = date.fromisoformat(sch["start_date"])
                e = date.fromisoformat(sch["end_date"])
                months = max(1, (e.year - s.year) * 12 + (e.month - s.month) + 1)
                monthly = round(float(sch["original_amount"]) / months, 2)
                remaining = float(sch["original_amount"]) - float(sch.get("amortized_amount") or 0)
                if remaining <= 0:
                    supabase.table("amortization_schedules")\
                        .update({"status": "completed"})\
                        .eq("id", sch["id"]).execute()
                    continue

                amount = min(monthly, remaining)
                jes.append(CloseJE(
                    memo=f"Prepaid amortization — {sch['name']}",
                    reference=f"AMORT-{sch['id'][:8]}",
                    source="amortization",
                    entry_date=period_end,
                    lines=[
                        {"account_id": sch["expense_account_id"], "debit": amount, "credit": 0,
                         "description": f"Amortization — {sch['name']}"},
                        {"account_id": sch["prepaid_account_id"], "debit": 0, "credit": amount,
                         "description": f"Release prepaid — {sch['name']}"},
                    ],
                    metadata={"schedule_id": sch["id"], "monthly_amount": monthly},
                ))

                # Update amortized_amount
                new_amortized = float(sch.get("amortized_amount") or 0) + amount
                supabase.table("amortization_schedules")\
                    .update({"amortized_amount": new_amortized})\
                    .eq("id", sch["id"]).execute()

            except Exception:
                continue

        return jes

    def narrate_flux(self, company_id: str, current_period: dict, prior_period: dict) -> str:
        if not os.getenv("ANTHROPIC_API_KEY"):
            return _simple_narrative(current_period, prior_period)

        try:
            import anthropic
            client = anthropic.Anthropic()
            prompt = _build_narrative_prompt(current_period, prior_period)
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            return msg.content[0].text.strip()
        except Exception:
            return _simple_narrative(current_period, prior_period)


def _build_narrative_prompt(cur: dict, prior: dict) -> str:
    c_rev = cur.get("revenue", 0)
    p_rev = prior.get("revenue", 0)
    c_exp = cur.get("expenses", 0)
    p_exp = prior.get("expenses", 0)
    c_ni = cur.get("net_income", 0)
    p_ni = prior.get("net_income", 0)

    rev_chg = ((c_rev - p_rev) / p_rev * 100) if p_rev else 0
    exp_chg = ((c_exp - p_exp) / p_exp * 100) if p_exp else 0

    return (
        f"Write a concise (3-5 sentence) CFO-style month-end flux narrative. "
        f"Current period: Revenue ${c_rev:,.0f}, Expenses ${c_exp:,.0f}, Net Income ${c_ni:,.0f}. "
        f"Prior period: Revenue ${p_rev:,.0f}, Expenses ${p_exp:,.0f}, Net Income ${p_ni:,.0f}. "
        f"Revenue change: {rev_chg:+.1f}%. Expense change: {exp_chg:+.1f}%. "
        "Be direct, professional, no bullet points, no markdown."
    )


def _simple_narrative(cur: dict, prior: dict) -> str:
    c_ni = cur.get("net_income", 0)
    p_ni = prior.get("net_income", 0)
    delta = c_ni - p_ni
    direction = "up" if delta >= 0 else "down"
    return (
        f"Net income for the period was ${c_ni:,.0f}, "
        f"{direction} ${abs(delta):,.0f} vs prior period (${p_ni:,.0f}). "
        f"Revenue: ${cur.get('revenue', 0):,.0f}. Expenses: ${cur.get('expenses', 0):,.0f}."
    )
