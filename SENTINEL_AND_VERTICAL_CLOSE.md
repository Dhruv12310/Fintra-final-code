# Fintra — Vertical Close + Proactive Sentinel

## What This Is and Why We Built It

Fintra already had a solid GL engine: AR/AP, Plaid banking, month-end close, a reactive chat agent with 38 tools, document OCR, and categorization with a learning loop. What it was missing was anything that worked *without the user asking* and anything that understood a specific industry below the generic accounting abstraction.

The competitive gap was clear:

| Player | Their AI wedge | What's missing |
|---|---|---|
| QuickBooks Intuit Assist | Shallow suggestions, horizontal | No vertical depth, no proactive agent |
| Xero | AI bank rec, receipt capture | Reactive only |
| Puzzle / Digits | Clean AI bookkeeping UX | Still mostly industry-agnostic |
| FloQast / Numeric | Close management tools | Sit *beside* the GL, not inside it |
| Ramp / Brex | Spend AI + policy agents | Card-first, not a GL |

**The gap nobody had filled:** an agentic, vertically-intelligent finance operator that owns end-to-end workflows (duplicate detection → ledger → close → narrated packet) *inside the GL itself.*

We chose two paired bets:

1. **Vertical Close** — extend Fintra's proven industry-handler pattern (from payroll) to the entire month-end close. One vertical deep (Construction) ships first; the framework supports all others.
2. **Proactive Sentinel** — flip the agent from reactive chat to an event-driven background worker that watches the GL and pages the controller.

Together these convert the agent from a "chat box" to an "AI controller that closes your books and watches them between closes."

---

## Architecture Overview

```
                  ┌─────────────────────────────────────┐
                  │  agent_alerts  │  agent_actions      │ ← shared inbox
                  └─────────────────────────────────────┘
                           ▲                    ▲
                           │                    │
             ┌─────────────┴──────────┐  ┌──────┴───────────────┐
             │  Vertical Close Agent  │  │  Sentinel Worker      │
             │  (on-demand, at close) │  │  (event-driven cron)  │
             └────────────────────────┘  └──────────────────────┘
                  │                              │
                  ▼                              ▼
           lib/close/                   lib/agent/triggers/
           ├ base.CloseHandler          ├ duplicate_bill.py
           ├ default.py (all industries)├ anomaly_txn.py
           └ construction.py (deep)     └ overdue_invoice.py
                  │                              │
                  └──────────────┬───────────────┘
                                 ▼
                       lib/notify/ (email + slack)
```

All vertical JEs flow through the existing `create_auto_journal_entry` in `routes/journal_helpers.py` — no new journal plumbing was introduced.

---

## Part 1 — Vertical Close Framework

### Why the Industry-Handler Pattern

Fintra already had `lib/payroll/industries/` — a registry of `IndustryHandler` subclasses (Food & Beverage, Construction, Real Estate, Healthcare, Default) that each implemented `calculate_line()` for payroll. This pattern proved clean: one registry, one abstract base, swappable per company industry.

We mirrored this exactly for the close, so the codebase stays consistent and adding a new vertical is a single new file.

### What Was Built

#### `lib/close/base.py` — Abstract base

```python
class CloseHandler(ABC):
    def pre_close_checks(company_id, period_start, period_end) -> list[CloseWarning]
    def generate_vertical_schedules(company_id, period_start, period_end) -> list[CloseJE]
    def amortize_prepaids(company_id, period_end) -> list[CloseJE]
    def narrate_flux(company_id, current_period, prior_period) -> str
```

`CloseJE` is a dataclass that carries everything `create_auto_journal_entry` needs (memo, reference, source, lines, entry_date). `CloseWarning` carries pre-flight validation messages.

#### `lib/close/default.py` — DefaultHandler

Works for every industry. Two capabilities:

- **Prepaid amortization** — reads `amortization_schedules` table, computes monthly straight-line release, posts DR Expense / CR Prepaid, updates `amortized_amount`. Marks schedule `completed` when fully released.
- **Flux narrative** — calls `claude-haiku-4-5` with a structured prompt comparing current vs prior period P&L. Falls back to a simple template string if `ANTHROPIC_API_KEY` is not set.

