"""
Email dispatcher for Fintra sentinel alerts and AR dunning.

Uses Resend (https://resend.com) when RESEND_API_KEY is set.
Falls back to no-op (alert still persisted in DB) if not configured.
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def send_email(
    to: str,
    subject: str,
    html_body: str,
    reply_to: Optional[str] = None,
) -> bool:
    """
    Send an email via Resend. Returns True on success.
    Silently returns False (no exception) if not configured.
    """
    api_key = os.getenv("RESEND_API_KEY")
    from_addr = os.getenv("NOTIFY_FROM_EMAIL", "noreply@fintra.app")

    if not api_key:
        logger.debug("RESEND_API_KEY not set — email suppressed: %s → %s", subject, to)
        return False

    try:
        import httpx
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        payload: dict = {
            "from": from_addr,
            "to": [to],
            "subject": subject,
            "html": html_body,
        }
        if reply_to:
            payload["reply_to"] = reply_to

        resp = httpx.post("https://api.resend.com/emails", json=payload, headers=headers, timeout=10)
        if resp.status_code in (200, 201):
            return True
        logger.warning("Resend returned %s: %s", resp.status_code, resp.text[:200])
        return False
    except Exception as e:
        logger.warning("Email send failed: %s", e)
        return False


def send_plain_email(to: str, subject: str, text_body: str) -> bool:
    """Wrap plain text in minimal HTML."""
    html = f"<pre style='font-family:sans-serif'>{text_body}</pre>"
    return send_email(to, subject, html)
