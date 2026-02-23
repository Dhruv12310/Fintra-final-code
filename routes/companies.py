from fastapi import APIRouter, HTTPException, Depends, Header
from database import table, supabase
from typing import Dict, Optional
from middleware.auth import get_current_user_company, require_role, verify_token, ensure_user_row_from_token

router = APIRouter(prefix="/companies", tags=["Companies"])


# Get all companies (with users included)
@router.get("/with-users")
def get_companies_with_users():
    """Fetch all companies along with their associated users."""
    try:
        response = table("companies").select("*, users(full_name, email, role, user_type)").execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching companies: {e}")


# Get authenticated user's company (works for users with or without companies)
@router.get("/")
async def get_all_companies(
    authorization: Optional[str] = Header(None),
    user_id: str = Depends(verify_token)
):
    try:
        user_response = supabase.table("users").select("company_id").eq("id", user_id).limit(1).execute()

        if not user_response.data:
            ensure_user_row_from_token(authorization)
            user_response = supabase.table("users").select("company_id").eq("id", user_id).limit(1).execute()

        if not user_response.data or not user_response.data[0].get("company_id"):
            return {"status": "success", "data": []}

        company_id = user_response.data[0]["company_id"]
        response = table("companies").select("*").eq("id", company_id).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Get a single company by ID (with users)
@router.get("/{company_id}")
def get_company(company_id: str, auth: Dict[str, str] = Depends(get_current_user_company)):
    try:
        # Verify user owns this company
        if auth["company_id"] != company_id:
            raise HTTPException(status_code=403, detail="Cannot access another company")

        response = (
            table("companies")
            .select("*, users(full_name, email, role, user_type)")
            .eq("id", company_id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Company not found.")
        return {"status": "success", "data": response.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Create a new company
@router.post("/")
def create_company(company: dict):
    try:
        response = table("companies").insert(company).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Update a company
@router.patch("/{company_id}")
async def update_company(
    company_id: str,
    update_data: dict,
    authorization: Optional[str] = Header(None),
    user_id: str = Depends(verify_token)
):
    try:
        user_response = supabase.table("users").select("company_id, id").eq("id", user_id).limit(1).execute()

        if not user_response.data:
            ensure_user_row_from_token(authorization)
            user_response = supabase.table("users").select("company_id, id").eq("id", user_id).limit(1).execute()

        if not user_response.data:
            raise HTTPException(status_code=404, detail="User not found")

        user_company_id = user_response.data[0].get("company_id")

        # Verify the company exists and get onboarding status
        company_response = supabase.table("companies").select("id, onboarding_completed").eq("id", company_id).limit(1).execute()

        if not company_response.data:
            raise HTTPException(status_code=404, detail="Company not found")

        company_row = company_response.data[0]
        company_still_in_onboarding = company_row.get("onboarding_completed") is False

        # Allow update if:
        # 1. User's company_id matches (already onboarded), OR
        # 2. User has no company yet (onboarding), OR
        # 3. Company is still in onboarding (user may have just created it; link may not be set yet)
        if user_company_id and user_company_id != company_id and not company_still_in_onboarding:
            raise HTTPException(status_code=403, detail="Cannot update another company")

        # Update the company
        response = table("companies").update(update_data).eq("id", company_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Company not found.")

        # Link user to this company if not already linked (first time or was linked to different one during onboarding)
        if not user_company_id or (company_still_in_onboarding and user_company_id != company_id):
            supabase.table("users").update({"company_id": company_id}).eq("id", user_id).execute()

        # Auto-provision Chart of Accounts when onboarding completes
        if update_data.get("onboarding_completed") is True and company_still_in_onboarding:
            from routes.coa_templates import provision_coa_for_company
            industry = response.data[0].get("industry", "") if response.data else ""
            provision_coa_for_company(company_id, industry)

        return {"status": "success", "data": response.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Delete a company (admin only)
@router.delete("/{company_id}")
def delete_company(company_id: str, auth: Dict[str, str] = Depends(lambda a=Depends(get_current_user_company): require_role("admin", a))):
    try:
        # Additional check: can only delete own company even as admin
        if auth["company_id"] != company_id:
            raise HTTPException(status_code=403, detail="Cannot delete another company")

        response = table("companies").delete().eq("id", company_id).execute()
        return {"status": "success", "message": f"Company {company_id} deleted successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Get all users belonging to a specific company
@router.get("/{company_id}/users")
def get_company_users(company_id: str):
    """Fetch all users that belong to a given company."""
    try:
        response = table("users").select("*, companies(name, industry)").eq("company_id", company_id).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching users: {e}")

