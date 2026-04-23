"""
Workday HCM/Finance integration.
Reads: employee data, payroll summaries, expense reports, GL journal entries.
Use case: Auto-create payroll journal entries, sync expense reports.

Requires env vars: WORKDAY_CLIENT_ID, WORKDAY_CLIENT_SECRET, WORKDAY_TENANT_URL
"""

import os
import httpx
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone, timedelta
from lib.integrations.base import BaseIntegration


class WorkdayIntegration(BaseIntegration):
    provider = "workday"

    def __init__(self, company_id: str, connection_id: Optional[str] = None):
        super().__init__(company_id, connection_id)
        self.client_id = os.getenv("WORKDAY_CLIENT_ID", "")
        self.client_secret = os.getenv("WORKDAY_CLIENT_SECRET", "")
        self.tenant_url = os.getenv("WORKDAY_TENANT_URL", "")  # e.g. https://wd2-impl-services1.workday.com/ccx/api
        self.redirect_uri = os.getenv("WORKDAY_REDIRECT_URI", "http://localhost:8001/integrations/workday/callback")

    def get_auth_url(self, state: str) -> str:
        import urllib.parse
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "Human_Resources Payroll",
            "state": state,
        }
        auth_base = f"{self.tenant_url}/authorize"
        return f"{auth_base}?{urllib.parse.urlencode(params)}"

    def authenticate(self, auth_code: str, realm_id: Optional[str] = None) -> Dict[str, Any]:
        token_url = f"{self.tenant_url}/token"
        response = httpx.post(
            token_url,
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
        token_url = f"{self.tenant_url}/token"
        response = httpx.post(
            token_url,
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

    def sync_pull(self, entity_type: str, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Pull Workday data. Supported types: payroll_summary, expense_reports, employees."""
        token = self.get_access_token()
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

        if entity_type == "payroll_summary":
            url = f"{self.tenant_url}/payroll/v1/payrollResults"
            response = httpx.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            data = response.json().get("data", [])
            self.log_sync(entity_type, "pull", len(data))
            return data

        if entity_type == "expense_reports":
            url = f"{self.tenant_url}/expenseManagement/v1/expenseReports"
            params = {}
            if since:
                params["from"] = since.isoformat()
            response = httpx.get(url, params=params, headers=headers, timeout=30)
            response.raise_for_status()
            data = response.json().get("data", [])
            self.log_sync(entity_type, "pull", len(data))
            return data

        return []

    def sync_push(self, entity_type: str, records: List[Dict[str, Any]]) -> Dict[str, Any]:
        return {"succeeded": 0, "failed": 0, "errors": ["sync_push not supported for Workday"]}

    def handle_webhook(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        return []
