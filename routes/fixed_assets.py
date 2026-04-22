"""
Fixed assets management: register assets, compute depreciation schedules.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict
from database import supabase
from middleware.auth import get_current_user_company, require_min_role

router = APIRouter(prefix="/fixed-assets", tags=["Fixed Assets"])


class FixedAssetCreate(BaseModel):
    name: str
    cost: float
    purchase_date: str
    useful_life_months: int
    salvage_value: float = 0
    depreciation_method: str = "straight_line"
    description: Optional[str] = None
    asset_code: Optional[str] = None
    asset_account_id: Optional[str] = None
    depreciation_account_id: Optional[str] = None
    accumulated_account_id: Optional[str] = None


class FixedAssetUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    salvage_value: Optional[float] = None
    accumulated_depreciation: Optional[float] = None
    last_depreciation_date: Optional[str] = None
    asset_account_id: Optional[str] = None
    depreciation_account_id: Optional[str] = None
    accumulated_account_id: Optional[str] = None
    disposed_at: Optional[str] = None


@router.get("")
def list_fixed_assets(
    include_disposed: bool = False,
    auth: Dict = Depends(get_current_user_company),
):
    """List fixed assets with computed monthly depreciation."""
    from lib.month_end import compute_depreciation
    cid = auth["company_id"]
    q = supabase.table("fixed_assets").select("*").eq("company_id", cid)
    if not include_disposed:
        q = q.eq("is_active", True)
    rows = q.order("purchase_date").execute().data or []

    result = []
    for a in rows:
        monthly = compute_depreciation(a)
        book_value = float(a["cost"]) - float(a["accumulated_depreciation"])
        result.append({**a, "monthly_depreciation": monthly, "book_value": round(book_value, 2)})
    return result


@router.post("")
def create_fixed_asset(
    body: FixedAssetCreate,
    auth: Dict = Depends(require_min_role("accountant")),
):
    """Create a fixed asset."""
    cid = auth["company_id"]
    r = supabase.table("fixed_assets").insert({
        "company_id": cid,
        "name": body.name,
        "cost": body.cost,
        "purchase_date": body.purchase_date,
        "useful_life_months": body.useful_life_months,
        "salvage_value": body.salvage_value,
        "depreciation_method": body.depreciation_method,
        "description": body.description,
        "asset_code": body.asset_code,
        "asset_account_id": body.asset_account_id,
        "depreciation_account_id": body.depreciation_account_id,
        "accumulated_account_id": body.accumulated_account_id,
        "accumulated_depreciation": 0,
        "is_active": True,
    }).execute()
    if not r.data:
        raise HTTPException(status_code=400, detail="Failed to create asset")
    return r.data[0]


@router.patch("/{asset_id}")
def update_fixed_asset(
    asset_id: str,
    body: FixedAssetUpdate,
    auth: Dict = Depends(require_min_role("accountant")),
):
    """Update a fixed asset (e.g. dispose, set GL accounts)."""
    cid = auth["company_id"]
    data = body.dict(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    r = supabase.table("fixed_assets").update(data).eq("id", asset_id).eq("company_id", cid).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    return r.data[0]


@router.delete("/{asset_id}")
def dispose_fixed_asset(asset_id: str, auth: Dict = Depends(require_min_role("accountant"))):
    """Dispose (soft-delete) a fixed asset."""
    cid = auth["company_id"]
    r = supabase.table("fixed_assets").update({
        "is_active": False, "disposed_at": str(__import__('datetime').date.today())
    }).eq("id", asset_id).eq("company_id", cid).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"ok": True}
