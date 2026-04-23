"""
Tax Rates: company-configured tax rates used on invoices and bills.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict
from database import supabase
from middleware.auth import get_current_user_company, require_min_role

router = APIRouter(prefix="/tax-rates", tags=["Tax Rates"])


class TaxRateCreate(BaseModel):
    name: str
    rate: float                          # 0–1, e.g. 0.0875 for 8.75%
    tax_type: str = "sales"             # sales | purchase | both
    jurisdiction: Optional[str] = None
    description: Optional[str] = None
    tax_account_id: Optional[str] = None
    is_default: bool = False


class TaxRateUpdate(BaseModel):
    name: Optional[str] = None
    rate: Optional[float] = None
    tax_type: Optional[str] = None
    jurisdiction: Optional[str] = None
    description: Optional[str] = None
    tax_account_id: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


@router.get("")
def list_tax_rates(auth: Dict = Depends(get_current_user_company)):
    """List all tax rates for the company."""
    cid = auth["company_id"]
    r = supabase.table("tax_rates")\
        .select("*, accounts(account_code, account_name)")\
        .eq("company_id", cid)\
        .order("is_default", desc=True)\
        .order("name")\
        .execute()
    return r.data or []


@router.post("")
def create_tax_rate(body: TaxRateCreate, auth: Dict = Depends(require_min_role("admin"))):
    """Create a new tax rate."""
    cid = auth["company_id"]
    if body.rate < 0 or body.rate > 1:
        raise HTTPException(status_code=400, detail="Rate must be between 0 and 1 (e.g. 0.0875 for 8.75%)")

    # If setting as default, clear existing defaults
    if body.is_default:
        supabase.table("tax_rates")\
            .update({"is_default": False})\
            .eq("company_id", cid)\
            .eq("is_default", True)\
            .execute()

    r = supabase.table("tax_rates").insert({
        "company_id": cid,
        "name": body.name,
        "rate": body.rate,
        "tax_type": body.tax_type,
        "jurisdiction": body.jurisdiction,
        "description": body.description,
        "tax_account_id": body.tax_account_id,
        "is_default": body.is_default,
        "is_active": True,
    }).execute()
    if not r.data:
        raise HTTPException(status_code=400, detail="Failed to create tax rate")
    return r.data[0]


@router.patch("/{tax_rate_id}")
def update_tax_rate(
    tax_rate_id: str,
    body: TaxRateUpdate,
    auth: Dict = Depends(require_min_role("admin")),
):
    """Update a tax rate."""
    cid = auth["company_id"]
    data = body.dict(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "rate" in data and (data["rate"] < 0 or data["rate"] > 1):
        raise HTTPException(status_code=400, detail="Rate must be between 0 and 1")

    if data.get("is_default"):
        supabase.table("tax_rates")\
            .update({"is_default": False})\
            .eq("company_id", cid)\
            .eq("is_default", True)\
            .neq("id", tax_rate_id)\
            .execute()

    r = supabase.table("tax_rates")\
        .update(data)\
        .eq("id", tax_rate_id)\
        .eq("company_id", cid)\
        .execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Tax rate not found")
    return r.data[0]


@router.delete("/{tax_rate_id}")
def delete_tax_rate(tax_rate_id: str, auth: Dict = Depends(require_min_role("admin"))):
    """Soft-delete a tax rate (set is_active=False)."""
    cid = auth["company_id"]
    r = supabase.table("tax_rates")\
        .update({"is_active": False})\
        .eq("id", tax_rate_id)\
        .eq("company_id", cid)\
        .execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Tax rate not found")
    return {"ok": True}
