"""
Proactive Ledger Sentinel — cron-driven event dispatcher.

Runs a set of trigger scanners against each active company's GL data.
Each trigger is idempotent (uses sentinel_cursors for watermarks) and
writes to agent_alerts when it finds something noteworthy.

Usage (from a cron route or background task):
    from lib.agent.sentinel import run_sentinel
    results = await run_sentinel(company_id=company_id)  # one company
    results = await run_sentinel()                        # all companies
"""

import logging
from typing import Optional, List, Dict, Any
from database import supabase

logger = logging.getLogger(__name__)

# Registry: (trigger_name → async callable(company_id) -> list[alert_dict])
_TRIGGERS: Dict[str, Any] = {}


def register_trigger(name: str, fn):
    _TRIGGERS[name] = fn


async def run_sentinel(company_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Scan all registered triggers for one company (or all companies).
    Returns summary of alerts created.
    """
    if company_id:
        companies = [{"id": company_id}]
    else:
        rows = supabase.table("companies").select("id").eq("is_active", True).execute()
        companies = rows.data or []

    total_alerts = 0
    errors: List[str] = []

    for co in companies:
        cid = co["id"]
        for trigger_name, trigger_fn in _TRIGGERS.items():
            try:
                alerts = await trigger_fn(cid)
                for alert in alerts:
                    _upsert_alert(cid, trigger_name, alert)
                    total_alerts += 1
                    _maybe_notify(cid, alert)
            except Exception as e:
                msg = f"{trigger_name}/{cid}: {e}"
                logger.warning("Sentinel trigger failed: %s", msg)
                errors.append(msg)

    return {"alerts_created": total_alerts, "errors": errors}


def _upsert_alert(company_id: str, trigger_name: str, alert: dict):
    """Insert alert, skipping on dedupe_key conflict (idempotent)."""
    row = {
        "company_id": company_id,
        "trigger_name": trigger_name,
        "severity": alert.get("severity", "info"),
        "title": alert["title"],
        "body": alert.get("body", ""),
        "related_entity_type": alert.get("entity_type"),
        "related_entity_id": alert.get("entity_id"),
        "action_payload": alert.get("action_payload", {}),
        "dedupe_key": alert.get("dedupe_key"),
    }
    try:
        supabase.table("agent_alerts").upsert(
            row, on_conflict="company_id,dedupe_key", ignore_duplicates=True
        ).execute()
    except Exception:
        supabase.table("agent_alerts").insert(row).execute()


def _maybe_notify(company_id: str, alert: dict):
    """Push Slack/email if company has notifications configured (best-effort)."""
    try:
        co = supabase.table("companies").select("settings").eq("id", company_id).execute()
        settings = (co.data or [{}])[0].get("settings") or {}

        from lib.notify.slack import send_slack, format_alert
        msg = format_alert(alert["title"], alert.get("body", ""), alert.get("severity", "info"))

        already_notified = supabase.table("notifications_sent")\
            .select("alert_id")\
            .eq("alert_id", alert.get("_alert_id", "00000000-0000-0000-0000-000000000000"))\
            .eq("channel", "slack")\
            .execute()
        if not already_notified.data:
            send_slack(msg, company_settings=settings)
    except Exception:
        pass


# ── Auto-register built-in triggers on import ─────────────────────────────

def _register_defaults():
    try:
        from lib.agent.triggers.duplicate_bill import scan as duplicate_scan
        register_trigger("duplicate_bill", duplicate_scan)
    except ImportError:
        pass

    try:
        from lib.agent.triggers.anomaly_txn import scan as anomaly_scan
        register_trigger("anomaly_txn", anomaly_scan)
    except ImportError:
        pass

    try:
        from lib.agent.triggers.overdue_invoice import scan as overdue_scan
        register_trigger("overdue_invoice", overdue_scan)
    except ImportError:
        pass


_register_defaults()
