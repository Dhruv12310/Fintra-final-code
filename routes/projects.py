"""
Projects CRUD — used by Construction close handler for WIP tracking.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, List
from database import supabase
from middleware.auth import get_current_user_company, require_min_role

router = APIRouter(prefix="/projects", tags=["Projects"])


class ProjectCreate(BaseModel):
    name: str
    project_number: Optional[str] = None
    customer_contact_id: Optional[str] = None
    contract_value: float = 0
    estimated_total_costs: float = 0
    retention_pct: float = 0
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    contract_value: Optional[float] = None
    estimated_total_costs: Optional[float] = None
    retention_pct: Optional[float] = None
    status: Optional[str] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None


class ProjectCostCreate(BaseModel):
    project_id: str
    cost_category: str = "other"
    amount: float
    date: str
    description: Optional[str] = None
    source_type: Optional[str] = None
    source_id: Optional[str] = None


@router.get("")
def list_projects(
    status: Optional[str] = "active",
    auth: Dict = Depends(get_current_user_company),
):
    cid = auth["company_id"]
    q = supabase.table("projects")\
        .select("*, contacts(display_name)")\
        .eq("company_id", cid)\
        .is_("deleted_at", "null")\
        .order("created_at", desc=True)
    if status:
        q = q.eq("status", status)
    return q.execute().data or []


@router.post("")
def create_project(
    body: ProjectCreate,
    auth: Dict = Depends(require_min_role("accountant")),
):
    cid = auth["company_id"]
    r = supabase.table("projects").insert({
        "company_id": cid,
        **body.model_dump(exclude_none=True),
    }).execute()
    if not r.data:
        raise HTTPException(status_code=500, detail="Failed to create project")
    return r.data[0]


@router.patch("/{project_id}")
def update_project(
    project_id: str,
    body: ProjectUpdate,
    auth: Dict = Depends(require_min_role("accountant")),
):
    cid = auth["company_id"]
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    supabase.table("projects").update(updates)\
        .eq("id", project_id).eq("company_id", cid).execute()
    return {"ok": True}


@router.delete("/{project_id}")
def delete_project(
    project_id: str,
    auth: Dict = Depends(require_min_role("accountant")),
):
    cid = auth["company_id"]
    from datetime import datetime, timezone
    supabase.table("projects")\
        .update({"deleted_at": datetime.now(timezone.utc).isoformat()})\
        .eq("id", project_id).eq("company_id", cid).execute()
    return {"ok": True}


@router.get("/{project_id}/wip")
def project_wip(
    project_id: str,
    auth: Dict = Depends(get_current_user_company),
):
    """WIP schedule for a project."""
    cid = auth["company_id"]
    entries = supabase.table("wip_entries")\
        .select("*")\
        .eq("company_id", cid)\
        .eq("project_id", project_id)\
        .order("period_end", desc=True)\
        .execute().data or []
    return entries


@router.get("/{project_id}/costs")
def project_costs(
    project_id: str,
    auth: Dict = Depends(get_current_user_company),
):
    cid = auth["company_id"]
    costs = supabase.table("project_costs")\
        .select("*")\
        .eq("company_id", cid)\
        .eq("project_id", project_id)\
        .order("date", desc=True)\
        .execute().data or []

    by_category: dict = {}
    for c in costs:
        cat = c.get("cost_category", "other")
        by_category[cat] = by_category.get(cat, 0) + float(c.get("amount") or 0)

    return {"costs": costs, "by_category": by_category, "total": sum(by_category.values())}


@router.post("/costs")
def add_project_cost(
    body: ProjectCostCreate,
    auth: Dict = Depends(require_min_role("accountant")),
):
    cid = auth["company_id"]
    r = supabase.table("project_costs").insert({
        "company_id": cid,
        **body.model_dump(exclude_none=True),
    }).execute()
    if not r.data:
        raise HTTPException(status_code=500, detail="Failed to add project cost")
    return r.data[0]
