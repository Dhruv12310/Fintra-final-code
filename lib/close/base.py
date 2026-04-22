"""
Abstract base class for industry-specific month-end close handlers.
Mirrors the pattern in lib/payroll/industries/base.py.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class CloseJE:
    """A journal entry to be created by the close engine."""
    memo: str
    reference: str
    source: str
    lines: list          # [{account_id, debit, credit, description}]
    entry_date: str      # YYYY-MM-DD
    metadata: dict = field(default_factory=dict)


@dataclass
class CloseWarning:
    """A non-blocking issue surfaced by the close engine."""
    code: str            # machine-readable key
    message: str
    severity: str = "warn"   # warn | fail


class CloseHandler(ABC):
    """Abstract base for all industry close handlers."""

    industry_key: str = "default"

    @abstractmethod
    def pre_close_checks(
        self, company_id: str, period_start: str, period_end: str
    ) -> list[CloseWarning]:
        """
        Run industry-specific pre-close validations.
        Return warnings that will be shown before running the close.
        """

    @abstractmethod
    def generate_vertical_schedules(
        self, company_id: str, period_start: str, period_end: str
    ) -> list[CloseJE]:
        """
        Generate the industry-specific JEs for this period close:
        WIP entries, retention reclasses, lease amortization, etc.
        Called after depreciation (step 4) and before report snapshots.
        """

    @abstractmethod
    def amortize_prepaids(
        self, company_id: str, period_end: str
    ) -> list[CloseJE]:
        """
        Release one period of amortization for active amortization_schedules.
        Default implementation handles this generically; verticals may override.
        """

    @abstractmethod
    def narrate_flux(
        self,
        company_id: str,
        current_period: dict,
        prior_period: dict,
    ) -> str:
        """
        Given two period snapshots (revenue, expenses, key line items),
        return an LLM-generated narrative suitable for a CFO close packet.
        """
