"""
Agent tool registry.
Tools are functions the agent can call via OpenAI function calling.
Each tool has: name, description, parameters schema (JSON Schema), and a handler function.
"""

from typing import Dict, Any, Callable, List, Optional
from dataclasses import dataclass, field


@dataclass
class AgentTool:
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema object for OpenAI
    handler: Callable          # async fn(arguments: dict, context: dict) -> dict
    requires_confirmation: bool = False  # True for write actions


_TOOLS: Dict[str, AgentTool] = {}


def register_tool(tool: AgentTool):
    """Register a tool in the global registry."""
    _TOOLS[tool.name] = tool


def get_tool(name: str) -> Optional[AgentTool]:
    """Retrieve a tool by name."""
    return _TOOLS.get(name)


def get_tools_for_openai() -> List[Dict[str, Any]]:
    """Format all registered tools for the OpenAI `tools` parameter."""
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }
        for tool in _TOOLS.values()
    ]


def get_tools_for_anthropic() -> List[Dict[str, Any]]:
    """Format all registered tools for the Anthropic `tools` parameter.
    Anthropic uses `input_schema` instead of `parameters` and no outer type wrapper."""
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.parameters,
        }
        for tool in _TOOLS.values()
    ]


async def execute_tool(name: str, arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute a registered tool by name.
    context dict contains: company_id, user_id, role
    Returns: { result: any, requires_confirmation: bool, action_id: str (if confirmation needed) }
    """
    tool = get_tool(name)
    if not tool:
        return {"error": f"Unknown tool: {name}"}
    try:
        result = await tool.handler(arguments, context)
        return {
            "result": result,
            "requires_confirmation": tool.requires_confirmation,
        }
    except Exception as e:
        return {"error": str(e)}


# ── Auto-register all built-in tools on import ─────────────────────

def _register_defaults():
    try:
        from lib.agent.tools.query_tool import register as register_query
        register_query()
    except ImportError:
        pass

    try:
        from lib.agent.tools.journal_tool import register as register_journal
        register_journal()
    except ImportError:
        pass

    try:
        from lib.agent.tools.categorize_tool import register as register_categorize
        register_categorize()
    except ImportError:
        pass

    try:
        from lib.agent.tools.invoice_tool import register as register_invoice
        register_invoice()
    except ImportError:
        pass

    try:
        from lib.agent.tools.banking_tool import register as register_banking
        register_banking()
    except ImportError:
        pass

    try:
        from lib.agent.tools.sync_tool import register as register_sync
        register_sync()
    except ImportError:
        pass

    try:
        from lib.agent.tools.recurring_tool import register as register_recurring
        register_recurring()
    except ImportError:
        pass

    try:
        from lib.agent.tools.reconciliation_tool import register as register_reconciliation
        register_reconciliation()
    except ImportError:
        pass

    try:
        from lib.agent.tools.close_tool import register as register_close
        register_close()
    except ImportError:
        pass

    try:
        from lib.agent.tools.collections_tool import register as register_collections
        register_collections()
    except ImportError:
        pass

    try:
        from lib.agent.tools.document_tool import register as register_document
        register_document()
    except ImportError:
        pass


_register_defaults()
