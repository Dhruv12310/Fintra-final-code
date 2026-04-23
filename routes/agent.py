"""
Agent chat endpoint with Server-Sent Events (SSE) streaming.

POST /agent/chat
  Body: { session_id?: str, message: str, confirm_action_id?: str }
  Returns: SSE stream of events (text, tool_call, tool_result, confirmation_request, done, error)

GET /agent/sessions
  Returns list of conversation sessions for the authenticated user

POST /agent/sessions
  Creates a new conversation session

DELETE /agent/actions/{action_id}
  Reject a pending confirmation action
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict
from database import supabase
from middleware.auth import get_current_user_company
from lib.agent.engine import run_agent
from lib.agent.memory import create_session, list_sessions

router = APIRouter(prefix="/agent", tags=["Agent"])


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    confirm_action_id: Optional[str] = None  # Set to approve a pending action


@router.post("/chat")
async def agent_chat(body: ChatRequest, auth: Dict = Depends(get_current_user_company)):
    """
    Main agent chat endpoint. Returns a Server-Sent Events stream.
    Each event is a JSON object: data: {...}\n\n
    """
    company_id = auth["company_id"]
    user_id = auth["user_id"]
    role = auth.get("role", "user")

    # Create a session if none provided
    session_id = body.session_id
    if not session_id:
        session_id = create_session(company_id, user_id)

    async def event_stream():
        async for event in run_agent(
            message=body.message,
            session_id=session_id,
            company_id=company_id,
            user_id=user_id,
            role=role,
            confirm_action_id=body.confirm_action_id,
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions")
def get_sessions(auth: Dict = Depends(get_current_user_company)):
    """List recent conversation sessions for the authenticated user."""
    return list_sessions(auth["company_id"], auth["user_id"])


@router.post("/sessions")
def new_session(auth: Dict = Depends(get_current_user_company)):
    """Create a new conversation session."""
    session_id = create_session(auth["company_id"], auth["user_id"])
    return {"session_id": session_id}


@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: str, auth: Dict = Depends(get_current_user_company)):
    """Get full message history for a session."""
    company_id = auth["company_id"]
    row = supabase.table("ai_conversations")\
        .select("id, title, messages, created_at, updated_at")\
        .eq("id", session_id)\
        .eq("company_id", company_id)\
        .execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return row.data[0]


@router.delete("/actions/{action_id}")
def reject_action(action_id: str, auth: Dict = Depends(get_current_user_company)):
    """Reject a pending confirmation action."""
    company_id = auth["company_id"]
    row = supabase.table("agent_actions")\
        .update({"status": "rejected", "confirmed_by": auth["user_id"]})\
        .eq("id", action_id)\
        .eq("company_id", company_id)\
        .eq("status", "pending_confirmation")\
        .execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Action not found or already processed")
    return {"ok": True, "message": "Action rejected."}


@router.post("/embeddings/backfill")
def backfill_embeddings(auth: Dict = Depends(get_current_user_company)):
    """
    Backfill pgvector embeddings for all active accounts in the company.
    Run once after migration 026, and again after any CoA change.
    Requires OPENAI_API_KEY to be set.
    """
    from lib.agent.embeddings import backfill_org_embeddings
    count = backfill_org_embeddings(auth["company_id"])
    return {"ok": True, "accounts_updated": count}


@router.get("/actions/pending")
def list_pending_actions(auth: Dict = Depends(get_current_user_company)):
    """List all pending confirmation actions for the company."""
    rows = supabase.table("agent_actions")\
        .select("id, tool_name, arguments, created_at, session_id")\
        .eq("company_id", auth["company_id"])\
        .eq("status", "pending_confirmation")\
        .order("created_at", desc=True)\
        .execute().data or []
    return rows
