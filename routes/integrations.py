"""
Unified integrations endpoints.
All third-party integrations (QuickBooks, Workday, Carta, etc.) are managed here.

Endpoints:
  GET  /integrations                          — list connected integrations for the company
  POST /integrations/{provider}/connect       — initiate OAuth (returns auth URL)
  GET  /integrations/{provider}/callback      — OAuth callback (exchange code for tokens)
  POST /integrations/{provider}/sync          — trigger incremental sync
  POST /integrations/quickbooks/import        — full initial import from QBO
  DELETE /integrations/{provider}/disconnect  — disconnect an integration
  POST /integrations/{provider}/webhook       — receive provider webhooks
"""

import secrets
from fastapi import APIRouter, HTTPException, Depends, Request, Query
from typing import Dict, Optional
from database import supabase
from middleware.auth import get_current_user_company, require_min_role
from lib.integrations.registry import get as get_integration, all_providers

router = APIRouter(prefix="/integrations", tags=["Integrations"])


@router.get("")
def list_integrations(auth: Dict = Depends(get_current_user_company)):
    """List all connected integrations for the authenticated company."""
    company_id = auth["company_id"]
    rows = supabase.table("integration_connections")\
        .select("id, provider, status, last_sync_at, created_at, config")\
        .eq("company_id", company_id)\
        .neq("status", "disconnected")\
        .execute().data or []

    # Mask config to not expose realm_ids etc. to non-admins — just return provider + status
    return [
        {
            "id": r["id"],
            "provider": r["provider"],
            "status": r["status"],
            "last_sync_at": r["last_sync_at"],
            "connected_at": r["created_at"],
        }
        for r in rows
    ]


@router.post("/{provider}/connect")
def connect_integration(
    provider: str,
    auth: Dict = Depends(require_min_role("admin")),
):
    """
    Initiate OAuth connection. Returns the authorization URL to redirect the user to.
    A CSRF state token is generated and stored in the DB for validation on callback.
    """
    IntegrationClass = get_integration(provider)
    if not IntegrationClass:
        raise HTTPException(status_code=404, detail=f"Unknown integration provider: '{provider}'. Available: {all_providers()}")

    company_id = auth["company_id"]
    state = secrets.token_urlsafe(32)

    # Store state for CSRF validation on callback
    supabase.table("integration_connections").insert({
        "company_id": company_id,
        "provider": provider,
        "status": "pending",
        "config": {"oauth_state": state},
        "access_token": "pending",
    }).execute()

    integration = IntegrationClass(company_id=company_id)
    auth_url = integration.get_auth_url(state=state)

    return {"auth_url": auth_url, "state": state}


@router.get("/{provider}/callback")
def oauth_callback(
    provider: str,
    code: str = Query(...),
    state: str = Query(...),
    realm_id: Optional[str] = Query(None),  # QuickBooks sends this
):
    """
    OAuth 2.0 callback. Validates CSRF state, exchanges code for tokens, saves connection.
    This endpoint is called by the provider redirect — it's NOT authenticated via JWT.
    """
    IntegrationClass = get_integration(provider)
    if not IntegrationClass:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")

    # Find the pending connection with matching state
    pending = supabase.table("integration_connections")\
        .select("id, company_id, config")\
        .eq("provider", provider)\
        .eq("status", "pending")\
        .execute().data or []

    matched = next(
        (p for p in pending if p.get("config", {}).get("oauth_state") == state),
        None
    )
    if not matched:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state. Please try connecting again.")

    company_id = matched["company_id"]
    pending_id = matched["id"]

    try:
        integration = IntegrationClass(company_id=company_id, connection_id=pending_id)
        connection = integration.authenticate(auth_code=code, realm_id=realm_id)
    except Exception as e:
        # Clean up pending row on failure
        supabase.table("integration_connections").delete().eq("id", pending_id).execute()
        raise HTTPException(status_code=400, detail=f"OAuth authentication failed: {e}")

    # Remove the pending placeholder (authenticate() saved a new row)
    supabase.table("integration_connections").delete().eq("id", pending_id).execute()

    return {
        "ok": True,
        "provider": provider,
        "connection_id": connection.get("id"),
        "message": f"{provider.capitalize()} connected successfully. You can close this window.",
    }


