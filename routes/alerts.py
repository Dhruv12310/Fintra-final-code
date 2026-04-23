"""
Alert inbox — list, act on, and dismiss sentinel alerts.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, List
from datetime import datetime, timezone
from database import supabase
from middleware.auth import get_current_user_company, require_min_role

router = APIRouter(prefix="/alerts", tags=["Alerts"])


class AlertActionRequest(BaseModel):
    status: str   # accepted | dismissed | snoozed
    snoozed_until: Optional[str] = None   # ISO datetime, only for snoozed


@router.get("")
def list_alerts(
    status: Optional[str] = "open",
    trigger: Optional[str] = None,
    limit: int = 50,
    auth: Dict = Depends(get_current_user_company),
):
    """List alerts for the current company."""
    cid = auth["company_id"]
    q = supabase.table("agent_alerts")\
        .select("*")\
        .eq("company_id", cid)\
        .order("created_at", desc=True)\
        .limit(limit)

    if status:
        q = q.eq("status", status)
    if trigger:
        q = q.eq("trigger_name", trigger)

    return q.execute().data or []


@router.get("/summary")
def alerts_summary(auth: Dict = Depends(get_current_user_company)):
    """Count open alerts by severity — for dashboard widget."""
    cid = auth["company_id"]
    rows = supabase.table("agent_alerts")\
        .select("severity")\
        .eq("company_id", cid)\
        .eq("status", "open")\
        .execute().data or []

    counts = {"critical": 0, "warning": 0, "info": 0, "total": len(rows)}
    for r in rows:
        sev = r.get("severity", "info")
        counts[sev] = counts.get(sev, 0) + 1
    return counts


@router.post("/{alert_id}/action")
def act_on_alert(
    alert_id: str,
    body: AlertActionRequest,
    auth: Dict = Depends(get_current_user_company),
):
    """Accept, dismiss, or snooze an alert."""
    cid = auth["company_id"]
    alert = supabase.table("agent_alerts")\
        .select("*")\
        .eq("id", alert_id)\
        .eq("company_id", cid)\
        .execute().data

    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert = alert[0]
    now = datetime.now(timezone.utc).isoformat()

    update: dict = {"status": body.status, "resolved_at": now}
    if body.status == "snoozed":
        update["resolved_at"] = None
        update["snoozed_until"] = body.snoozed_until

    supabase.table("agent_alerts").update(update).eq("id", alert_id).execute()

    # If accepted and this is a dunning email, send it then move to dismissed
    if body.status == "accepted" and alert.get("trigger_name") == "overdue_invoice":
        sent = _send_dunning_email(alert)
        existing_payload = alert.get("action_payload") or {}
        new_payload = {**existing_payload, "email_sent_at": now if sent else None}
        supabase.table("agent_alerts").update({
            "status": "dismissed",
            "action_payload": new_payload,
        }).eq("id", alert_id).execute()

    # If accepted and this is a duplicate bill, release the hold
    if body.status == "accepted" and alert.get("trigger_name") == "duplicate_bill":
        payload = alert.get("action_payload") or {}
        if payload.get("bill_id"):
            supabase.table("bills").update({"status": "draft"})\
                .eq("id", payload["bill_id"]).execute()

    return {"ok": True, "alert_id": alert_id, "status": body.status}


def _send_dunning_email(alert: dict) -> bool:
    payload = alert.get("action_payload") or {}
    to = payload.get("customer_email")
    subject = payload.get("email_subject", "Payment reminder")
    body = payload.get("email_body", "")

    if not to or not body:
        return False

    from lib.notify.email import send_email
    sent = send_email(to=to, subject=subject, html_body=f"<pre>{body}</pre>")

    if sent:
        try:
            supabase.table("notifications_sent").insert({
                "alert_id": alert["id"],
                "channel": "email",
            }).execute()
        except Exception:
            pass

    return bool(sent)


@router.post("/run-sentinel")
async def run_sentinel_now(
    auth: Dict = Depends(require_min_role("accountant")),
):
    """Manually trigger sentinel scan for this company (useful for testing)."""
    cid = auth["company_id"]
    from lib.agent.sentinel import run_sentinel
    result = await run_sentinel(company_id=cid)
    return result