#### `lib/close/construction.py` — ConstructionHandler

Three industry-specific behaviors:

**1. WIP Schedule + Percentage-of-Completion Revenue Recognition**

The core of construction accounting. At each period close:
- Reads all active `projects` with their `estimated_total_costs`
- Sums `project_costs` records up to `period_end`
- Computes: `pct_complete = costs_to_date / estimated_total_costs`
- Computes: `earned_revenue = contract_value × pct_complete`
- Compares to `billed_revenue` (sum of posted invoices for the project)
- Posts the delta:
  - Under-billed: `DR Unbilled Revenue / CR Construction Revenue`
  - Over-billed: `DR Construction Revenue / CR Billings in Excess`
- Snapshots a `wip_entries` row per (project, period_end) for audit trail

**2. Retention Receivable Reclass**

When a project has `retention_pct > 0`, invoices in the period are split:
- `DR Retention Receivable / CR Accounts Receivable` for the retention portion
- This moves long-term retention out of current AR, improving balance sheet accuracy

**3. Job-Cost Flux Narrative**

`narrate_flux()` passes per-project cost summaries (name, % complete, earned revenue) into the Claude prompt so the narrative mentions specific project performance, not just aggregate P&L.

#### `lib/close/__init__.py` — Registry

```python
CLOSE_HANDLERS = { "Construction": ConstructionHandler() }

def get_close_handler(industry: str | None) -> CloseHandler:
    return CLOSE_HANDLERS.get(industry or "", _DEFAULT)
```

### Integration into Month-End Close

`lib/month_end.py` — `run_close_checklist()` now calls `generate_industry_close()` between step 4 (depreciation) and step 5 (report snapshots). This function:
1. Fetches the company's industry
2. Gets the handler via `get_close_handler(industry)`
3. Runs `amortize_prepaids()` (all industries)
4. Runs `generate_vertical_schedules()` (industry-specific)
5. Posts all resulting `CloseJE` objects via `create_auto_journal_entry`
6. Returns a step dict with pass/warn/fail status

### Close State Machine Upgrade

The old `close_checklists.overall_status` only had 3 values: `in_progress | completed | failed`.

New state machine (5 states):
```
in_progress → vertical_review → controller_review → approved → locked
```

- `vertical_review` — industry close complete, waiting for accountant sign-off
- `controller_review` — accountant reviewed, waiting for controller
- `approved` — approved, ready to lock
- `locked` — `accounting_periods.is_closed = true` set. **Only this transition locks the period.**

`transition_close_state()` in `lib/month_end.py` handles transitions, records `reviewed_by` / `approved_by` UUIDs, and writes to `server_activity_logs` for audit.

New API endpoints in `routes/month_end.py`:
- `POST /month-end/transition` — move to next state
- `GET /month-end/flux-narrative` — generate LLM narrative on demand
- `GET /month-end/alerts` — open sentinel alerts (for month-end context)

---

## Part 2 — Proactive Sentinel

### Why

Every competitor has a chat box. Very few have an agent that *watches your books and pages you*. This is the product narrative shift from "AI assistant" → "AI employee."

The existing agent was purely reactive: the user types, the agent responds. The sentinel inverts this — the system scans for events and queues pre-drafted actions for the user to approve in one click.

The confirmation flow already existed (`agent_actions` table, `requires_confirmation` flag, `_execute_confirmed_action()` in engine.py). The sentinel plugs into the same pattern, just with `triggered_by='system'` instead of a user chat.

### What Was Built

#### `lib/agent/sentinel.py` — Dispatcher

```python
async def run_sentinel(company_id=None) -> dict
```

