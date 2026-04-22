"""
AI Integration Test Suite
Run: python test_ai.py

Requires:
  - Backend running on http://127.0.0.1:8001
  - A valid JWT token from a logged-in Supabase session (paste below)
"""

import requests
import json
import sys

# ── CONFIG ─────────────────────────────────────────────────────────────────────
BASE = "http://127.0.0.1:8001"

# Paste your JWT token from browser DevTools:
#   Application → Local Storage → https://... → sb-...-auth-token → access_token
TOKEN = "PASTE_YOUR_SUPABASE_JWT_HERE"

# ── Helpers ────────────────────────────────────────────────────────────────────
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
PASS = 0
FAIL = 0

def run(label, method, path, body=None, expected_status=200, stream=False):
    global PASS, FAIL
    url = BASE + path
    try:
        if stream:
            r = requests.request(method, url, json=body, headers=HEADERS, stream=True, timeout=15)
        else:
            r = requests.request(method, url, json=body, headers=HEADERS, timeout=15)
    except Exception as e:
        print(f"  [FAIL] {label}: Connection error — {e}")
        FAIL += 1
        return None

    ok = r.status_code == expected_status
    symbol = "[PASS]" if ok else "[FAIL]"
    status_note = f"HTTP {r.status_code}"

    if ok:
        PASS += 1
        if stream:
            # Read first line of SSE
            first = next(r.iter_lines(), b"").decode()
            print(f"  {symbol} {label} ({status_note}) → SSE: {first[:120]}")
        else:
            try:
                data = r.json()
                # Show first key/value or detail message
                preview = json.dumps(data)[:120]
            except Exception:
                preview = r.text[:120]
            print(f"  {symbol} {label} ({status_note}) → {preview}")
    else:
        FAIL += 1
        try:
            detail = r.json().get("detail", r.text[:100])
        except Exception:
            detail = r.text[:100]
        print(f"  {symbol} {label} ({status_note}) → {detail}")

    return r


# ── Check token ─────────────────────────────────────────────────────────────────
if TOKEN == "PASTE_YOUR_JWT_HERE":
    print("ERROR: Paste your JWT token into TOKEN= at the top of this file.")
    print("\nHow to get it:")
    print("  1. Open http://localhost:3001 in Chrome")
    print("  2. DevTools -> Application -> Local Storage -> https://YOUR-PROJECT-REF.supabase.co")
    print("  3. Find key: sb-YOUR-PROJECT-REF-auth-token")
    print("  4. Copy the access_token value")
    sys.exit(1)


print("\n" + "="*60)
print("  AI INTEGRATION TESTS")
print("="*60)


# ── 1. Financial Summary (no external API needed) ──────────────────────────────
print("\n[1] Financial Summary (template-based, always works)")
run("GET /ai/financial-summary", "GET", "/ai/financial-summary")


# ── 2. AI Overlook Expense ─────────────────────────────────────────────────────
print("\n[2] AI Overlook Expense (OpenAI or rule-based fallback)")

run("Valid expense", "POST", "/ai/overlook_expense", {
    "vendor_name": "AWS",
    "amount": 249.99,
    "date": "2026-04-01",
    "category": "Software",
    "memo": "Monthly cloud hosting"
})

run("Invalid expense (missing fields)", "POST", "/ai/overlook_expense", {
    "vendor_name": "",
    "amount": -5,
    "date": ""
})


# ── 3. AI Query (Anthropic fallback since ANTHROPIC_API_KEY is set) ────────────
print("\n[3] AI Query — Anthropic fallback (no Perplexity key needed)")

run("Growth question", "POST", "/ai/query", {
    "question": "What are the best ways to grow a SaaS business?"
})

run("Benchmark question", "POST", "/ai/query", {
    "question": "What are typical profit margins for SaaS companies?"
})

run("General business advice", "POST", "/ai/query", {
    "question": "How should I manage cash flow during a slow quarter?"
})

run("Missing question field", "POST", "/ai/query", {}, expected_status=400)


# ── 4. AI Insights CRUD ────────────────────────────────────────────────────────
print("\n[4] AI Insights CRUD")

# Get company_id from a quick user lookup
me = run("GET /users/me (get company_id)", "GET", "/users/me")
company_id = None
if me and me.ok:
    try:
        company_id = me.json().get("company_id")
    except Exception:
        pass

if company_id:
    r = run("Create insight", "POST", "/ai-insights/", {
        "company_id": company_id,
        "insight_type": "recommendation",
        "severity": "info",
        "title": "Test: Optimize Cash Flow",
        "description": "Consider reviewing accounts receivable aging.",
        "actionable": True
    })

    insight_id = None
    if r and r.ok:
        try:
            insight_id = r.json().get("id")
        except Exception:
            pass

    run(f"List insights for company", "GET", f"/ai-insights/company/{company_id}")

    if insight_id:
        run(f"Get insight by id", "GET", f"/ai-insights/{insight_id}")
        run(f"Delete insight", "DELETE", f"/ai-insights/{insight_id}")
else:
    print("  [SKIP] Could not determine company_id — skipping insights tests")


# ── 5. AI Research Capabilities Check ─────────────────────────────────────────
print("\n[5] AI Research — Capabilities")
run("GET /ai/research/capabilities", "GET", "/ai/research/capabilities")


