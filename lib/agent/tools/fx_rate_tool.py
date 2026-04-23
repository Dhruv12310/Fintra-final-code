"""
FX rate tools for the agent.

These are read-only and never modify the ledger. They wrap lib/fx_rates.py
which fetches deterministic data from public APIs (fawazahmed0 + Frankfurter).

DESIGN NOTE: the AI must NEVER invent an FX rate. The tool descriptions are
written to make this hard to misuse: every result includes an explicit
source string and the actual rate date, so the agent's reply can cite both.
On lookup failure the tool returns an `error` field; the agent must surface
that error to the user instead of guessing.

The agent is responsible for parsing natural language dates ("yesterday",
"last Thursday", "April 15") into ISO YYYY-MM-DD before calling the tool.
The tool itself only accepts ISO dates.
"""

from typing import Dict, Any
from lib.agent.tools.registry import AgentTool, register_tool
from lib.fx_rates import get_rate, get_all_rates, FxLookupError


async def handle_get_exchange_rate(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    base = (arguments.get("base") or "").strip().upper()
    quote = (arguments.get("quote") or "").strip().upper()
    as_of = (arguments.get("as_of_date") or "").strip() or None

    if not base or not quote:
        return {"error": "Both 'base' and 'quote' currency codes are required (e.g. USD, EUR, INR)."}

    try:
        fx = get_rate(base, quote, as_of)
    except FxLookupError as e:
        return {
            "error": str(e),
            "base": base,
            "quote": quote,
            "requested_as_of": as_of or "today",
        }

    return {
        "base": fx.base,
        "quote": fx.quote,
        "rate": fx.rate,
        "as_of_date": fx.as_of,
        "requested_as_of": fx.requested_as_of,
        "source": fx.source,
        "source_url": fx.source_url,
        "fetched_at": fx.fetched_at,
        "human_summary": (
            f"1 {fx.base} = {fx.rate:.6f} {fx.quote} as of {fx.as_of} "
            f"(source: {fx.source})."
        ),
    }


async def handle_list_exchange_rates(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    base = (arguments.get("base") or "").strip().upper()
    as_of = (arguments.get("as_of_date") or "").strip() or None

    if not base:
        return {"error": "'base' currency code is required (e.g. USD, EUR, INR)."}

    try:
        all_rates = get_all_rates(base, as_of)
    except FxLookupError as e:
        return {"error": str(e), "base": base, "requested_as_of": as_of or "today"}

    return {
        "base": all_rates.base,
        "rates": all_rates.rates,
        "as_of_date": all_rates.as_of,
        "requested_as_of": all_rates.requested_as_of,
        "source": all_rates.source,
        "source_url": all_rates.source_url,
        "fetched_at": all_rates.fetched_at,
        "currency_count": len(all_rates.rates),
    }


def register():
    register_tool(AgentTool(
        name="get_exchange_rate",
        description=(
            "Look up an exchange rate between any two currencies on a specific date. "
            "Supports 200+ currencies (majors, emerging markets, and minor currencies) "
            "via free public APIs. Returns the rate, the actual date the rate is for, "
            "and a source citation. ALWAYS use this tool when the user asks for any "
            "FX rate. NEVER invent or estimate a rate. If the tool returns an 'error' "
            "field, relay that error to the user verbatim instead of guessing.\n\n"
            "Date handling: the user may say 'today', 'yesterday', 'last Thursday', "
            "'2026-03-15', or any natural phrase. You must convert to ISO YYYY-MM-DD "
            "before calling. Future dates are not supported (rates don't exist yet); "
            "if the user asks for a future date, explain this and offer today's rate "
            "as the closest available value."
        ),
        parameters={
            "type": "object",
            "properties": {
                "base": {
                    "type": "string",
                    "description": "ISO 4217 base currency code, e.g. USD, EUR, GBP, INR, CAD, JPY, AUD, CHF, CNY, MXN.",
                },
                "quote": {
                    "type": "string",
                    "description": "ISO 4217 quote currency code, e.g. USD, EUR, GBP, INR, CAD, JPY, AUD, CHF, CNY, MXN.",
                },
                "as_of_date": {
                    "type": "string",
                    "description": "ISO date YYYY-MM-DD. Optional; defaults to today. Future dates are rejected.",
                },
            },
            "required": ["base", "quote"],
        },
        handler=handle_get_exchange_rate,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="list_exchange_rates",
        description=(
            "List exchange rates from one base currency to ALL supported quote "
            "currencies on a specific date. Use when the user asks 'what are today's "
            "rates' or wants to compare one currency against many. Returns 150+ "
            "currency rates in a single call. Same source-attribution rules apply: "
            "never invent values, always cite the source the tool returns."
        ),
        parameters={
            "type": "object",
            "properties": {
                "base": {
                    "type": "string",
                    "description": "ISO 4217 base currency code, e.g. USD, EUR, GBP, INR.",
                },
                "as_of_date": {
                    "type": "string",
                    "description": "ISO date YYYY-MM-DD. Optional; defaults to today.",
                },
            },
            "required": ["base"],
        },
        handler=handle_list_exchange_rates,
        requires_confirmation=False,
    ))
