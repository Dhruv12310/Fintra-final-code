"""
Slack dispatcher using incoming webhooks.
Webhook URL stored per-company in companies.settings->>'slack_webhook'.
Falls back to a global SLACK_WEBHOOK_URL env var.
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def send_slack(
    text: str,
    webhook_url: Optional[str] = None,
    company_settings: Optional[dict] = None,
) -> bool:
    """
    Post a message to Slack. Returns True on success.
    webhook_url takes precedence over company_settings and env var.
    """
    url = (
        webhook_url
        or (company_settings or {}).get("slack_webhook")
        or os.getenv("SLACK_WEBHOOK_URL")
    )
    if not url:
        logger.debug("No Slack webhook configured — suppressed: %s", text[:80])
        return False

    try:
        import httpx
        resp = httpx.post(url, json={"text": text}, timeout=10)
        return resp.status_code == 200
    except Exception as e:
        logger.warning("Slack send failed: %s", e)
        return False


def format_alert(title: str, body: str, severity: str = "info") -> str:
    icons = {"info": ":information_source:", "warning": ":warning:", "critical": ":rotating_light:"}
    icon = icons.get(severity, ":bell:")
    return f"{icon} *{title}*\n{body}"
