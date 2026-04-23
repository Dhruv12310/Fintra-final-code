"""
Banking: Plaid Link, token exchange, transaction sync, categorize, post to journal.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, List
from datetime import date, datetime
from database import supabase
from middleware.auth import get_current_user_company, require_min_role
from lib.crypto import encrypt_token, decrypt_token
import os


def _plaid_get(obj, key, default=None):
    """
    Safe accessor for plaid-python v14+ response objects.
    Supports both dict-style (obj["key"]) and attribute-style (obj.key) access.
    """
    if obj is None:
        return default
    if hasattr(obj, "__getitem__"):
        try:
            val = obj[key]
            return default if val is None else val
        except (KeyError, TypeError, IndexError):
            pass
    val = getattr(obj, key, None)
    return default if val is None else val


def _plaid_str(val, default="") -> str:
    """
    Convert a Plaid enum/value to a plain lowercase string.
    plaid-python v14 enums have __str__ like "AccountType.depository" — strip the class prefix.
    """
    if val is None:
        return default
    s = str(val)
    return s.split(".")[-1].lower() if "." in s else s.lower()

router = APIRouter(prefix="/bank", tags=["Banking"])


# ── Auto-categorization REST endpoint (used by banking UI + agent) ──

@router.post("/transactions/auto-categorize")
async def auto_categorize(
    body: dict = {},
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    """
    Run AI + rule-based categorization on all unreviewed transactions.
    Returns summary counts + per-transaction results.
    """
    from lib.categorization import categorize_transaction, _load_historical

    company_id = auth["company_id"]
    bank_account_id = body.get("bank_account_id")
    limit = int(body.get("limit", 100))

    q = supabase.table("bank_transactions")\
        .select("id, name, merchant_name, amount, posted_date, raw")\
        .eq("company_id", company_id)\
        .eq("status", "unreviewed")\
        .is_("user_selected_account_id", "null")\
        .order("posted_date", desc=True)\
        .limit(limit)
    if bank_account_id:
        q = q.eq("bank_account_id", bank_account_id)
    txns = q.execute().data or []

    if not txns:
        return {"total": 0, "auto_applied": 0, "suggested": 0, "skipped": 0, "results": []}

    accounts = supabase.table("accounts")\
        .select("id, account_code, account_name, account_type")\
        .eq("company_id", company_id).eq("is_active", True)\
        .execute().data or []
    historical = _load_historical(company_id)

    results = []
    auto_applied = suggested = skipped = 0

    for txn in txns:
        res = await categorize_transaction(company_id, txn, accounts, historical)
        if not res:
            skipped += 1
            results.append({"txn_id": txn["id"], "status": "skipped"})
            continue

        confidence = res.get("confidence", 0)
        supabase.table("bank_transactions").update({
            "suggested_account_id": res["account_id"],
        }).eq("id", txn["id"]).execute()

        if confidence >= 0.85:
            auto_applied += 1
            status = "auto_applied"
        else:
            suggested += 1
            status = "suggested"

        results.append({
            "txn_id": txn["id"],
            "name": txn.get("name"),
            "account_id": res["account_id"],
            "account_name": res.get("account_name"),
            "confidence": round(confidence, 2),
            "source": res.get("source"),
            "reasoning": res.get("reasoning"),
            "status": status,
        })

    return {
        "total": len(txns),
        "auto_applied": auto_applied,
        "suggested": suggested,
        "skipped": skipped,
        "results": results,
    }


@router.post("/transactions/{txn_id}/accept-suggestion")
def accept_suggestion(
    txn_id: str,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    """Accept AI suggestion for a transaction → moves to user_selected + learns rule."""
    from lib.categorization import learn_from_correction
    company_id = auth["company_id"]
    user_id = auth["user_id"]

    txn = supabase.table("bank_transactions")\
        .select("id, name, merchant_name, suggested_account_id")\
        .eq("id", txn_id).eq("company_id", company_id)\
        .single().execute()
    if not txn.data or not txn.data.get("suggested_account_id"):
        raise HTTPException(status_code=400, detail="No suggestion to accept")

    account_id = txn.data["suggested_account_id"]
    supabase.table("bank_transactions").update({
        "user_selected_account_id": account_id,
    }).eq("id", txn_id).execute()

    learn_from_correction(company_id, txn.data, account_id, user_id)
    return {"ok": True}


@router.post("/transactions/{txn_id}/reject-suggestion")
def reject_suggestion(
    txn_id: str,
    body: dict = {},
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    """Reject AI suggestion and optionally provide the correct account (learns rule)."""
    from lib.categorization import learn_from_correction
    company_id = auth["company_id"]
    user_id = auth["user_id"]

    correct_account_id = body.get("correct_account_id")

    txn = supabase.table("bank_transactions")\
        .select("id, name, merchant_name")\
        .eq("id", txn_id).eq("company_id", company_id)\
        .single().execute()
    if not txn.data:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Clear the suggestion
    supabase.table("bank_transactions").update({
        "suggested_account_id": None,
    }).eq("id", txn_id).execute()

    # If user provided the correct account, learn from it
    if correct_account_id:
        supabase.table("bank_transactions").update({
            "user_selected_account_id": correct_account_id,
        }).eq("id", txn_id).execute()
        learn_from_correction(company_id, txn.data, correct_account_id, user_id)

    return {"ok": True}

# ── Plaid client setup ─────────────────────────────────────────────

def _plaid_client():
    try:
        from plaid.api import plaid_api
        from plaid.configuration import Configuration
        from plaid.api_client import ApiClient

        env = os.getenv("PLAID_ENV", "sandbox")
        env_map = {
            "sandbox": "https://sandbox.plaid.com",
            "development": "https://development.plaid.com",
            "production": "https://production.plaid.com",
        }
        config = Configuration(
            host=env_map.get(env, "https://sandbox.plaid.com"),
            api_key={
                "clientId": os.getenv("PLAID_CLIENT_ID", ""),
                "secret": os.getenv("PLAID_SECRET", ""),
            },
        )
        return plaid_api.PlaidApi(ApiClient(config))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Plaid client init failed: {e}")


# ── Plaid: Link Token ──────────────────────────────────────────────

@router.post("/plaid/link-token")
def create_link_token(auth: Dict[str, str] = Depends(get_current_user_company)):
    from plaid.model.link_token_create_request import LinkTokenCreateRequest
    from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
    from plaid.model.products import Products
    from plaid.model.country_code import CountryCode

    client = _plaid_client()
    user_id = auth["user_id"]
    try:
        request = LinkTokenCreateRequest(
            user=LinkTokenCreateRequestUser(client_user_id=user_id),
            client_name="Fintra Finance OS",
            products=[Products("transactions"), Products("auth")],
            country_codes=[CountryCode("US")],
            language="en",
        )
        response = client.link_token_create(request)
        return {"link_token": response["link_token"]}
    except Exception as e:
        import json
        try:
            body = json.loads(e.body) if hasattr(e, "body") else {}
            msg = body.get("error_message") or body.get("display_message") or str(e)
        except Exception:
            msg = str(e)
        raise HTTPException(status_code=400, detail=msg)


# ── Plaid: Exchange Token + Import Accounts ────────────────────────

class ExchangeTokenBody(BaseModel):
    public_token: str
    institution_name: str
    institution_id: Optional[str] = None
    account_ids: Optional[List[str]] = None  # Plaid account IDs selected by user


@router.post("/plaid/exchange-token")
def exchange_token(body: ExchangeTokenBody, auth: Dict[str, str] = Depends(get_current_user_company)):
    from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
    from plaid.model.accounts_get_request import AccountsGetRequest

    client = _plaid_client()
    company_id = auth["company_id"]
    user_id = auth["user_id"]

    # 1. Exchange public token for access token
    try:
        exchange_resp = client.item_public_token_exchange(
            ItemPublicTokenExchangeRequest(public_token=body.public_token)
        )
        access_token = exchange_resp["access_token"]
        item_id = exchange_resp["item_id"]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {e}")

    # 2. Save connection to DB (access token encrypted at rest)
    try:
        conn_row = supabase.table("bank_connections").insert({
            "company_id": company_id,
            "user_id": user_id,
            "provider": "plaid",
            "provider_item_id": item_id,
            "provider_access_token": encrypt_token(access_token),
            "institution_name": body.institution_name,
            "status": "active",
        }).execute().data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to save bank connection: {e}")
    if not conn_row:
        raise HTTPException(status_code=400, detail="Failed to save bank connection (empty response)")
    connection_id = conn_row[0]["id"]

    # 3. Pull accounts from Plaid
    try:
        accts_resp = client.accounts_get(AccountsGetRequest(access_token=access_token))
        plaid_accounts = _plaid_get(accts_resp, "accounts", []) or []
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch accounts from Plaid: {e}")

    # 4. Save each Plaid account as bank_account
    created_accounts = []
    for acct in plaid_accounts:
        acct_account_id = _plaid_get(acct, "account_id")
        if body.account_ids and acct_account_id not in body.account_ids:
            continue

        balances = _plaid_get(acct, "balances") or {}
        bal_current = _plaid_get(balances, "current")
        bal_available = _plaid_get(balances, "available")
        acct_type = _plaid_str(_plaid_get(acct, "type", "depository"), "depository")
        acct_subtype = _plaid_str(_plaid_get(acct, "subtype", ""), "")

        insert_data = {
            "company_id": company_id,
            "connection_id": connection_id,
            "provider_account_id": acct_account_id,
            "name": _plaid_get(acct, "name", "Account"),
            "mask": _plaid_get(acct, "mask"),
            "type": _map_account_type(acct_type),
            "is_active": True,
        }
        # Include optional columns only if they exist in the table (migration 008)
        try:
            insert_data["account_subtype"] = acct_subtype
            insert_data["institution_name"] = body.institution_name
            insert_data["balance_current"] = float(bal_current or 0)
            if bal_available is not None:
                insert_data["balance_available"] = float(bal_available)
        except Exception:
            pass

        try:
            row = supabase.table("bank_accounts").insert(insert_data).execute().data
        except Exception:
            # If insert fails due to missing columns (migration 008 not yet run),
            # retry without the optional columns
            minimal_data = {k: v for k, v in insert_data.items()
                            if k not in ("account_subtype", "institution_name", "balance_current", "balance_available")}
            try:
                row = supabase.table("bank_accounts").insert(minimal_data).execute().data
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to save bank account: {e}")

        if row:
            created_accounts.append(row[0])

    # 5. Trigger initial transaction sync (non-blocking — sync failure must not prevent connection)
    try:
        _sync_transactions(connection_id, access_token, company_id)
    except Exception:
        pass  # Sync errors are non-fatal; account is already saved

    return {
        "connection_id": connection_id,
        "accounts": created_accounts,
        "institution_name": body.institution_name,
    }


def _map_account_type(plaid_type: str) -> str:
    mapping = {
        "depository": "checking",
        "credit": "credit_card",
        "loan": "loan",
        "investment": "investment",
        "other": "other",
    }
    return mapping.get(plaid_type, "checking")


# ── Plaid: Sync Transactions ───────────────────────────────────────

def _sync_transactions(connection_id: str, access_token: str, company_id: str):
    from plaid.model.transactions_sync_request import TransactionsSyncRequest

    client = _plaid_client()

    # Get current cursor from DB (sync_cursor column added by migration 008 — may not exist yet)
    cursor = None
    try:
        conn = supabase.table("bank_connections").select("sync_cursor").eq("id", connection_id).single().execute()
        cursor = conn.data.get("sync_cursor") if conn.data else None
    except Exception:
        cursor = None

    # Get bank_accounts for this connection (to map provider_account_id → our id)
    ba_rows = supabase.table("bank_accounts").select("id, provider_account_id").eq("connection_id", connection_id).execute().data or []
    acct_map = {ba["provider_account_id"]: ba["id"] for ba in ba_rows}

    added_count = 0
    has_more = True

    while has_more:
        req_params = {"access_token": access_token}
        if cursor:
            req_params["cursor"] = cursor

        try:
            resp = client.transactions_sync(TransactionsSyncRequest(**req_params))
        except Exception:
            break

        # Process added transactions
        for txn in _plaid_get(resp, "added", []):
            ba_id = acct_map.get(_plaid_get(txn, "account_id"))
            if not ba_id:
                continue
            prov_id = _plaid_get(txn, "transaction_id")
            amount = float(_plaid_get(txn, "amount") or 0)  # Plaid: positive = debit/outflow
            row_data = {
                "company_id": company_id,
                "bank_account_id": ba_id,
                "provider_transaction_id": prov_id,
                "posted_date": str(_plaid_get(txn, "date") or date.today()),
                "name": _plaid_get(txn, "name", "Transaction"),
                "merchant_name": _plaid_get(txn, "merchant_name"),
                "amount": abs(amount),
                "pending": bool(_plaid_get(txn, "pending", False)),
                "status": "unreviewed",
                "raw": {
                    "plaid_amount": amount,
                    "is_outflow": amount > 0,
                    "category": _plaid_get(txn, "category") or [],
                    "payment_channel": _plaid_get(txn, "payment_channel"),
                },
            }
            try:
                supabase.table("bank_transactions").upsert(row_data, on_conflict="company_id,provider_transaction_id").execute()
                added_count += 1
            except Exception:
                pass

        # Process modified
        for txn in _plaid_get(resp, "modified", []):
            prov_id = _plaid_get(txn, "transaction_id")
            amount = float(_plaid_get(txn, "amount") or 0)
            try:
                supabase.table("bank_transactions").update({
                    "name": _plaid_get(txn, "name", "Transaction"),
                    "merchant_name": _plaid_get(txn, "merchant_name"),
                    "amount": abs(amount),
                    "pending": bool(_plaid_get(txn, "pending", False)),
                    "raw": {
                        "plaid_amount": amount,
                        "is_outflow": amount > 0,
                        "category": _plaid_get(txn, "category") or [],
                    },
                }).eq("provider_transaction_id", prov_id).eq("company_id", company_id).execute()
            except Exception:
                pass

        # Process removed
        for txn in _plaid_get(resp, "removed", []):
            prov_id = _plaid_get(txn, "transaction_id")
            try:
                supabase.table("bank_transactions").delete().eq("provider_transaction_id", prov_id).eq("company_id", company_id).execute()
            except Exception:
                pass

        cursor = _plaid_get(resp, "next_cursor")
        has_more = bool(_plaid_get(resp, "has_more", False))

    # Save updated cursor (only if sync_cursor column exists — migration 008)
    try:
        supabase.table("bank_connections").update({
            "sync_cursor": cursor,
            "last_sync_at": datetime.utcnow().isoformat(),
        }).eq("id", connection_id).execute()
    except Exception:
        # sync_cursor column may not exist yet; update last_sync_at only
        try:
            supabase.table("bank_connections").update({
                "last_sync_at": datetime.utcnow().isoformat(),
            }).eq("id", connection_id).execute()
        except Exception:
            pass

    return added_count


@router.post("/plaid/sync/{connection_id}")
def sync_connection(connection_id: str, auth: Dict[str, str] = Depends(get_current_user_company)):
    company_id = auth["company_id"]
    conn = supabase.table("bank_connections").select("provider_access_token, status").eq("id", connection_id).eq("company_id", company_id).single().execute()
    if not conn.data:
        raise HTTPException(status_code=404, detail="Connection not found")
    raw_token = conn.data.get("provider_access_token")
    if not raw_token:
        raise HTTPException(status_code=400, detail="No access token for this connection")
    access_token = decrypt_token(raw_token)
    count = _sync_transactions(connection_id, access_token, company_id)

    # Also refresh balances
    _refresh_balances(connection_id, access_token, company_id)

    return {"synced": count}


def _refresh_balances(connection_id: str, access_token: str, company_id: str):
    from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest
    client = _plaid_client()
    try:
        resp = client.accounts_balance_get(AccountsBalanceGetRequest(access_token=access_token))
        for acct in _plaid_get(resp, "accounts", []):
            balances = _plaid_get(acct, "balances") or {}
            bal_current = _plaid_get(balances, "current")
            bal_available = _plaid_get(balances, "available")
            update_data = {
                "balance_current": float(bal_current or 0),
                "balance_available": float(bal_available) if bal_available is not None else None,
            }
            try:
                supabase.table("bank_accounts").update(update_data).eq(
                    "provider_account_id", _plaid_get(acct, "account_id")
                ).eq("company_id", company_id).execute()
            except Exception:
                pass
    except Exception:
        pass


# ── Connections ────────────────────────────────────────────────────

@router.get("/connections")
def list_connections(auth: Dict[str, str] = Depends(get_current_user_company)):
    cid = auth["company_id"]
    rows = supabase.table("bank_connections").select("id, institution_name, status, last_sync_at, created_at").eq("company_id", cid).execute().data or []
    return rows


@router.delete("/connections/{connection_id}")
def disconnect_connection(connection_id: str, auth: Dict[str, str] = Depends(get_current_user_company)):
    from plaid.model.item_remove_request import ItemRemoveRequest
    company_id = auth["company_id"]

    conn = supabase.table("bank_connections").select("provider_access_token, provider_item_id").eq("id", connection_id).eq("company_id", company_id).single().execute()
    if not conn.data:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Remove from Plaid
    try:
        client = _plaid_client()
        client.item_remove(ItemRemoveRequest(access_token=decrypt_token(conn.data["provider_access_token"])))
    except Exception:
        pass  # still remove from DB even if Plaid call fails

    supabase.table("bank_connections").delete().eq("id", connection_id).eq("company_id", company_id).execute()
    return {"ok": True}


# ── Bank Accounts ──────────────────────────────────────────────────

@router.get("/accounts")
def list_bank_accounts(auth: Dict[str, str] = Depends(get_current_user_company)):
    cid = auth["company_id"]
    rows = supabase.table("bank_accounts").select(
        "*, accounts(id, account_code, account_name)"
    ).eq("company_id", cid).eq("is_active", True).execute().data or []

    # Attach pending counts
    for row in rows:
        count_res = supabase.table("bank_transactions").select("id", count="exact").eq("bank_account_id", row["id"]).eq("status", "unreviewed").execute()
        row["pending_count"] = count_res.count or 0
    return rows


@router.patch("/accounts/{account_id}")
def update_bank_account(account_id: str, body: dict, auth: Dict[str, str] = Depends(get_current_user_company)):
    cid = auth["company_id"]
    allowed = {"name", "linked_account_id", "is_active"}
    data = {k: v for k, v in body.items() if k in allowed}
    if not data:
        raise HTTPException(status_code=400, detail="No valid fields")
    row = supabase.table("bank_accounts").update(data).eq("id", account_id).eq("company_id", cid).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Bank account not found")
    return row.data[0]


# ── Bank Transactions ──────────────────────────────────────────────

@router.get("/transactions")
def list_transactions(
    bank_account_id: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    cid = auth["company_id"]
    q = supabase.table("bank_transactions").select(
        "*, bank_accounts(id, name, mask, type, institution_name)"
    ).eq("company_id", cid)

    if bank_account_id:
        q = q.eq("bank_account_id", bank_account_id)
    if status:
        # pending = unreviewed + pending=true; posted = reviewed/matched; excluded = excluded
        if status == "pending":
            q = q.in_("status", ["unreviewed"])
        elif status == "posted":
            q = q.in_("status", ["reviewed", "matched"])
        elif status == "excluded":
            q = q.eq("status", "excluded")
        else:
            q = q.eq("status", status)
    if search:
        q = q.ilike("name", f"%{search}%")
    if date_from:
        q = q.gte("posted_date", date_from)
    if date_to:
        q = q.lte("posted_date", date_to)

    result = q.order("posted_date", desc=True).range(offset, offset + limit - 1).execute()
    rows = result.data or []

    # Enrich with is_outflow from raw
    for row in rows:
        raw = row.get("raw") or {}
        row["is_outflow"] = raw.get("is_outflow", True)
        row["plaid_category"] = raw.get("category", [])

    return {"transactions": rows, "total": len(rows)}


@router.patch("/transactions/{txn_id}")
def update_transaction(txn_id: str, body: dict, auth: Dict[str, str] = Depends(get_current_user_company)):
    cid = auth["company_id"]
    allowed = {"user_selected_account_id", "memo", "status", "suggested_account_id"}
    data = {k: v for k, v in body.items() if k in allowed}
    if not data:
        raise HTTPException(status_code=400, detail="No valid fields")
    row = supabase.table("bank_transactions").update(data).eq("id", txn_id).eq("company_id", cid).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return row.data[0]


@router.post("/transactions/{txn_id}/exclude")
def exclude_transaction(txn_id: str, auth: Dict[str, str] = Depends(get_current_user_company)):
    cid = auth["company_id"]
    row = supabase.table("bank_transactions").update({"status": "excluded"}).eq("id", txn_id).eq("company_id", cid).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return row.data[0]


@router.post("/transactions/{txn_id}/undo-exclude")
def undo_exclude(txn_id: str, auth: Dict[str, str] = Depends(get_current_user_company)):
    cid = auth["company_id"]
    row = supabase.table("bank_transactions").update({"status": "unreviewed"}).eq("id", txn_id).eq("company_id", cid).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return row.data[0]


class PostTransactionBody(BaseModel):
    account_id: str          # GL account to post against (debit or credit)
    bank_gl_id: Optional[str] = None  # override / set bank's GL account
    memo: Optional[str] = None
    entry_date: Optional[str] = None


@router.post("/transactions/{txn_id}/post")
def post_transaction(txn_id: str, body: PostTransactionBody, auth: Dict[str, str] = Depends(get_current_user_company)):
    """Create a journal entry from a bank transaction and mark it as reviewed."""
    import traceback
    cid = auth["company_id"]
    user_id = auth["user_id"]

    try:
        return _do_post_transaction(txn_id, body, cid, user_id)
    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc()
        print(f"POST TRANSACTION ERROR:\n{tb}")
        raise HTTPException(status_code=400, detail=str(e))


def _do_post_transaction(txn_id: str, body: PostTransactionBody, cid: str, user_id: str):
    # Load transaction
    txn = supabase.table("bank_transactions").select(
        "*, bank_accounts(id, linked_account_id, name, mask)"
    ).eq("id", txn_id).eq("company_id", cid).single().execute()
    if not txn.data:
        raise HTTPException(status_code=404, detail="Transaction not found")
    t = txn.data
    ba = t.get("bank_accounts") or {}

    # Determine GL account for the bank side
    bank_gl_id = body.bank_gl_id or ba.get("linked_account_id")
    if not bank_gl_id:
        raise HTTPException(status_code=400, detail="Select a bank GL account to post this transaction.")

    # If a new bank_gl_id was provided, save it to the bank account for future transactions
    if body.bank_gl_id and ba.get("id"):
        supabase.table("bank_accounts").update({"linked_account_id": body.bank_gl_id}).eq("id", ba["id"]).execute()

    amount = float(t["amount"])
    is_outflow = (t.get("raw") or {}).get("is_outflow", True)
    entry_date = body.entry_date or t["posted_date"]
    memo = body.memo or t.get("memo") or t["name"]

    # Build journal lines
    # Outflow (expense): Debit expense account, Credit bank
    # Inflow (revenue): Debit bank, Credit revenue/income account
    if is_outflow:
        lines = [
            {"account_id": body.account_id, "debit": amount, "credit": 0, "memo": memo},
            {"account_id": bank_gl_id, "debit": 0, "credit": amount, "memo": memo},
        ]
    else:
        lines = [
            {"account_id": bank_gl_id, "debit": amount, "credit": 0, "memo": memo},
            {"account_id": body.account_id, "debit": 0, "credit": amount, "memo": memo},
        ]

    # Generate journal number
    count_res = supabase.table("journal_entries").select("id", count="exact").eq("company_id", cid).execute()
    je_number = f"JE-{(count_res.count or 0) + 1:04d}"

    # Create journal entry as draft first (trigger blocks lines on posted JEs)
    je = supabase.table("journal_entries").insert({
        "company_id": cid,
        "journal_number": je_number,
        "entry_date": entry_date,
        "memo": memo,
        "status": "draft",
        "source": "bank",
    }).execute()
    if not je.data:
        raise HTTPException(status_code=400, detail="Failed to create journal entry")
    je_id = je.data[0]["id"]

    # Insert lines while entry is still draft
    for i, line in enumerate(lines, start=1):
        try:
            supabase.table("journal_lines").insert({
                "journal_entry_id": je_id,
                "line_number": i,
                "account_id": line["account_id"],
                "debit": line["debit"],
                "credit": line["credit"],
                "description": line.get("memo", ""),
            }).execute()
        except Exception as le:
            raise HTTPException(status_code=400, detail=f"Failed to insert journal line: {le}")

    # Now post the entry (triggers balance updates)
    supabase.table("journal_entries").update({"status": "posted"}).eq("id", je_id).execute()

    # Mark transaction as reviewed + store match
    supabase.table("bank_transactions").update({
        "status": "reviewed",
        "user_selected_account_id": body.account_id,
    }).eq("id", txn_id).execute()

    # Record match (table may not exist yet if migration 008 hasn't run)
    try:
        supabase.table("bank_transaction_matches").upsert({
            "bank_transaction_id": txn_id,
            "journal_entry_id": je_id,
            "matched_by": user_id,
            "match_type": "created",
        }, on_conflict="bank_transaction_id").execute()
    except Exception:
        pass

    return {"journal_entry_id": je_id, "journal_number": je_number}


# ── GL Accounts list (for categorization dropdown) ─────────────────

@router.get("/gl-accounts")
def get_gl_accounts(auth: Dict[str, str] = Depends(get_current_user_company)):
    """Return all GL accounts suitable for categorizing bank transactions."""
    cid = auth["company_id"]
    rows = supabase.table("accounts").select(
        "id, account_code, account_name, account_type, account_subtype"
    ).eq("company_id", cid).order("account_code").execute().data or []
    return rows


# ---------------------------------------------------------------------------
# Reconciliation matching: pair bank transactions with invoices, bills,
# payments, or bill payments. Score by (amount match, date proximity).
# ---------------------------------------------------------------------------

from datetime import date as _date, timedelta

def _abs_date_days(a: str, b: str) -> int:
    da = _date.fromisoformat(a[:10])
    db = _date.fromisoformat(b[:10])
    return abs((da - db).days)


def _score_candidate(txn_amount: float, txn_date: str, cand_amount: float, cand_date: str, days_window: int) -> float:
    amt_diff = abs(abs(txn_amount) - abs(cand_amount))
    if amt_diff > 0.01:
        return 0.0
    days_off = _abs_date_days(txn_date, cand_date)
    if days_off > days_window:
        return 0.0
    # 1.0 for same day, decaying linearly to ~0.5 at days_window.
    return round(1.0 - (days_off / (2 * max(1, days_window))), 4)


@router.get("/transactions/{txn_id}/match-candidates")
def match_candidates(
    txn_id: str,
    days_window: int = 5,
    auth: Dict[str, str] = Depends(get_current_user_company),
):
    """Suggest invoices, bills, payments, or bill payments that could match
    this bank transaction. Ranked by score (1.0 = same day exact amount)."""
    cid = auth["company_id"]
    txn = supabase.table("bank_transactions").select("*")\
        .eq("id", txn_id).eq("company_id", cid).single().execute().data
    if not txn:
        raise HTTPException(status_code=404, detail="Bank transaction not found")

    txn_amount = float(txn["amount"])
    txn_date = txn["posted_date"]
    start = (_date.fromisoformat(txn_date) - timedelta(days=days_window)).isoformat()
    end = (_date.fromisoformat(txn_date) + timedelta(days=days_window)).isoformat()

    candidates: list = []

    # Open invoices (positive bank amount = customer paying us)
    if txn_amount >= 0:
        invs = supabase.table("invoices")\
            .select("id, invoice_number, invoice_date, total, balance_due, contacts(display_name)")\
            .eq("company_id", cid).in_("status", ["sent", "posted"])\
            .gte("invoice_date", start).lte("invoice_date", end)\
            .execute().data or []
        for i in invs:
            score = _score_candidate(txn_amount, txn_date, float(i["balance_due"] or 0), i["invoice_date"], days_window)
            if score > 0:
                candidates.append({
                    "kind": "invoice", "id": i["id"],
                    "label": f"Invoice {i.get('invoice_number')}",
                    "contact": (i.get("contacts") or {}).get("display_name"),
                    "amount": float(i.get("balance_due") or 0),
                    "date": i.get("invoice_date"),
                    "score": score,
                })

        pays = supabase.table("payments")\
            .select("id, payment_number, payment_date, amount, contacts:customer_id(display_name)")\
            .eq("company_id", cid)\
            .gte("payment_date", start).lte("payment_date", end)\
            .execute().data or []
        for p in pays:
            score = _score_candidate(txn_amount, txn_date, float(p["amount"] or 0), p["payment_date"], days_window)
            if score > 0:
                candidates.append({
                    "kind": "payment", "id": p["id"],
                    "label": f"Payment {p.get('payment_number') or p['id'][:8]}",
                    "contact": (p.get("contacts") or {}).get("display_name"),
                    "amount": float(p.get("amount") or 0),
                    "date": p.get("payment_date"),
                    "score": score,
                })

    # Open bills (negative bank amount = us paying vendor)
    if txn_amount <= 0:
        bills = supabase.table("bills")\
            .select("id, bill_number, bill_date, total, balance_due, contacts(display_name)")\
            .eq("company_id", cid).in_("status", ["posted"])\
            .gte("bill_date", start).lte("bill_date", end)\
            .execute().data or []
        for b in bills:
            score = _score_candidate(txn_amount, txn_date, float(b["balance_due"] or 0), b["bill_date"], days_window)
            if score > 0:
                candidates.append({
                    "kind": "bill", "id": b["id"],
                    "label": f"Bill {b.get('bill_number')}",
                    "contact": (b.get("contacts") or {}).get("display_name"),
                    "amount": float(b.get("balance_due") or 0),
                    "date": b.get("bill_date"),
                    "score": score,
                })

        bps = supabase.table("bill_payments")\
            .select("id, payment_number, payment_date, amount, contacts:vendor_id(display_name)")\
            .eq("company_id", cid)\
            .gte("payment_date", start).lte("payment_date", end)\
            .execute().data or []
        for p in bps:
            score = _score_candidate(txn_amount, txn_date, float(p["amount"] or 0), p["payment_date"], days_window)
            if score > 0:
                candidates.append({
                    "kind": "bill_payment", "id": p["id"],
                    "label": f"Bill payment {p.get('payment_number') or p['id'][:8]}",
                    "contact": (p.get("contacts") or {}).get("display_name"),
                    "amount": float(p.get("amount") or 0),
                    "date": p.get("payment_date"),
                    "score": score,
                })

    candidates.sort(key=lambda c: (-c["score"], c["date"]))
    return {
        "transaction": {
            "id": txn["id"],
            "amount": txn_amount,
            "date": txn_date,
            "name": txn.get("name"),
            "status": txn.get("status"),
        },
        "candidates": candidates[:25],
    }


class ConfirmMatchBody(BaseModel):
    kind: str        # invoice | bill | payment | bill_payment
    target_id: str   # the matched document's id


@router.post("/transactions/{txn_id}/match")
def confirm_match(
    txn_id: str,
    body: ConfirmMatchBody,
    auth: Dict[str, str] = Depends(require_min_role("user")),
):
    """Confirm a match between a bank transaction and an existing document.
    Looks up the document's linked_journal_entry_id and writes it into
    bank_transaction_matches. Sets the bank_transaction status to matched."""
    cid = auth["company_id"]
    txn = supabase.table("bank_transactions").select("*")\
        .eq("id", txn_id).eq("company_id", cid).single().execute().data
    if not txn:
        raise HTTPException(status_code=404, detail="Bank transaction not found")

    table_map = {
        "invoice":      "invoices",
        "bill":         "bills",
        "payment":      "payments",
        "bill_payment": "bill_payments",
    }
    if body.kind not in table_map:
        raise HTTPException(status_code=400, detail=f"Unknown kind: {body.kind}")

    doc = supabase.table(table_map[body.kind])\
        .select("id, linked_journal_entry_id")\
        .eq("id", body.target_id).eq("company_id", cid).single().execute().data
    if not doc:
        raise HTTPException(status_code=404, detail=f"{body.kind} not found")

    je_id = doc.get("linked_journal_entry_id")
    if not je_id:
        raise HTTPException(
            status_code=400,
            detail=f"{body.kind} has no posted journal entry to match against. Post the document first.",
        )

    supabase.table("bank_transaction_matches").upsert({
        "company_id": cid,
        "bank_transaction_id": txn_id,
        "journal_entry_id": je_id,
        "matched_by": auth.get("user_id"),
        "match_type": "matched_existing",
    }, on_conflict="bank_transaction_id").execute()

    supabase.table("bank_transactions").update({"status": "matched"})\
        .eq("id", txn_id).eq("company_id", cid).execute()

    return {"ok": True, "journal_entry_id": je_id, "kind": body.kind, "target_id": body.target_id}
