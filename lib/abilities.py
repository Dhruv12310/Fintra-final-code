"""
Ability-based RBAC layer.

Defines the action matrix per role, plus a check_ability() that consults the
role_permissions table for per-company overrides before falling back to the
default matrix.

Subjects map to logical resources (Invoice, Bill, Journal, Report, etc.).
Actions are verbs (view, create, edit, delete, post, void, export, manage).
"""

from typing import Dict, Set, Tuple
from database import supabase


SUBJECTS = (
    "Account", "Contact", "Invoice", "Bill", "Payment", "BillPayment",
    "Journal", "CreditNote", "VendorCredit", "Report", "GeneralLedger",
    "Banking", "BankReconciliation", "MonthEnd", "Period", "TaxRate",
    "Company", "User", "Role", "Integration", "Document", "Alert",
)

ACTIONS = ("view", "create", "edit", "delete", "post", "void", "export", "manage")


# Default ability matrix. role -> set of (subject, action). Anything not
# listed defaults to deny.
_FULL = {(s, a) for s in SUBJECTS for a in ACTIONS}
_VIEW_ONLY = {(s, "view") for s in SUBJECTS}

DEFAULTS: Dict[str, Set[Tuple[str, str]]] = {
    "owner": set(_FULL),
    "admin": set(_FULL) - {("Company", "delete"), ("Role", "manage")},
    "accountant": (
        {(s, "view") for s in SUBJECTS}
        | {(s, "create") for s in (
            "Invoice", "Bill", "Payment", "BillPayment", "Journal",
            "CreditNote", "VendorCredit", "Contact", "Document",
        )}
        | {(s, "edit") for s in (
            "Invoice", "Bill", "Payment", "BillPayment", "Journal",
            "CreditNote", "VendorCredit", "Contact", "Account", "TaxRate",
        )}
        | {(s, "post") for s in ("Invoice", "Bill", "Payment", "BillPayment", "Journal", "CreditNote", "VendorCredit")}
        | {(s, "void") for s in ("Invoice", "Bill", "Journal", "CreditNote", "VendorCredit")}
        | {("Report", "export"), ("GeneralLedger", "export"), ("MonthEnd", "manage"), ("Period", "manage")}
    ),
    "user": (
        {(s, "view") for s in SUBJECTS if s not in ("Role", "Company")}
        | {(s, "create") for s in ("Invoice", "Bill", "Contact", "Document")}
        | {(s, "edit") for s in ("Invoice", "Bill", "Contact", "Document")}
    ),
    "viewer": set(_VIEW_ONLY) - {("Role", "view"), ("User", "view")},
}


def _normalize_role(role: str) -> str:
    return (role or "").strip().lower() or "viewer"


def check_ability(role: str, subject: str, action: str, company_id: str = None) -> bool:
    """Return True if the role is allowed to perform action on subject for
    the given company. Per-company overrides in role_permissions take
    precedence over the default matrix."""
    role_n = _normalize_role(role)

    if company_id:
        try:
            r = supabase.table("role_permissions")\
                .select("allowed")\
                .eq("company_id", company_id)\
                .eq("role_name", role_n)\
                .eq("subject", subject)\
                .eq("action", action)\
                .limit(1).execute()
            if r.data:
                return bool(r.data[0]["allowed"])
        except Exception:
            # Fall through to defaults on any storage error
            pass

    return (subject, action) in DEFAULTS.get(role_n, set())


def list_default_abilities(role: str) -> list:
    role_n = _normalize_role(role)
    return sorted(
        [{"subject": s, "action": a} for s, a in DEFAULTS.get(role_n, set())],
        key=lambda x: (x["subject"], x["action"]),
    )
