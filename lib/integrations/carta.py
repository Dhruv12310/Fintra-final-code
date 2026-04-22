"""
Carta (equity/cap table) integration.
Reads: cap table, equity grants, 409A valuations, stakeholders.
Use case: Auto-journal stock compensation entries, show equity data in dashboard.

Requires env vars: CARTA_CLIENT_ID, CARTA_CLIENT_SECRET
Carta uses OAuth 2.0 with Issuer: https://account.carta.com
"""

import os
import httpx
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone, timedelta
from lib.integrations.base import BaseIntegration

CARTA_AUTH_BASE = "https://account.carta.com/oauth2/auth"
CARTA_TOKEN_URL = "https://account.carta.com/oauth2/token"
CARTA_API_BASE = "https://api.carta.com/firms/v2"


class CartaIntegration(BaseIntegration):
    provider = "carta"

    def __init__(self, company_id: str, connection_id: Optional[str] = None):
        super().__init__(company_id, connection_id)
        self.client_id = os.getenv("CARTA_CLIENT_ID", "")
        self.client_secret = os.getenv("CARTA_CLIENT_SECRET", "")
        self.redirect_uri = os.getenv("CARTA_REDIRECT_URI", "http://localhost:8001/integrations/carta/callback")

    def get_auth_url(self, state: str) -> str:
        import urllib.parse
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "read:cap_table read:equity_awards read:valuations",
            "state": state,
        }
        return f"{CARTA_AUTH_BASE}?{urllib.parse.urlencode(params)}"

    def authenticate(self, auth_code: str, realm_id: Optional[str] = None) -> Dict[str, Any]:
        response = httpx.post(
            CARTA_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": auth_code,
                "redirect_uri": self.redirect_uri,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
            timeout=30,
        )
        response.raise_for_status()
        tokens = response.json()
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
        return self.save_connection(
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
            token_expires_at=expires_at,
        )

    def refresh_token(self) -> str:
        response = httpx.post(
            CARTA_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token_value,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
            timeout=30,
        )
        response.raise_for_status()
        tokens = response.json()
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
        self.update_tokens(tokens["access_token"], tokens.get("refresh_token"), expires_at)
        return tokens["access_token"]

    def _get(self, path: str, params: Optional[Dict] = None) -> Dict[str, Any]:
        token = self.get_access_token()
        response = httpx.get(
            f"{CARTA_API_BASE}{path}",
            params=params or {},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def sync_pull(self, entity_type: str, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Pull Carta data. Supported types: cap_table, equity_grants, valuations."""
        if entity_type == "cap_table":
            data = self._get("/stakeholders")
            records = data.get("stakeholders", [])
        elif entity_type == "equity_grants":
            data = self._get("/equityAwards")
            records = data.get("equityAwards", [])
        elif entity_type == "valuations":
            data = self._get("/valuations")
            records = data.get("valuations", [])
        else:
            records = []

        self.log_sync(entity_type, "pull", len(records))
        return records

    def sync_push(self, entity_type: str, records: List[Dict[str, Any]]) -> Dict[str, Any]:
        return {"succeeded": 0, "failed": 0, "errors": ["sync_push not supported for Carta"]}

    def handle_webhook(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        return []

    def get_cap_table_summary(self) -> Dict[str, Any]:
        """Return a simplified cap table summary for the dashboard widget."""
        try:
            stakeholders = self.sync_pull("cap_table")
            total_shares = sum(s.get("shares", 0) for s in stakeholders)
            by_type: Dict[str, int] = {}
            for s in stakeholders:
                stype = s.get("stakeholderType", "Other")
                by_type[stype] = by_type.get(stype, 0) + s.get("shares", 0)
            return {
                "total_shareholders": len(stakeholders),
                "total_shares": total_shares,
                "breakdown": [{"type": k, "shares": v} for k, v in by_type.items()],
            }
        except Exception as e:
            return {"error": str(e)}
