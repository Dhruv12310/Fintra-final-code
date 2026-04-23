"""
FX rate fetcher.

Primary source:  fawazahmed0/currency-api via jsDelivr CDN
                 (200+ currencies, daily historical data, no API key)
Fallback source: Frankfurter (ECB-grade, ~30 majors, deeper history)

Both sources are public, free, and require no credentials. Rates are cached
in-memory for the lifetime of the worker process to avoid hammering the CDN.
Every response carries source attribution and the actual rate date so the
caller (or the AI agent) can show the user where the number came from.

The fetchers are deterministic: same inputs produce the same output.
The AI layer must NEVER invent rates; it can only call this module and
relay what comes back, including the source.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, datetime, timezone
from typing import Optional, Dict, Any
import threading
import time
import httpx


# ---------------------------------------------------------------------------
# Cache (in-memory, per worker process)
# ---------------------------------------------------------------------------

_CACHE: Dict[str, Any] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours; FX rates update daily at most


def _cache_get(key: str) -> Optional[Any]:
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        if entry["expires_at"] < time.time():
            _CACHE.pop(key, None)
            return None
        return entry["value"]


def _cache_set(key: str, value: Any) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = {"value": value, "expires_at": time.time() + _CACHE_TTL_SECONDS}


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class FxRate:
    base: str
    quote: str
    rate: float
    as_of: str          # ISO date the rate is for (may differ from requested if weekend/holiday)
    requested_as_of: str
    source: str         # "fawazahmed0" | "frankfurter"
    source_url: str
    fetched_at: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class FxAllRates:
    base: str
    rates: Dict[str, float]
    as_of: str
    requested_as_of: str
    source: str
    source_url: str
    fetched_at: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class FxLookupError(Exception):
    """Raised when no rate can be obtained from any source. Carries a human
    message the caller can show or surface to the AI."""


# ---------------------------------------------------------------------------
# Source: fawazahmed0/currency-api via jsDelivr (primary)
# ---------------------------------------------------------------------------

_FAWAZ_LATEST = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{base}.json"
_FAWAZ_DATED  = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date}/v1/currencies/{base}.json"
_FAWAZ_FALLBACK_LATEST = "https://currency-api.pages.dev/v1/currencies/{base}.json"
_FAWAZ_FALLBACK_DATED  = "https://{date}.currency-api.pages.dev/v1/currencies/{base}.json"


def _fetch_fawaz(base: str, as_of: str) -> Optional[Dict[str, Any]]:
    """Return the parsed JSON for `base` on `as_of` (YYYY-MM-DD) or None on
    failure. Tries jsDelivr first, then the pages.dev mirror."""
    base_lc = base.lower()
    today_iso = date.today().isoformat()
    is_today = as_of == today_iso

    candidates = []
    if is_today:
        candidates.append(_FAWAZ_LATEST.format(base=base_lc))
        candidates.append(_FAWAZ_FALLBACK_LATEST.format(base=base_lc))
    candidates.append(_FAWAZ_DATED.format(date=as_of, base=base_lc))
    candidates.append(_FAWAZ_FALLBACK_DATED.format(date=as_of, base=base_lc))

    for url in candidates:
        try:
            r = httpx.get(url, timeout=8.0, follow_redirects=True)
            if r.status_code == 200:
                payload = r.json()
                payload["_source_url"] = url
                return payload
        except Exception:
            continue
    return None


# ---------------------------------------------------------------------------
# Source: Frankfurter (fallback)
# ---------------------------------------------------------------------------

_FRANKFURTER_LATEST = "https://api.frankfurter.app/latest"
_FRANKFURTER_DATED  = "https://api.frankfurter.app/{date}"


def _fetch_frankfurter(base: str, quote: Optional[str], as_of: str) -> Optional[Dict[str, Any]]:
    today_iso = date.today().isoformat()
    is_today = as_of == today_iso

    url = _FRANKFURTER_LATEST if is_today else _FRANKFURTER_DATED.format(date=as_of)
    params: Dict[str, str] = {"from": base.upper()}
    if quote:
        params["to"] = quote.upper()

    try:
        r = httpx.get(url, params=params, timeout=8.0, follow_redirects=True)
        if r.status_code == 200:
            payload = r.json()
            payload["_source_url"] = str(r.url)
            return payload
    except Exception:
        return None
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _validate_date(as_of: str) -> str:
    try:
        d = date.fromisoformat(as_of)
    except ValueError:
        raise FxLookupError(f"Invalid date '{as_of}'. Use ISO format YYYY-MM-DD.")
    if d > date.today():
        raise FxLookupError(
            f"FX rates are not available for future dates ({as_of}). The latest available date is today."
        )
    return d.isoformat()


def get_rate(base: str, quote: str, as_of: Optional[str] = None) -> FxRate:
    """Return one currency pair on a specific date. Tries fawazahmed0 first
    (broad coverage, 200+ currencies), then Frankfurter (ECB majors).

    Raises FxLookupError with a clear human message on failure. Never returns
    a guessed rate. The AI agent must surface this error to the user instead
    of fabricating a value.
    """
    base_u, quote_u = base.upper(), quote.upper()
    if base_u == quote_u:
        return FxRate(
            base=base_u, quote=quote_u, rate=1.0,
            as_of=date.today().isoformat(),
            requested_as_of=as_of or date.today().isoformat(),
            source="identity",
            source_url="",
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )

    target = _validate_date(as_of or date.today().isoformat())
    cache_key = f"pair:{base_u}:{quote_u}:{target}"
    cached = _cache_get(cache_key)
    if cached:
        return FxRate(**cached)

    # Primary: fawazahmed0
    payload = _fetch_fawaz(base_u, target)
    if payload:
        rates = payload.get(base_u.lower()) or {}
        if isinstance(rates, dict) and quote_u.lower() in rates:
            rate = float(rates[quote_u.lower()])
            result = FxRate(
                base=base_u, quote=quote_u, rate=rate,
                as_of=str(payload.get("date") or target),
                requested_as_of=target,
                source="fawazahmed0/currency-api",
                source_url=payload.get("_source_url", ""),
                fetched_at=datetime.now(timezone.utc).isoformat(),
            )
            _cache_set(cache_key, result.to_dict())
            return result

    # Fallback: Frankfurter (limited to ECB majors)
    payload = _fetch_frankfurter(base_u, quote_u, target)
    if payload:
        rates = payload.get("rates") or {}
        if quote_u in rates:
            rate = float(rates[quote_u])
            result = FxRate(
                base=base_u, quote=quote_u, rate=rate,
                as_of=str(payload.get("date") or target),
                requested_as_of=target,
                source="frankfurter (ECB)",
                source_url=payload.get("_source_url", ""),
                fetched_at=datetime.now(timezone.utc).isoformat(),
            )
            _cache_set(cache_key, result.to_dict())
            return result

    raise FxLookupError(
        f"No FX rate available for {base_u}/{quote_u} on {target}. "
        "Both data sources (fawazahmed0/currency-api and Frankfurter) returned no data. "
        "The currency may be unsupported, the date may be a non-trading day with no prior close, "
        "or both providers may be temporarily unreachable."
    )


def get_all_rates(base: str, as_of: Optional[str] = None) -> FxAllRates:
    """Return every quote currency available for `base` on `as_of`.
    Uses fawazahmed0 (broadest coverage) only; Frankfurter would truncate the
    list to ECB majors and mislead the user about coverage.
    """
    base_u = base.upper()
    target = _validate_date(as_of or date.today().isoformat())
    cache_key = f"all:{base_u}:{target}"
    cached = _cache_get(cache_key)
    if cached:
        return FxAllRates(**cached)

    payload = _fetch_fawaz(base_u, target)
    if payload:
        rates = payload.get(base_u.lower())
        if isinstance(rates, dict) and rates:
            normalized = {k.upper(): float(v) for k, v in rates.items() if isinstance(v, (int, float))}
            result = FxAllRates(
                base=base_u, rates=normalized,
                as_of=str(payload.get("date") or target),
                requested_as_of=target,
                source="fawazahmed0/currency-api",
                source_url=payload.get("_source_url", ""),
                fetched_at=datetime.now(timezone.utc).isoformat(),
            )
            _cache_set(cache_key, result.to_dict())
            return result

    raise FxLookupError(
        f"No FX rates available for base {base_u} on {target}. The currency may be unsupported "
        "or the data source may be temporarily unreachable."
    )
