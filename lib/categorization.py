"""
Categorization rule engine for bank transactions.

Priority order:
  1. Company-specific rules (learned from user corrections) — deterministic, instant
  2. OpenAI — AI inference with COA context
  3. None — no suggestion (confidence too low)

When a user corrects a suggestion, call learn_from_correction() to upsert a rule
so the same transaction type is auto-handled next time.
"""

import os
import json
from typing import Optional, Dict, Any, List
from database import supabase


# ── Rule matching ──────────────────────────────────────────────────

def match_rule(company_id: str, txn: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Check categorization_rules for a matching rule.
    Returns { account_id, rule_id } or None.
    """
    name = (txn.get("name") or "").lower()
    merchant = (txn.get("merchant_name") or "").lower()
    amount = float(txn.get("amount") or 0)
    is_outflow = (txn.get("raw") or {}).get("is_outflow", True)
    direction = "out" if is_outflow else "in"

    rules = supabase.table("categorization_rules")\
        .select("id, account_id, vendor_pattern, merchant_name_pattern, description_contains, amount_min, amount_max, direction")\
        .eq("company_id", company_id)\
        .execute().data or []

    for rule in rules:
        # Direction check
        rule_dir = rule.get("direction", "both")
        if rule_dir != "both" and rule_dir != direction:
            continue

        # Amount range check
        if rule.get("amount_min") is not None and amount < float(rule["amount_min"]):
            continue
        if rule.get("amount_max") is not None and amount > float(rule["amount_max"]):
            continue

        # Pattern matching — any one pattern match is enough
        matched = False
        if rule.get("vendor_pattern") and rule["vendor_pattern"].lower() in name:
            matched = True
        if rule.get("merchant_name_pattern") and rule["merchant_name_pattern"].lower() in merchant:
            matched = True
        if rule.get("description_contains") and rule["description_contains"].lower() in name:
            matched = True

        if matched:
            # Bump hit_count
            supabase.table("categorization_rules").update({
                "hit_count": (rule.get("hit_count") or 1) + 1,
                "last_matched_at": "now()",
            }).eq("id", rule["id"]).execute()
            return {"account_id": rule["account_id"], "rule_id": rule["id"], "confidence": 1.0}

    return None


# ── OpenAI inference ───────────────────────────────────────────────

async def infer_category_openai(
    company_id: str,
    txn: Dict[str, Any],
    accounts: List[Dict[str, Any]],
    historical: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """
    Call OpenAI to suggest an account for a transaction.
    Returns { account_id, confidence, reasoning } or None.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key or openai_key.startswith("sk-your"):
        return None

    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=openai_key)

    # Build concise COA list
    coa_lines = [
        f"{a['account_code']}: {a['account_name']} ({a['account_type']})"
        for a in accounts[:80]  # cap at 80 to keep prompt tight
    ]
    coa_text = "\n".join(coa_lines)

    # Build a few historical examples for in-context learning
    examples = []
    for h in historical[:10]:
        examples.append(
            f"  \"{h['name']}\" → {h['account_code']}: {h['account_name']}"
        )
    examples_text = "\n".join(examples) if examples else "  (none yet)"

    is_outflow = (txn.get("raw") or {}).get("is_outflow", True)
    direction = "outflow (expense/payment)" if is_outflow else "inflow (income/receipt)"

    prompt = f"""You are an accounting assistant. Categorize this bank transaction to the most appropriate GL account.

Transaction:
  Name: {txn.get('name', '')}
  Merchant: {txn.get('merchant_name', '')}
  Amount: ${float(txn.get('amount', 0)):,.2f}
  Direction: {direction}
  Date: {txn.get('posted_date', '')}

Chart of Accounts:
{coa_text}

Recent categorization examples from this company:
{examples_text}

Respond with JSON only:
{{
  "account_code": "the account code from the COA above",
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence explanation"
}}"""

    try:
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=150,
        )
        data = json.loads(resp.choices[0].message.content)
        account_code = data.get("account_code", "").strip()

        # Look up account_id from code
        match = next((a for a in accounts if a.get("account_code") == account_code), None)
        if not match:
            # Try partial code match
            match = next((a for a in accounts if account_code in a.get("account_code", "")), None)

        if not match:
            return None

        return {
            "account_id": match["id"],
            "account_code": match["account_code"],
            "account_name": match["account_name"],
            "confidence": float(data.get("confidence", 0.5)),
            "reasoning": data.get("reasoning", ""),
        }
    except Exception:
        return None