- Iterates all registered triggers for one or all companies
- Each trigger is called with `scan(company_id) → list[alert_dict]`
- Upserts alerts into `agent_alerts` with a `dedupe_key` (idempotent — running twice doesn't double-alert)
- Optionally notifies via `lib/notify/slack.py` if the company has a Slack webhook configured
- Uses `sentinel_cursors` table as a per-(trigger, company) watermark so each scan only processes new records

#### Trigger 1: `lib/agent/triggers/duplicate_bill.py`

**Logic:**
- Scans bills inserted since the last cursor timestamp
- For each new bill: queries bills from same `vendor_id`, amount within ±5%, dated within 30 days
- If match found: flags the new bill `status='held_duplicate'`, creates alert
- Dedup key: `dup_bill_{bill_id}` — alert fires once per bill, not every scan

**Why 5% / 30 days:** tight enough to catch real duplicates, loose enough to allow legitimate similar amounts (e.g. monthly software subscriptions that change slightly).

#### Trigger 2: `lib/agent/triggers/anomaly_txn.py`

**Logic:**
- Scans `bank_transactions` inserted since cursor (capped at 200 per run)
- For each transaction: fetches 90-day history for the same `category`
- Flags if: `amount > mean + 3×stddev` OR `amount > 5×median`
- Also flags: round-dollar amounts ≥ $1,000 (pattern associated with invoice stuffing)
- Ignores transactions under $50 (too noisy)

**Why 3σ:** standard statistical outlier threshold — roughly 0.3% false positive rate on a normal distribution. In practice transaction data is right-skewed so the threshold is conservative.

#### Trigger 3: `lib/agent/triggers/overdue_invoice.py`

**Logic:**
- Scans all open invoices where `due_date < today`
- Checks 30/60/90-day thresholds
- Dedup key: `overdue_{invoice_id}_d{threshold}` — fires once at 30 days, again at 60, again at 90
- Drafts a full email body with tone ramping:
  - 30 days: friendly reminder
  - 60 days: firm request
  - 90 days: final notice, escalation language
- On user acceptance in `/alerts`, `routes/alerts.py` calls `lib/notify/email.py::send_email` and records `notifications_sent` row (idempotent — won't send twice)

#### `lib/notify/email.py` — Resend Integration

Uses the [Resend](https://resend.com) API (simplest transactional email with no domain verification headache).
- `send_email(to, subject, html_body)` → `bool`
- Returns `False` silently if `RESEND_API_KEY` is not set — alerts still appear in-app
- Requires: `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` env vars

#### `lib/notify/slack.py` — Slack Incoming Webhook

- `send_slack(text, webhook_url=None, company_settings=None)` → `bool`
- Webhook URL lookup order: explicit arg → `company.settings->>'slack_webhook'` → `SLACK_WEBHOOK_URL` env
- `format_alert(title, body, severity)` formats with emoji severity indicators

### Alert Inbox

#### `routes/alerts.py`

| Endpoint | Description |
|---|---|
| `GET /alerts` | List alerts (filterable by status, trigger) |
| `GET /alerts/summary` | Count by severity for dashboard widget |
| `POST /alerts/{id}/action` | Accept / dismiss / snooze |
| `POST /alerts/run-sentinel` | Manual trigger (for testing, accountant+ only) |

On `accepted`:
- **duplicate_bill**: releases the hold (`bills.status` → `draft`)
- **overdue_invoice**: sends the dunning email via Resend, records `notifications_sent`

#### `frontend/app/alerts/page.tsx`

- Severity-coded alert cards (critical = fuchsia, warning = amber, info = cyan)
- Expandable dunning email preview before sending
- Accept / Dismiss / Snooze buttons per card
- "Run Scan" button triggers manual sentinel run
- Filter tabs: Open / Dismissed

#### Dashboard Widget

`SentinelAlertsWidget` in `widgets.tsx` — shows top 5 open alerts with severity dots and trigger labels. Fetches independently from `/alerts` (doesn't wait for dashboard data). Added to `WIDGET_CATALOG` as `sentinel_alerts`, `defaultVisible: true`.

---

## Part 3 — Projects (Construction Data Entry)

### `routes/projects.py`

| Endpoint | Description |
|---|---|
| `GET /projects` | List projects (filterable by status) |
| `POST /projects` | Create project |
| `PATCH /projects/{id}` | Update project |
| `DELETE /projects/{id}` | Soft-delete |
| `GET /projects/{id}/wip` | WIP entry history |
| `GET /projects/{id}/costs` | Costs with breakdown by category |
| `POST /projects/costs` | Add a cost entry |

### `frontend/app/projects/page.tsx`

- Project cards showing: contract value, % complete (from latest WIP entry), over/under-billing amount
- Progress bar per project
- Retention % badge
- New Project modal: name, project number, contract value, estimated cost, retention %, start date
- "Construction hint" banner if company industry ≠ Construction

---

## Part 4 — Schema (Migration 024)

File: `migrations/024_close_sentinel.sql`

| Table | Purpose |
|---|---|
| `projects` | Construction projects with contract value, estimated costs, retention % |
| `project_costs` | Per-project cost entries by category (labor/materials/subcontractor/equipment/other) |
| `wip_entries` | Close-time snapshots: % complete, earned revenue, billed revenue, over/under billing |
| `amortization_schedules` | Prepaid expense amortization schedules (all industries) |
| `agent_alerts` | Sentinel alert inbox with dedupe_key for idempotency |
| `sentinel_cursors` | Per-(trigger, company) watermark for incremental scanning |
| `notifications_sent` | Idempotency guard for email/Slack dispatches |

Schema changes to existing tables:
- `close_checklists`: added `reviewed_by`, `approved_by`, `flux_narrative`, `industry_data`; expanded `overall_status` CHECK to include new states
- `bills`: added `held_duplicate` to `bill_status` enum via `ALTER TYPE bill_status ADD VALUE`
- `invoices` + `bills`: added optional `project_id` FK for WIP cost tracking
- `companies`: added `settings JSONB` column for per-company Slack webhook config

All new tables have: RLS enabled, `company_isolation` policy (mirrors migration 020 pattern), compound indexes on `(company_id, status/date)`.

---

## Part 5 — What Was Removed

In the same session, Payroll, Equity, and HR & People were removed from the app as they are not part of the current product goal.

**Deleted:**
- `routes/payroll.py`, `routes/equity.py`, `routes/hr.py`, `routes/timesheets.py`, `routes/invites.py`
- `lib/payroll/` (entire module)
- `lib/agent/tools/payroll_tool.py`, `equity_tool.py`, `hr_tool.py`
- `migrations/017–019, 021–023` (payroll, equity, HR, industry payroll, invites, time entries)
- `frontend/app/payroll/`, `equity/`, `hr/`, `me/`, `accept-invite/`

**To drop tables from Supabase:** run `migrations/025_drop_payroll_equity_hr.sql` in the SQL Editor.

---

## Configuration

### Environment Variables

Add to `.env` (backend):

```env
# Email delivery (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxx
NOTIFY_FROM_EMAIL=noreply@yourdomain.com

# Slack alerts (optional, per-company override also available)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz

# Already required
ANTHROPIC_API_KEY=sk-ant-...
```

### Per-Company Slack Webhook

Store in `companies.settings` JSONB:
```json
{ "slack_webhook": "https://hooks.slack.com/services/xxx/yyy/zzz" }
```

---

## Testing Checklist

### 1. Run the Migration

In Supabase SQL Editor → run `migrations/024_close_sentinel.sql` in full. Expected: 0 errors, all tables created.

Then if dropping old modules: run `migrations/025_drop_payroll_equity_hr.sql`.

### 2. Test Sentinel Triggers

**Duplicate Bill:**
1. Create a bill for any vendor at $1,000
2. Create a second bill for the same vendor at $1,020 (within 5%)
3. Hit `POST /alerts/run-sentinel` or navigate to `/alerts` and click "Run Scan"
4. Expected: second bill flagged `held_duplicate`, alert appears in `/alerts` with "Release & Post" action

**Anomaly Detection:**
1. Ensure you have 10+ bank transactions in the same category (e.g. "Software")
2. Sync a new transaction in that category at 5× the average
3. Run sentinel
4. Expected: alert "Unusual transaction" with σ reasoning in body

**Overdue Invoice:**
1. Create and post an invoice with `due_date` 35+ days ago
2. Run sentinel
3. Expected: alert with drafted email body at the 30-day threshold

### 3. Test Construction Close

1. Set company industry to **Construction** in Profile → Company Info
2. Create a project: contract value $500,000, estimated cost $400,000
3. Add project costs: $200,000 total (50% complete)
4. Post an invoice for $200,000 against the project
5. Run `POST /month-end/close` with `lock: false` (dry run)
6. Expected step 4b: "Industry Close (Construction)" — 1 WIP entry (under-billed $50,000), 1 WIP journal entry posted
7. Check `wip_entries` table: should have a row with `pct_complete=50, earned_revenue=250000, billed_revenue=200000, over_under_billing=50000`

### 4. Test Close State Machine

1. Run close (step 3 above)
2. `POST /month-end/transition` with `{ period_start: "...", new_status: "vertical_review" }`
3. `POST /month-end/transition` → `"controller_review"`
4. `POST /month-end/transition` → `"approved"`
5. `POST /month-end/transition` → `"locked"`
6. Expected: `accounting_periods.is_closed = true` now set; period is locked

### 5. Test Flux Narrative

- `GET /month-end/flux-narrative?period_start=...&period_end=...`
- Expected: 3-6 sentence narrative. For Construction: mentions project names and % complete.
- If no `ANTHROPIC_API_KEY`: returns a simple template string (no error).

### 6. Test Prepaid Amortization

1. Insert a row into `amortization_schedules` manually (or via API when wired in UI):
   - `original_amount: 1200`, `start_date: 2026-01-01`, `end_date: 2026-12-31`
   - Link to real `expense_account_id` and `prepaid_account_id` from your COA
2. Run the close
3. Expected: $100/month posted (DR Expense / CR Prepaid), `amortized_amount` incremented

### 7. Test Email Delivery

1. Set `RESEND_API_KEY` and `NOTIFY_FROM_EMAIL` in `.env`
2. Trigger an overdue invoice alert (see step above)
3. In `/alerts`, click "Send Email" on the dunning alert
4. Expected: email delivered to the customer's email address; `notifications_sent` row inserted; clicking "Send Email" again does nothing (idempotent)

### 8. Dashboard Widget

1. Navigate to the dashboard
2. If `sentinel_alerts` widget is not visible, open widget settings and enable it
3. Expected: widget shows top 5 open alerts with severity dots

---

## File Map

```
lib/
├── close/
│   ├── __init__.py          registry + get_close_handler()
│   ├── base.py              CloseHandler ABC, CloseJE, CloseWarning
│   ├── default.py           DefaultHandler (all industries)
│   └── construction.py      ConstructionHandler (WIP, retention, flux)
├── agent/
│   ├── sentinel.py          event dispatcher + trigger registry
│   └── triggers/
│       ├── __init__.py
│       ├── duplicate_bill.py  5%/30-day duplicate detection
│       ├── anomaly_txn.py     3σ statistical anomaly
│       └── overdue_invoice.py 30/60/90-day dunning drafts
└── notify/
    ├── __init__.py
    ├── email.py             Resend dispatcher
    └── slack.py             Slack incoming webhook

routes/
├── alerts.py               alert inbox CRUD + sentinel trigger
├── projects.py             project + cost CRUD
└── month_end.py            + /transition, /flux-narrative, /alerts

migrations/
├── 024_close_sentinel.sql  all new tables + schema changes
└── 025_drop_payroll_equity_hr.sql  drop old modules

frontend/app/
├── alerts/page.tsx         alert inbox UI
└── projects/page.tsx       project cards + WIP + modal

frontend/components/
├── dashboard/widgets.tsx   + SentinelAlertsWidget
├── dashboard/WidgetGrid.tsx + sentinel_alerts case + self-fetch
└── NewSidebar.tsx          + Alerts, Projects nav items
```

---

## Future Extensions (Not in MVP)

| Feature | What to add |
|---|---|
| Food & Beverage close | `lib/close/food_beverage.py` — tip-pool JEs, food-cost ratio alerts |
| Real Estate close | `lib/close/real_estate.py` — ASC 842 lease schedules, CAM recon, tenant AR |
| Healthcare close | `lib/close/healthcare.py` — contractual adjustment accruals, bad-debt reserves |
| Email-to-Ledger (Bet C) | Gmail OAuth integration, `lib/inbox/classifier.py`, inbox triage UI |
| Budget vs Actual | `budgets` table, variance widget, Slack alerts on budget breach |
| Runway forecasting | AR collection probability model, cash forward projection |
| Continuous close | Daily depreciation/amortization cron, rolling period locks |
| Audit packet PDF | ReportLab/WeasyPrint close packet with flux narrative + JE listing |
