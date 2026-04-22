"""
Agent tool: Trigger integration syncs.

Tools:
  trigger_sync — trigger a sync for a connected integration (requires_confirmation=False)
"""

from typing import Dict, Any
from lib.agent.tools.registry import AgentTool, register_tool
from database import supabase


async def handle_trigger_sync(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Trigger a data sync for a connected integration provider."""
    company_id = context["company_id"]
    provider = arguments.get("provider", "").lower().strip()

    if not provider:
        # List available providers
        rows = supabase.table("integration_connections")\
            .select("provider, status, last_sync_at")\
            .eq("company_id", company_id)\
            .eq("status", "active")\
            .execute().data or []
        if not rows:
            return {"error": "No active integrations connected. Connect an integration first via the Integrations page."}
        return {
            "message": "Specify a provider to sync.",
            "available_providers": [r["provider"] for r in rows],
        }

    conn = supabase.table("integration_connections")\
        .select("id, status, last_sync_at")\
        .eq("company_id", company_id)\
        .eq("provider", provider)\
        .eq("status", "active")\
        .execute()

    if not conn.data:
        return {"error": f"No active {provider} connection found. Connect it first via the Integrations page."}

    connection_id = conn.data[0]["id"]

    from lib.integrations.registry import get as get_integration
    IntegrationClass = get_integration(provider)
    if not IntegrationClass:
        return {"error": f"Unknown provider '{provider}'."}

    defaults = {
        "quickbooks": ["accounts", "customers", "vendors", "invoices", "bills"],
        "workday": ["payroll_summary", "expense_reports"],
        "carta": ["cap_table", "equity_grants", "valuations"],
    }
    entity_types = arguments.get("entity_types") or defaults.get(provider, [])

    integration = IntegrationClass(company_id=company_id, connection_id=connection_id)
    results = {}
    for entity_type in entity_types:
        try:
            records = integration.sync_pull(entity_type)
            results[entity_type] = {"synced": len(records), "ok": True}
        except Exception as e:
            results[entity_type] = {"ok": False, "error": str(e)}

    supabase.table("integration_connections")\
        .update({"last_sync_at": "now()"})\
        .eq("id", connection_id)\
        .execute()

    total = sum(v.get("synced", 0) for v in results.values() if v.get("ok"))
    errors = [f"{k}: {v['error']}" for k, v in results.items() if not v.get("ok")]

    return {
        "ok": True,
        "provider": provider,
        "results": results,
        "total_synced": total,
        "errors": errors,
        "message": (
            f"{provider.capitalize()} sync complete — {total} records updated."
            + (f" Errors: {'; '.join(errors)}" if errors else "")
        ),
    }


def register():
    """Register sync agent tool."""
    register_tool(AgentTool(
        name="trigger_sync",
        description=(
            "Trigger a data sync for a connected integration (QuickBooks, Workday, Carta). "
            "Pulls latest data from the provider and updates Fintra. "
            "Call without a provider to see what's connected."
        ),
        parameters={
            "type": "object",
            "properties": {
                "provider": {
                    "type": "string",
                    "description": "Integration provider to sync: 'quickbooks', 'workday', 'carta'",
                    "enum": ["quickbooks", "workday", "carta"],
                },
                "entity_types": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional: specific entity types to sync. Defaults to all for the provider.",
                },
            },
        },
        handler=handle_trigger_sync,
        requires_confirmation=False,
    ))