@router.post("/{provider}/sync")
def trigger_sync(
    provider: str,
    body: dict = {},
    auth: Dict = Depends(require_min_role("accountant")),
):
    """Trigger a data sync for a connected integration."""
    IntegrationClass = get_integration(provider)
    if not IntegrationClass:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")

    company_id = auth["company_id"]
    conn = supabase.table("integration_connections")\
        .select("id, status")\
        .eq("company_id", company_id)\
        .eq("provider", provider)\
        .eq("status", "active")\
        .execute()
    if not conn.data:
        raise HTTPException(status_code=404, detail=f"No active {provider} connection found. Connect it first.")

    connection_id = conn.data[0]["id"]
    entity_types = body.get("entity_types") or _default_entity_types(provider)

    integration = IntegrationClass(company_id=company_id, connection_id=connection_id)
    results = {}
    for entity_type in entity_types:
        try:
            records = integration.sync_pull(entity_type)
            results[entity_type] = {"synced": len(records), "ok": True}
        except Exception as e:
            results[entity_type] = {"ok": False, "error": str(e)}

    # Update last_sync_at
    supabase.table("integration_connections")\
        .update({"last_sync_at": "now()"})\
        .eq("id", connection_id)\
        .execute()

    return {"provider": provider, "results": results}


@router.post("/quickbooks/import")
def quickbooks_full_import(
    body: dict = {},
    auth: Dict = Depends(require_min_role("accountant")),
):
    """
    Full initial import from QuickBooks Online.
    Imports all entities in order: accounts → customers → vendors → invoices → bills.
    Safe to run multiple times (upserts, not inserts).
    """
    from lib.integrations.quickbooks import QuickBooksIntegration

    company_id = auth["company_id"]
    conn = supabase.table("integration_connections")\
        .select("id, status")\
        .eq("company_id", company_id)\
        .eq("provider", "quickbooks")\
        .eq("status", "active")\
        .execute()
    if not conn.data:
        raise HTTPException(
            status_code=404,
            detail="No active QuickBooks connection. Connect QuickBooks first via /integrations/quickbooks/connect"
        )

    connection_id = conn.data[0]["id"]
    integration = QuickBooksIntegration(company_id=company_id, connection_id=connection_id)

    entity_order = body.get("entity_types") or ["accounts", "customers", "vendors", "invoices", "bills"]
    results = {}

    for entity_type in entity_order:
        try:
            records = integration.sync_pull(entity_type)
            results[entity_type] = {"imported": len(records), "ok": True}
        except Exception as e:
            results[entity_type] = {"ok": False, "error": str(e)}

    supabase.table("integration_connections")\
        .update({"last_sync_at": "now()"})\
        .eq("id", connection_id)\
        .execute()

    total_imported = sum(v.get("imported", 0) for v in results.values() if v.get("ok"))
    return {
        "provider": "quickbooks",
        "total_imported": total_imported,
        "results": results,
        "message": f"QuickBooks import complete. {total_imported} records imported across {len(entity_order)} entity types.",
    }


@router.delete("/{provider}/disconnect")
def disconnect_integration(
    provider: str,
    auth: Dict = Depends(require_min_role("admin")),
):
    """Disconnect an integration, marking it as disconnected."""
    company_id = auth["company_id"]
    conn = supabase.table("integration_connections")\
        .select("id")\
        .eq("company_id", company_id)\
        .eq("provider", provider)\
        .neq("status", "disconnected")\
        .execute()
    if not conn.data:
        raise HTTPException(status_code=404, detail=f"No active {provider} connection found.")

    connection_id = conn.data[0]["id"]
    IntegrationClass = get_integration(provider)
    if IntegrationClass:
        try:
            integration = IntegrationClass(company_id=company_id, connection_id=connection_id)
            integration.disconnect()
        except Exception:
            pass

    supabase.table("integration_connections")\
        .update({"status": "disconnected"})\
        .eq("id", connection_id)\
        .execute()

    return {"ok": True, "message": f"{provider.capitalize()} disconnected."}


@router.post("/{provider}/webhook")
async def receive_webhook(provider: str, request: Request):
    """
    Receive inbound webhook from a provider.
    Signature verification is provider-specific and handled by the integration class.
    """
    IntegrationClass = get_integration(provider)
    if not IntegrationClass:
        return {"ok": True}  # Silently accept unknown providers (don't expose 404)

    payload = await request.json()

    # Find connection(s) for this provider (webhooks are not company-scoped in the URL)
    conns = supabase.table("integration_connections")\
        .select("id, company_id")\
        .eq("provider", provider)\
        .eq("status", "active")\
        .execute().data or []

    for conn in conns:
        try:
            integration = IntegrationClass(company_id=conn["company_id"], connection_id=conn["id"])
            actions = integration.handle_webhook(payload)
            integration.log_sync("webhook", "pull", len(actions))
        except Exception:
            pass

    return {"ok": True}


def _default_entity_types(provider: str) -> list:
    defaults = {
        "quickbooks": ["accounts", "customers", "vendors", "invoices", "bills"],
        "workday": ["payroll_summary", "expense_reports"],
        "carta": ["cap_table", "equity_grants", "valuations"],
    }
    return defaults.get(provider, [])
