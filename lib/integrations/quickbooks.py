"""
QuickBooks Online (QBO) integration via Intuit OAuth 2.0 + REST API.

OAuth flow:
  1. GET /integrations/quickbooks/connect → redirects user to get_auth_url()
  2. Intuit redirects back to GET /integrations/quickbooks/callback?code=...&realmId=...
  3. authenticate(code, realm_id) exchanges code → tokens, saves connection

Sync:
  - POST /integrations/quickbooks/sync  → sync_pull() for each entity type
  - Webhooks via POST /integrations/quickbooks/webhook

Requires env vars: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI
"""

import os
import httpx
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone, timedelta
from lib.integrations.base import BaseIntegration
from database import supabase


QBO_AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2"
QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
QBO_API_BASE = "https://quickbooks.api.intuit.com/v3/company"
QBO_SANDBOX_API = "https://sandbox-quickbooks.api.intuit.com/v3/company"


class QuickBooksIntegration(BaseIntegration):
    provider = "quickbooks"

    def __init__(self, company_id: str, connection_id: Optional[str] = None):
        super().__init__(company_id, connection_id)
        self.client_id = os.getenv("QBO_CLIENT_ID", "")
        self.client_secret = os.getenv("QBO_CLIENT_SECRET", "")
        self.redirect_uri = os.getenv("QBO_REDIRECT_URI", "http://localhost:8001/integrations/quickbooks/callback")
        self.realm_id: Optional[str] = None
        self._sandbox = os.getenv("QBO_ENV", "sandbox") == "sandbox"

    @property
    def api_base(self) -> str:
        return QBO_SANDBOX_API if self._sandbox else QBO_API_BASE

    def get_auth_url(self, state: str) -> str:
        """Build Intuit OAuth 2.0 authorization URL."""
        import urllib.parse
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "com.intuit.quickbooks.accounting",
            "state": state,
        }
        return f"{QBO_AUTH_BASE}?{urllib.parse.urlencode(params)}"

    def authenticate(self, auth_code: str, realm_id: Optional[str] = None) -> Dict[str, Any]:
        """Exchange authorization code for tokens and save connection."""
        import base64
        credentials = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        response = httpx.post(
            QBO_TOKEN_URL,
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            data={
                "grant_type": "authorization_code",
                "code": auth_code,
                "redirect_uri": self.redirect_uri,
            },
            timeout=30,
        )
        response.raise_for_status()
        tokens = response.json()

        expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
        connection = self.save_connection(
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
            token_expires_at=expires_at,
            config={"realm_id": realm_id} if realm_id else {},
        )
        self.realm_id = realm_id
        return connection

    def refresh_token(self) -> str:
        """Refresh QBO access token (expires every 1 hour)."""
        import base64
        if not self._refresh_token_value:
            self._load_tokens()

        credentials = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        response = httpx.post(
            QBO_TOKEN_URL,
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token_value,
            },
            timeout=30,
        )
        response.raise_for_status()
        tokens = response.json()

        expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
        self.update_tokens(
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token", self._refresh_token_value),
            token_expires_at=expires_at,
        )
        return tokens["access_token"]

    def _get_realm_id(self) -> str:
        if self.realm_id:
            return self.realm_id
        # Load from connection config
        row = supabase.table("integration_connections")\
            .select("config")\
            .eq("id", self.connection_id)\
            .single().execute()
        if row.data and row.data.get("config"):
            self.realm_id = row.data["config"].get("realm_id", "")
        return self.realm_id or ""

    def _qbo_get(self, query: str) -> Dict[str, Any]:
        """Execute a QBO SQL-like query via the REST API."""
        import urllib.parse
        token = self.get_access_token()
        realm_id = self._get_realm_id()
        url = f"{self.api_base}/{realm_id}/query"
        response = httpx.get(
            url,
            params={"query": query, "minorversion": "65"},
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def sync_pull(self, entity_type: str, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Pull entities from QBO and upsert into Fintra tables."""
        handlers = {
            "accounts": self._pull_accounts,
            "customers": self._pull_customers,
            "vendors": self._pull_vendors,
            "invoices": self._pull_invoices,
            "bills": self._pull_bills,
        }
        handler = handlers.get(entity_type)
        if not handler:
            return []
        records = handler(since)
        self.log_sync(entity_type, "pull", len(records))
        return records

    def _pull_accounts(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Pull QBO Chart of Accounts and upsert into Fintra accounts table."""
        where = ""
        if since:
            where = f" WHERE MetaData.LastUpdatedTime > '{since.isoformat()}'"
        data = self._qbo_get(f"SELECT * FROM Account{where} MAXRESULTS 1000")
        qbo_accounts = data.get("QueryResponse", {}).get("Account", [])

        upserted = []
        for acct in qbo_accounts:
            fintra_type, fintra_subtype = _map_qbo_account_type(
                acct.get("AccountType", ""), acct.get("AccountSubType", "")
            )
            row = {
                "company_id": self.company_id,
                "account_code": acct.get("AcctNum") or acct.get("Id"),
                "account_name": acct.get("Name", ""),
                "account_type": fintra_type,
                "account_subtype": fintra_subtype,
                "is_active": acct.get("Active", True),
                "description": acct.get("Description"),
            }
            # Upsert by account_code + company_id
            existing = supabase.table("accounts")\
                .select("id")\
                .eq("company_id", self.company_id)\
                .eq("account_code", row["account_code"])\
                .execute()
            if existing.data:
                supabase.table("accounts").update(row).eq("id", existing.data[0]["id"]).execute()
                upserted.append(row)
            else:
                result = supabase.table("accounts").insert(row).execute()
                if result.data:
                    upserted.append(result.data[0])
        return upserted

    def _pull_customers(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        where = ""
        if since:
            where = f" WHERE MetaData.LastUpdatedTime > '{since.isoformat()}'"
        data = self._qbo_get(f"SELECT * FROM Customer{where} MAXRESULTS 1000")
        customers = data.get("QueryResponse", {}).get("Customer", [])
        upserted = []
        for c in customers:
            row = {
                "company_id": self.company_id,
                "contact_type": "customer",
                "display_name": c.get("DisplayName", ""),
                "email": (c.get("PrimaryEmailAddr") or {}).get("Address"),
                "phone": (c.get("PrimaryPhone") or {}).get("FreeFormNumber"),
                "is_active": c.get("Active", True),
            }
            existing = supabase.table("contacts")\
                .select("id")\
                .eq("company_id", self.company_id)\
                .eq("display_name", row["display_name"])\
                .eq("contact_type", "customer")\
                .execute()
            if existing.data:
                supabase.table("contacts").update(row).eq("id", existing.data[0]["id"]).execute()
            else:
                result = supabase.table("contacts").insert(row).execute()
                if result.data:
                    upserted.append(result.data[0])
        return upserted

    def _pull_vendors(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        where = ""
        if since:
            where = f" WHERE MetaData.LastUpdatedTime > '{since.isoformat()}'"
        data = self._qbo_get(f"SELECT * FROM Vendor{where} MAXRESULTS 1000")
        vendors = data.get("QueryResponse", {}).get("Vendor", [])
        upserted = []
        for v in vendors:
            row = {
                "company_id": self.company_id,
                "contact_type": "vendor",
                "display_name": v.get("DisplayName", ""),
                "email": (v.get("PrimaryEmailAddr") or {}).get("Address"),
                "phone": (v.get("PrimaryPhone") or {}).get("FreeFormNumber"),
                "is_active": v.get("Active", True),
            }
            existing = supabase.table("contacts")\
                .select("id")\
                .eq("company_id", self.company_id)\
                .eq("display_name", row["display_name"])\
                .eq("contact_type", "vendor")\
                .execute()
            if existing.data:
                supabase.table("contacts").update(row).eq("id", existing.data[0]["id"]).execute()
            else:
                result = supabase.table("contacts").insert(row).execute()
                if result.data:
                    upserted.append(result.data[0])
        return upserted

    def _pull_invoices(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        where = ""
        if since:
            where = f" WHERE MetaData.LastUpdatedTime > '{since.isoformat()}'"
        data = self._qbo_get(f"SELECT * FROM Invoice{where} MAXRESULTS 500")
        return data.get("QueryResponse", {}).get("Invoice", [])

    def _pull_bills(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        where = ""
        if since:
            where = f" WHERE MetaData.LastUpdatedTime > '{since.isoformat()}'"
        data = self._qbo_get(f"SELECT * FROM Bill{where} MAXRESULTS 500")
        return data.get("QueryResponse", {}).get("Bill", [])

    def sync_push(self, entity_type: str, records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Push records to QBO (Phase 1B — bidirectional sync). Stub for now."""
        return {"succeeded": 0, "failed": 0, "errors": ["sync_push not yet implemented for QBO"]}

    def handle_webhook(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Process Intuit CDC webhook event notifications."""
        actions = []
        event_notifications = payload.get("eventNotifications", [])
        for notification in event_notifications:
            realm_id = notification.get("realmId")
            data_change = notification.get("dataChangeEvent", {})
            for entity in data_change.get("entities", []):
                entity_name = entity.get("name")
                operation = entity.get("operation")
                actions.append({
                    "realm_id": realm_id,
                    "entity": entity_name,
                    "operation": operation,
                    "id": entity.get("id"),
                    "updated_at": entity.get("lastUpdated"),
                })
        return actions


def _map_qbo_account_type(qbo_type: str, qbo_subtype: str):
    """Map QBO AccountType/AccountSubType to Fintra account_type/account_subtype."""
    type_map = {
        "Bank": ("asset", "bank"),
        "Other Current Asset": ("asset", "current_asset"),
        "Fixed Asset": ("asset", "fixed_asset"),
        "Other Asset": ("asset", "other_asset"),
        "Accounts Receivable": ("asset", "accounts_receivable"),
        "Accounts Payable": ("liability", "accounts_payable"),
        "Credit Card": ("liability", "credit_card"),
        "Other Current Liability": ("liability", "current_liability"),
        "Long Term Liability": ("liability", "long_term_liability"),
        "Equity": ("equity", "equity"),
        "Income": ("revenue", "revenue"),
        "Other Income": ("revenue", "other_income"),
        "Cost of Goods Sold": ("expense", "cogs"),
        "Expense": ("expense", "operating_expense"),
        "Other Expense": ("expense", "other_expense"),
    }
    fintra_type, fintra_subtype = type_map.get(qbo_type, ("asset", "other_asset"))
    return fintra_type, fintra_subtype
