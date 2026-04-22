"""
Semantic entity resolver for accounts.
Uses pgvector cosine similarity with automatic fallback to fuzzy text matching
when embeddings are not yet backfilled or OPENAI_API_KEY is absent.

Resolution logic:
  score > 0.85 AND gap > 0.10  →  auto-resolve (return single confident match)
  score > 0.60 but ambiguous   →  return top-3 candidates for user to pick
  no score > 0.60              →  return "none" with a suggestion
"""

from dataclasses import dataclass
from typing import List, Optional, TypedDict, Literal
from database import supabase
from lib.agent.embeddings import embed_text

_AUTO_THRESHOLD = 0.70       # score above which we auto-resolve (no user confirmation)
_AUTO_GAP = 0.08            # min gap between top and second match to auto-resolve
_AMBIGUOUS_THRESHOLD = 0.40  # minimum score to surface as a candidate


@dataclass
class ResolvedEntity:
    id: str
    name: str
    score: float


class ResolveResult(TypedDict, total=False):
    status: Literal["resolved", "ambiguous", "none"]
    entity: Optional[ResolvedEntity]
    candidates: Optional[List[ResolvedEntity]]
    suggestion: Optional[str]


_FILLER = (
    # Verb phrases — always safe to strip
    "put it against", "record against", "debit to", "credit to",
    "charge to", "book to",
    # Standalone words — strip only when they're padding, not part of a proper name
    # NOTE: "accounts" and "expense(s)" intentionally excluded — they appear in proper
    # account names like "Accounts Receivable" and "Rent Expense".
    " account",  # "rent account" → "rent",  but "accounts receivable" unaffected
    "the ", "my ", "our ",
)


def _clean_query(reference: str) -> str:
    """Strip common filler phrases so 'the rent account' → 'rent'."""
    text = reference.lower().strip()
    for phrase in sorted(_FILLER, key=len, reverse=True):
        text = text.replace(phrase, " ")
    return " ".join(text.split()).strip() or reference.strip()


def resolve_account(company_id: str, reference: str) -> ResolveResult:
    """
    Match a natural-language account reference to a Chart of Accounts entry.

    Returns:
      { status: 'resolved', entity }     — confident single match
      { status: 'ambiguous', candidates } — multiple plausible matches
      { status: 'none', suggestion }      — no match above threshold
    """
    query = _clean_query(reference)
    vec = embed_text(query)
    if vec is None:
        return _fuzzy_resolve(company_id, reference)

    try:
        rows = supabase.rpc("match_accounts", {
            "query_embedding": vec,
            "company_id_filter": company_id,
            "match_count": 5,
        }).execute().data or []
    except Exception:
        return _fuzzy_resolve(company_id, query)

    if not rows:
        return _fuzzy_resolve(company_id, query)

    candidates = [
        ResolvedEntity(
            id=r["id"],
            name=r["account_name"],
            score=round(1.0 - float(r["distance"]), 4),
        )
        for r in rows
        if (1.0 - float(r["distance"])) >= _AMBIGUOUS_THRESHOLD
    ]

    if not candidates:
        return _fuzzy_resolve(company_id, query)

    top = candidates[0]
    gap = top.score - (candidates[1].score if len(candidates) > 1 else 0.0)

    if top.score >= _AUTO_THRESHOLD and gap >= _AUTO_GAP:
        return {"status": "resolved", "entity": top}

    return {"status": "ambiguous", "candidates": candidates[:3]}


def _fuzzy_resolve(company_id: str, name_or_code: str) -> ResolveResult:
    """Fallback when pgvector is unavailable. Uses exact then partial ilike matching."""
    stripped = name_or_code.strip()

    r = supabase.table("accounts").select("id, account_name")\
        .eq("company_id", company_id).eq("account_code", stripped).execute()
    if r.data:
        return {"status": "resolved", "entity": ResolvedEntity(r.data[0]["id"], r.data[0]["account_name"], 1.0)}

    r = supabase.table("accounts").select("id, account_name")\
        .eq("company_id", company_id).ilike("account_name", stripped).execute()
    if r.data:
        return {"status": "resolved", "entity": ResolvedEntity(r.data[0]["id"], r.data[0]["account_name"], 1.0)}

    r = supabase.table("accounts").select("id, account_name")\
        .eq("company_id", company_id).ilike("account_name", f"%{stripped}%").execute()
    if not r.data:
        return {"status": "none", "suggestion": "Account not found. Tell me the exact account name or code."}

    entities = [ResolvedEntity(x["id"], x["account_name"], 0.70) for x in r.data[:3]]
    if len(entities) == 1:
        return {"status": "resolved", "entity": entities[0]}
    return {"status": "ambiguous", "candidates": entities}
