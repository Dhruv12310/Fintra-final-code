"""
Abstract base class for all third-party integrations (QuickBooks, Workday, Carta, Plaid, etc.).

Every integration extends BaseIntegration and implements the abstract methods.
Token storage and encryption are handled here so subclasses never touch plaintext credentials.
"""

from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from database import supabase
from lib.crypto import encrypt_token, decrypt_token


class BaseIntegration(ABC):
    """
    Base class for all Fintra third-party integrations.

    Subclasses must implement: authenticate(), refresh_token(), sync_pull(), sync_push(), handle_webhook()
    """

    provider: str  # e.g. "quickbooks", "workday", "carta", "plaid"

    def __init__(self, company_id: str, connection_id: Optional[str] = None):
        self.company_id = company_id
        self.connection_id = connection_id
        self._access_token: Optional[str] = None
        self._refresh_token_value: Optional[str] = None
        self._token_expires_at: Optional[datetime] = None

    # ── Abstract interface ─────────────────────────────────────────

    @abstractmethod
    def get_auth_url(self, state: str) -> str:
        """Return the OAuth 2.0 authorization URL to redirect the user to."""
        ...

    @abstractmethod
    def authenticate(self, auth_code: str, realm_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Exchange an authorization code for tokens.
        Must call save_connection() with the resulting tokens.
        Returns the saved connection row dict.
        """
        ...

    @abstractmethod
    def refresh_token(self) -> str:
        """
        Refresh the access token using the stored refresh token.
        Must call update_tokens() with new token values.
        Returns the new access token.
        """
        ...

    @abstractmethod
    def sync_pull(self, entity_type: str, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """
        Pull records of entity_type from the provider since the given datetime.
        Returns a list of normalized record dicts.
        """
        ...

    @abstractmethod
    def sync_push(self, entity_type: str, records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Push records to the provider.
        Returns a dict with keys: succeeded (int), failed (int), errors (list).
        """
        ...

    @abstractmethod
    def handle_webhook(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Process an inbound webhook payload from the provider.
        Returns a list of actions taken (for logging).
        """
        ...

    # ── Token management ───────────────────────────────────────────

    def get_access_token(self) -> str:
        """Return a valid access token, refreshing if needed."""
        if not self._access_token:
            self._load_tokens()
        if self._is_token_expired():
            self._access_token = self.refresh_token()
        return self._access_token

    def _is_token_expired(self) -> bool:
        if not self._token_expires_at:
            return False
        return datetime.now(timezone.utc) >= self._token_expires_at

    def _load_tokens(self):
        """Load encrypted tokens from DB into memory."""
        if not self.connection_id:
            raise RuntimeError(f"No connection_id set for {self.provider} integration")
        row = supabase.table("integration_connections")\
            .select("access_token, refresh_token, token_expires_at")\
            .eq("id", self.connection_id)\
            .eq("company_id", self.company_id)\
            .single().execute()
        if not row.data:
            raise RuntimeError(f"Connection {self.connection_id} not found")
        self._access_token = decrypt_token(row.data["access_token"]) if row.data.get("access_token") else None
        self._refresh_token_value = decrypt_token(row.data["refresh_token"]) if row.data.get("refresh_token") else None
        if row.data.get("token_expires_at"):
            self._token_expires_at = datetime.fromisoformat(row.data["token_expires_at"])

    def save_connection(
        self,
        access_token: str,
        refresh_token: Optional[str] = None,
        token_expires_at: Optional[datetime] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create a new integration_connections row with encrypted tokens."""
        row = supabase.table("integration_connections").insert({
            "company_id": self.company_id,
            "provider": self.provider,
            "access_token": encrypt_token(access_token),
            "refresh_token": encrypt_token(refresh_token) if refresh_token else None,
            "token_expires_at": token_expires_at.isoformat() if token_expires_at else None,
            "status": "active",
            "config": config or {},
        }).execute()
        if not row.data:
            raise RuntimeError(f"Failed to save {self.provider} connection")
        self.connection_id = row.data[0]["id"]
        self._access_token = access_token
        self._refresh_token_value = refresh_token
        self._token_expires_at = token_expires_at
        return row.data[0]

    def update_tokens(
        self,
        access_token: str,
        refresh_token: Optional[str] = None,
        token_expires_at: Optional[datetime] = None,
    ):
        """Update tokens in DB after a refresh."""
        update_data: Dict[str, Any] = {
            "access_token": encrypt_token(access_token),
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
        }
        if refresh_token:
            update_data["refresh_token"] = encrypt_token(refresh_token)
        if token_expires_at:
            update_data["token_expires_at"] = token_expires_at.isoformat()
        supabase.table("integration_connections")\
            .update(update_data)\
            .eq("id", self.connection_id)\
            .execute()
        self._access_token = access_token
        if refresh_token:
            self._refresh_token_value = refresh_token
        self._token_expires_at = token_expires_at

    def log_sync(
        self,
        entity_type: str,
        direction: str,
        records_processed: int,
        errors: Optional[List[str]] = None,
    ):
        """Write a row to integration_sync_logs."""
        try:
            supabase.table("integration_sync_logs").insert({
                "connection_id": self.connection_id,
                "entity_type": entity_type,
                "direction": direction,
                "records_processed": records_processed,
                "errors": errors or [],
                "started_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
        except Exception:
            pass  # Logging must never block business flow

    def disconnect(self):
        """Mark the connection as disconnected in DB. Subclasses can override to revoke tokens first."""
        if self.connection_id:
            supabase.table("integration_connections")\
                .update({"status": "disconnected"})\
                .eq("id", self.connection_id)\
                .execute()