# ── Main entry point ───────────────────────────────────────────────

async def categorize_transaction(
    company_id: str,
    txn: Dict[str, Any],
    accounts: Optional[List[Dict[str, Any]]] = None,
    historical: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Categorize a single transaction. Returns suggestion dict or None.
    Result: { account_id, account_name, account_code, confidence, source: 'rule'|'ai', reasoning }
    """
    # 1. Rule match (instant, deterministic)
    rule_match = match_rule(company_id, txn)
    if rule_match:
        # Enrich with account details
        acc = supabase.table("accounts")\
            .select("account_code, account_name")\
            .eq("id", rule_match["account_id"])\
            .single().execute()
        acc_data = acc.data or {}
        return {
            "account_id": rule_match["account_id"],
            "account_code": acc_data.get("account_code", ""),
            "account_name": acc_data.get("account_name", ""),
            "confidence": 1.0,
            "source": "rule",
            "reasoning": "Matched a saved categorization rule",
        }

    # 2. AI inference
    if accounts is None:
        accounts = supabase.table("accounts")\
            .select("id, account_code, account_name, account_type, account_subtype")\
            .eq("company_id", company_id)\
            .eq("is_active", True)\
            .execute().data or []

    if historical is None:
        historical = _load_historical(company_id)

    ai_result = await infer_category_openai(company_id, txn, accounts, historical)
    if ai_result:
        ai_result["source"] = "ai"
        return ai_result

    return None


def _load_historical(company_id: str, limit: int = 30) -> List[Dict[str, Any]]:
    """Load recently user-corrected transactions as few-shot examples."""
    rows = supabase.table("bank_transactions")\
        .select("name, merchant_name, user_selected_account_id, accounts!user_selected_account_id(account_code, account_name)")\
        .eq("company_id", company_id)\
        .not_.is_("user_selected_account_id", "null")\
        .order("updated_at", desc=True)\
        .limit(limit)\
        .execute().data or []

    examples = []
    for r in rows:
        acc = r.get("accounts") or {}
        if acc:
            examples.append({
                "name": r.get("name", ""),
                "account_code": acc.get("account_code", ""),
                "account_name": acc.get("account_name", ""),
            })
    return examples


# ── Learning from corrections ──────────────────────────────────────

def learn_from_correction(
    company_id: str,
    txn: Dict[str, Any],
    correct_account_id: str,
    user_id: Optional[str] = None,
):
    """
    Called when a user overrides a suggestion. Upserts a categorization rule
    so the same transaction type gets auto-handled next time.
    """
    name = (txn.get("name") or "").strip()
    merchant = (txn.get("merchant_name") or "").strip()

    if not name and not merchant:
        return  # Nothing to learn from

    # Check if a rule already exists for this pattern
    pattern = merchant or name
    existing = supabase.table("categorization_rules")\
        .select("id, hit_count")\
        .eq("company_id", company_id)\
        .eq("account_id", correct_account_id)\
        .or_(f"vendor_pattern.ilike.%{pattern}%,merchant_name_pattern.ilike.%{pattern}%")\
        .execute().data or []

    if existing:
        # Bump hit count on existing rule
        supabase.table("categorization_rules").update({
            "hit_count": existing[0].get("hit_count", 1) + 1,
            "account_id": correct_account_id,
        }).eq("id", existing[0]["id"]).execute()
    else:
        # Create new rule
        rule_data: Dict[str, Any] = {
            "company_id": company_id,
            "account_id": correct_account_id,
            "hit_count": 1,
            "created_by": user_id,
        }
        if merchant:
            rule_data["merchant_name_pattern"] = merchant.lower()
        else:
            rule_data["vendor_pattern"] = name[:40].lower()  # cap to avoid overly-specific patterns

        supabase.table("categorization_rules").insert(rule_data).execute()
