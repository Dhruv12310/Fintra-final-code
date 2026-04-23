"""
Month-end close endpoints.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict
from database import supabase
from middleware.auth import get_current_user_company, require_min_role
from lib.month_end import (
    run_close_checklist,
    get_close_status,
    transition_close_state,
    generate_flux_narrative,
)

router = APIRouter(prefix="/month-end", tags=["Month End"])


class CloseRequest(BaseModel):
    period_start: str   # YYYY-MM-DD
    period_end: str     # YYYY-MM-DD
    lock: bool = True


class TransitionRequest(BaseModel):
    period_start: str
    new_status: str     # vertical_review | controller_review | approved | locked


@router.post("/close")
async def close_period(
    body: CloseRequest,
    auth: Dict = Depends(require_min_role("accountant")),
):
    """Run the month-end close checklist for a period."""
    cid = auth["company_id"]
    uid = auth["user_id"]
    result = await run_close_checklist(
        company_id=cid,
        period_start=body.period_start,
        period_end=body.period_end,
        user_id=uid,
        lock=body.lock,
    )
    return result


@router.get("/status")
def close_status(
    period_start: str,
    auth: Dict = Depends(get_current_user_company),
):
    """Get close checklist status for a period."""
    cid = auth["company_id"]
    status = get_close_status(cid, period_start)
    if not status:
        return {"status": "not_started", "steps": []}
    return status


@router.post("/transition")
def transition_state(
    body: TransitionRequest,
    auth: Dict = Depends(require_min_role("accountant")),
):
    """
    Advance the close checklist to the next review state.
    Flow: in_progress → vertical_review → controller_review → approved → locked
    The 'locked' transition is the only one that sets is_closed=true on the period.
    """
    cid = auth["company_id"]
    uid = auth["user_id"]
    result = transition_close_state(cid, body.period_start, body.new_status, uid)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Transition failed"))
    return result


@router.get("/flux-narrative")
def flux_narrative(
    period_start: str,
    period_end: str,
    auth: Dict = Depends(require_min_role("accountant")),
):
    """Generate an LLM-narrated flux commentary for the close packet."""
    cid = auth["company_id"]
    narrative = generate_flux_narrative(cid, period_start, period_end)
    return {"narrative": narrative, "period_start": period_start, "period_end": period_end}


@router.get("/alerts")
def close_alerts(
    period_start: Optional[str] = None,
    auth: Dict = Depends(get_current_user_company),
):
    """List open sentinel alerts for this company (scoped to month-end context)."""
    cid = auth["company_id"]
    q = supabase.table("agent_alerts")\
        .select("*")\
        .eq("company_id", cid)\
        .eq("status", "open")\
        .order("created_at", desc=True)\
        .limit(50)
    return q.execute().data or []