# ── 6. AI Research endpoints (require PERPLEXITY_API_KEY) ─────────────────────
print("\n[6] AI Research — Perplexity endpoints (expect 503 if key not set)")
run("POST /ai/research/industry-benchmarks", "POST", "/ai/research/industry-benchmarks")
run("POST /ai/research/growth-recommendations", "POST", "/ai/research/growth-recommendations")
run("POST /ai/research/tax-updates", "POST", "/ai/research/tax-updates")


# ── 7. Agent Sessions ─────────────────────────────────────────────────────────
print("\n[7] Agent Sessions")
r = run("POST /agent/sessions (create)", "POST", "/agent/sessions", {})
session_id = None
if r and r.ok:
    try:
        session_id = r.json().get("id") or r.json().get("session_id")
    except Exception:
        pass

run("GET /agent/sessions (list)", "GET", "/agent/sessions")


# ── 8. Agent Chat — 14 tools via Claude ───────────────────────────────────────
print("\n[8] Agent Chat (SSE — reads first 5 lines of stream)")

def run_agent(label, message, session_id=None):
    global PASS, FAIL
    body = {"message": message}
    if session_id:
        body["session_id"] = session_id
    try:
        r = requests.post(
            BASE + "/agent/chat", json=body, headers=HEADERS, stream=True, timeout=30
        )
        if not r.ok:
            print(f"  [FAIL] {label}: HTTP {r.status_code} — {r.text[:100]}")
            FAIL += 1
            return
        lines = []
        for line in r.iter_lines():
            if line:
                decoded = line.decode() if isinstance(line, bytes) else line
                if decoded.startswith("data:"):
                    try:
                        ev = json.loads(decoded[5:].strip())
                        ev_type = ev.get("type", "?")
                        if ev_type == "text":
                            lines.append(f"text: {ev.get('content','')[:80]}")
                        elif ev_type == "tool_call":
                            lines.append(f"tool_call: {ev.get('name')} {json.dumps(ev.get('args',{}))[:60]}")
                        elif ev_type == "tool_result":
                            lines.append(f"tool_result: {ev.get('name')} ok={not ev.get('result',{}).get('error')}")
                        elif ev_type == "confirmation_request":
                            lines.append(f"confirmation_request: {ev.get('message','')[:60]}")
                        elif ev_type == "done":
                            lines.append(f"done ✓")
                        elif ev_type == "error":
                            lines.append(f"ERROR: {ev.get('message','')}")
                    except Exception:
                        lines.append(decoded[:80])
            if len(lines) >= 5:
                break
        print(f"  [PASS] {label}")
        for l in lines:
            print(f"         → {l}")
        PASS += 1
    except Exception as e:
        print(f"  [FAIL] {label}: {e}")
        FAIL += 1

# READ-ONLY tools (no confirmation needed)
run_agent("read: get_financial_summary",    "What is my current cash balance and total revenue?")
run_agent("read: get_account_balance",      "What's the balance in my accounts receivable account?")
run_agent("read: list_journal_entries",     "Show me the 5 most recent journal entries")
run_agent("read: list_overdue_invoices",    "Which invoices are overdue right now?")
run_agent("read: list_unreviewed_txns",     "How many unreviewed bank transactions do I have?")
run_agent("read: categorize_transactions",  "Can you auto-categorize my pending bank transactions?")
run_agent("read: auto_match_transactions",  "Try to auto-match my bank transactions for reconciliation")

# WRITE tools (should return confirmation_request event)
run_agent("write: create_journal_entry",    "Create a journal entry debiting Marketing Expense $500 and crediting Cash $500 dated today")
run_agent("write: create_invoice",          "Create a draft invoice for $1,000 to our first contact")
run_agent("write: create_recurring",        "Set up a monthly journal entry for rent expense of $2,000 starting next month")
run_agent("write: run_month_end_close",     "Run the month-end close checklist for this month")


# ── 9. AI Bank Categorization (rule engine + OpenAI) ─────────────────────────
print("\n[9] AI Bank Categorization")
run("POST /bank/transactions/auto-categorize", "POST", "/bank/transactions/auto-categorize", {})

# ── 10. Document Processing (OpenAI Vision) ────────────────────────────────────
print("\n[10] Document Processing")
# List documents first, then try to process the first one
docs_r = run("GET /documents", "GET", "/documents")
doc_id = None
if docs_r and docs_r.ok:
    try:
        docs = docs_r.json()
        if isinstance(docs, list) and docs:
            doc_id = docs[0].get("id")
        elif isinstance(docs, dict):
            items = docs.get("documents") or docs.get("data") or []
            if items:
                doc_id = items[0].get("id")
    except Exception:
        pass

if doc_id:
    run(f"POST /documents/{doc_id}/process", "POST", f"/documents/{doc_id}/process")
else:
    print("  [SKIP] No documents uploaded yet — upload a PDF/image first to test OCR extraction")

# ── 11. Integrations (QuickBooks / Workday / Carta) ───────────────────────────
print("\n[11] Integrations")
run("GET /integrations (list connected)", "GET", "/integrations")
run("GET /ai/research/capabilities",      "GET", "/ai/research/capabilities")

# ── Summary ────────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print(f"  RESULTS: {PASS} passed, {FAIL} failed")
print("="*60 + "\n")
