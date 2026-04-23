"""
Integration registry — maps provider names to their integration classes.
New integrations register themselves here.
"""

from typing import Dict, Type, Optional
from lib.integrations.base import BaseIntegration


_REGISTRY: Dict[str, Type[BaseIntegration]] = {}


def register(provider: str, cls: Type[BaseIntegration]):
    """Register an integration class for a provider name."""
    _REGISTRY[provider] = cls


def get(provider: str) -> Optional[Type[BaseIntegration]]:
    """Return the integration class for the given provider, or None."""
    return _REGISTRY.get(provider)


def all_providers() -> list[str]:
    """List all registered provider names."""
    return list(_REGISTRY.keys())


# ── Register built-in providers ────────────────────────────────────
# Imports are deferred to avoid import errors when optional SDKs are missing.

def _register_defaults():
    try:
        from lib.integrations.quickbooks import QuickBooksIntegration
        register("quickbooks", QuickBooksIntegration)
    except ImportError:
        pass

    try:
        from lib.integrations.workday import WorkdayIntegration
        register("workday", WorkdayIntegration)
    except ImportError:
        pass

    try:
        from lib.integrations.carta import CartaIntegration
        register("carta", CartaIntegration)
    except ImportError:
        pass


_register_defaults()
