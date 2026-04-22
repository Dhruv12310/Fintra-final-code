"""
OpenAI text-embedding-3-small wrapper for semantic account/contact matching.
Requires OPENAI_API_KEY. Falls back gracefully when not set.
"""

import os
from typing import List, Optional
from database import supabase

_MODEL = "text-embedding-3-small"
_DIM = 1536


def embed_text(text: str) -> Optional[List[float]]:
    """
    Embed a string with text-embedding-3-small.
    Returns a 1536-dim float vector, or None if OPENAI_API_KEY is not set.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    from openai import OpenAI
    try:
        resp = OpenAI(api_key=api_key).embeddings.create(
            model=_MODEL,
            input=text.strip(),
            dimensions=_DIM,
        )
        return resp.data[0].embedding
    except Exception:
        return None


def backfill_org_embeddings(company_id: str) -> int:
    """
    Embed all active accounts for an org and persist to the embedding column.
    Returns the number of accounts updated.

    Call this on org creation and after any CoA mutation (account add/rename/deactivate).
    The embedding combines code + name + type for richer semantic matching.
    """
    accounts = supabase.table("accounts")\
        .select("id, account_code, account_name, account_type, account_subtype")\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .execute().data or []

    updated = 0
    for acc in accounts:
        # Embed only the account name — code/type/subtype add noise that dilutes
        # semantic similarity and pulls all vectors toward a generic "accounting" centroid.
        text = acc.get("account_name", "").strip()
        if not text:
            continue
        vec = embed_text(text)
        if vec:
            supabase.table("accounts")\
                .update({"embedding": vec})\
                .eq("id", acc["id"])\
                .execute()
            updated += 1

    return updated
