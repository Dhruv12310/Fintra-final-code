"""
Exchange rates: manual entry of FX rates per company. The most recent rate
on or before a transaction date is used when posting a foreign-currency line.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict
from datetime import date
from database import supabase
from middleware.auth import get_current_user_company, require_min_role
from lib.fx_rates import get_rate, get_all_rates, FxLookupError

router = APIRouter(prefix="/exchange-rates", tags=["Exchange Rates"])


class RateBody(BaseModel):
    base_currency: str
    quote_currency: str
    rate: float
    as_of_date: str
    source: Optional[str] = "manual"


@router.get("/")
async def list_rates(
    base_currency: Optional[str] = None,
    quote_currency: Optional[str] = None,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    cid = auth["company_id"]
    q = supabase.table("exchange_rates").select("*").eq("company_id", cid)
    if base_currency:
        q = q.eq("base_currency", base_currency.upper())
    if quote_currency:
        q = q.eq("quote_currency", quote_currency.upper())
    return q.order("as_of_date", desc=True).execute().data or []


@router.post("/")
async def upsert_rate(
    body: RateBody,
    auth: Dict[str, str] = Depends(require_min_role("accountant")),
):
    cid = auth["company_id"]
    if body.rate <= 0:
        raise HTTPException(status_code=400, detail="Rate must be positive")
    payload = {
        "company_id": cid,
        "base_currency": body.base_currency.upper(),
        "quote_currency": body.quote_currency.upper(),
        "rate": body.rate,
        "as_of_date": body.as_of_date,
        "source": body.source or "manual",
        "created_by": auth.get("user_id"),
    }
    r = supabase.table("exchange_rates").upsert(
        payload, on_conflict="company_id,base_currency,quote_currency,as_of_date"
    ).execute()
    return r.data[0] if r.data else payload


@router.get("/lookup")
async def lookup_rate(
    base: str,
    quote: str,
    as_of: Optional[str] = None,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    """Most recent rate at or before the given date."""
    cid = auth["company_id"]
    target = as_of or str(date.today())
    r = supabase.rpc("get_fx_rate", {
        "p_company_id": cid,
        "p_base": base.upper(),
        "p_quote": quote.upper(),
        "p_as_of": target,
    }).execute()
    rate = r.data
    if rate is None:
        raise HTTPException(status_code=404, detail=f"No rate found for {base}/{quote} on or before {target}")
    return {"base": base.upper(), "quote": quote.upper(), "rate": float(rate), "as_of": target}


@router.delete("/{rate_id}")
async def delete_rate(
    rate_id: str,
    auth: Dict[str, str] = Depends(require_min_role("accountant")),
):
    cid = auth["company_id"]
    supabase.table("exchange_rates").delete().eq("id", rate_id).eq("company_id", cid).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Live FX lookups via free public APIs (fawazahmed0 + Frankfurter fallback).
# Always returns source attribution; never invents a rate.
# ---------------------------------------------------------------------------

@router.get("/live")
async def live_rate(
    base: str,
    quote: str,
    as_of: Optional[str] = None,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    """Single-pair lookup. Returns rate + source + date. Use this for AR/AP
    posting flows where the user wants to grab a real rate before saving."""
    try:
        return get_rate(base, quote, as_of).to_dict()
    except FxLookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FX provider error: {e}")


@router.get("/live/all")
async def live_all(
    base: str,
    as_of: Optional[str] = None,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    """All quote currencies available for `base` on the given date. Useful
    for the bulk 'Sync today' button on the exchange rates page."""
    try:
        return get_all_rates(base, as_of).to_dict()
    except FxLookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FX provider error: {e}")


class SaveLiveBody(BaseModel):
    base: str
    quote: str
    as_of: Optional[str] = None


@router.post("/live/save")
async def save_live(
    body: SaveLiveBody,
    auth: Dict[str, str] = Depends(require_min_role("accountant")),
):
    """Look up a live rate and persist it to the company's exchange_rates
    table in one call. The saved row records the source so the audit trail
    is preserved."""
    cid = auth["company_id"]
    try:
        fx = get_rate(body.base, body.quote, body.as_of)
    except FxLookupError as e:
        raise HTTPException(status_code=404, detail=str(e))

    payload = {
        "company_id": cid,
        "base_currency": fx.base,
        "quote_currency": fx.quote,
        "rate": fx.rate,
        "as_of_date": fx.as_of,
        "source": fx.source,
        "created_by": auth.get("user_id"),
    }
    r = supabase.table("exchange_rates").upsert(
        payload, on_conflict="company_id,base_currency,quote_currency,as_of_date"
    ).execute()
    return {"saved": r.data[0] if r.data else payload, "fetched": fx.to_dict()}
