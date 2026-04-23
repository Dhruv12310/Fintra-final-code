# Fintra Finance OS

Full-stack accounting and financial operations platform for growing teams. Double-entry bookkeeping, Plaid bank feeds, AR/AP automation, customizable dashboard, role-based admin panel, AI copilot, and a polished light/dark UI.

Backend: FastAPI + Supabase (Postgres, Auth, Storage). Frontend: Next.js 14 (App Router) + TypeScript + Tailwind CSS + Recharts. PWA-installable on desktop and mobile.

## Highlights

- Full double-entry general ledger with auto-journal posting for invoices, bills, payments, and bank transactions
- Plaid integration for live bank feeds, transaction sync, and reconciliation
- Customizable dashboard with 17 widgets, drag-and-drop reordering, per-user preferences
- AR/AP aging, cash flow, profit and loss, sentinel alerts, and an AI Insights panel
- Company-scoped RBAC (owner, admin, accountant, user, viewer) with admin passcode flow and audit log
- AI copilot wired through Anthropic and OpenAI with retrieval-augmented context
- PWA: installable, offline shell, service worker, app icons, shortcuts
- Light and dark themes that share a single design token system

## Stack

| Layer    | Tech                                                                                  |
| -------- | ------------------------------------------------------------------------------------- |
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Recharts, lucide-react   |
| Backend  | FastAPI, Pydantic, Uvicorn, Postgrest (via supabase-py), httpx                        |
| Database | Supabase Postgres with Row Level Security, pgvector for embeddings                    |
| Auth     | Supabase Auth (email + password, server-side JWT validation)                          |
| AI       | OpenAI, Anthropic, Perplexity                                                         |
| Banking  | Plaid (sandbox and production)                                                        |
| Hosting  | Vercel (frontend) + Railway or Render (backend) + Supabase Cloud                      |

## Quick Start

### 1. Backend

```bash
python3 -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Fill SUPABASE_URL, SUPABASE_KEY, ENCRYPTION_KEY, PLAID_*, OPENAI_API_KEY
uvicorn main:app --reload --port 8001
```

API root: http://127.0.0.1:8001
Interactive docs: http://127.0.0.1:8001/docs

### 2. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
# Fill NEXT_PUBLIC_API_BASE, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

App: http://localhost:3000

### 3. Database

Apply the canonical schema first, then every migration in numerical order. Use the Supabase SQL Editor or psql.

```bash
psql "$DATABASE_URL" -f migrations/newschema.sql
for f in migrations/0*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

The latest migration `027_align_dashboard_widgets.sql` aligns the dashboard widgets table with the customizable dashboard API and must be applied for widget save to work.

## Project Layout

```
endless/
├── main.py                       FastAPI entrypoint, CORS, middleware, router wiring
├── database.py                   Supabase client and table helper
├── routes/                       30+ API routers (one per domain)
│   ├── admin.py                  Admin panel: passcode, sessions, members, activity log
│   ├── dashboard.py              Customizable widgets, KPIs, aging, cash flow
│   ├── banking.py                Plaid link tokens, transaction sync, accounts
│   ├── invoices.py / bills.py    AR/AP with auto journal entries
│   ├── reports.py                Trial balance, P&L, balance sheet, cash flow
│   ├── month_end.py              Closing entries, reversals, period locks
│   ├── alerts.py                 Sentinel: duplicate bills, anomalies, overdue AR
│   ├── agent.py                  AI accounting agent (multi-step tool use)
│   └── ...
├── middleware/
│   ├── auth.py                   JWT validation, current_user_company resolver
│   ├── rbac_guard.py             Company-scoped role enforcement
│   └── activity_logger.py        Inbound/outbound HTTP audit trail
├── lib/
│   ├── admin_session.py          HMAC-signed admin session tokens
│   ├── crypto.py                 Fernet encryption for stored OAuth tokens
│   ├── close/                    Close sentinel, vertical close logic
│   └── agent/                    LLM tool registry + executor
├── migrations/                   Idempotent SQL migrations applied in order
├── frontend/
│   ├── app/                      Next.js App Router pages
│   │   ├── new-dashboard/        Main dashboard with widget grid
│   │   ├── admin/                RBAC-gated admin panel + login
│   │   ├── banking/              Plaid Link, accounts, transactions
│   │   ├── invoices/ bills/      AR/AP with line items
│   │   ├── reports/              Trial balance, P&L, balance sheet
│   │   ├── month-end/            Period close workflow
│   │   ├── alerts/               Sentinel inbox
│   │   ├── projects/             Project tracking
│   │   ├── integrations/         OAuth integrations (QBO, Workday, etc.)
│   │   └── ...
│   ├── components/
│   │   ├── dashboard/            Widget catalog, grid, add widget modal
│   │   ├── AppLayout.tsx         Persistent sidebar shell
│   │   ├── AskAIButton.tsx       Floating AI launcher
│   │   └── AgentChat.tsx         Conversational agent UI
│   ├── public/
│   │   ├── manifest.json         PWA manifest
│   │   ├── sw.js                 Workbox service worker
│   │   └── icons/                PWA icons
│   └── contexts/AuthContext.tsx  Supabase session, company hydration
└── README.md
```

## Feature Overview

### Customizable Dashboard

17 widgets covering revenue vs expenses, profit margin, top expense categories, AR and AP aging, action items, recent transactions, cash flow, deposits, P&L, sales, AI analysis, sentinel alerts, and more. Per-user widget preferences stored in `dashboard_widgets` and synced through `PUT /dashboard/widgets`.

### Admin Panel

Role-gated panel at `/admin` for owners and admins. Surfaces:
- Member roster with role assignment (owner, admin, accountant, user, viewer)
- Inbound and outbound HTTP activity log with filtering
- Admin passcode setup and step-up session tokens
- Company-scoped audit purge

Backed by `routes/admin.py`, `lib/admin_session.py`, and the RBAC guard middleware.

### PWA

`frontend/public/manifest.json` declares Fintra as a standalone PWA with maskable icons, theme color, and shortcuts. `sw.js` and the bundled Workbox runtime register a service worker through `app/layout.tsx`, giving an installable app on Chrome, Edge, and iOS Safari.

### Banking and Reconciliation

Plaid Link issues a public token, the backend exchanges it for an access token (Fernet-encrypted at rest), and `/banking/sync` pulls transactions into `bank_transactions`. Reconciliation matches bank lines to journal entries via `routes/reconciliation.py`.

### AR / AP Automation

Posting an invoice or bill auto-creates the matching journal entry (DR AR or expense, CR revenue or AP). Recording payments closes the loop and reduces `balance_due`. AR and AP aging widgets read straight off `invoices.due_date` and `bills.due_date`.

### Sentinel Alerts and Month-End Close

`routes/alerts.py` and `lib/close/` watch for duplicate bills, anomalous transactions, overdue AR, and unposted entries before period close. `routes/month_end.py` drives the close wizard, generates closing entries, and locks accounting periods.

### AI Copilot

`Ask AI` floating button opens a conversational agent. The agent has tool access to journals, accounts, contacts, and reports through `lib/agent/`. Insights endpoint summarizes the dashboard period using the same context.

## Environment Variables

### Backend (`.env`)

| Variable                | Required | Notes                                                        |
| ----------------------- | -------- | ------------------------------------------------------------ |
| `SUPABASE_URL`          | yes      | Project URL                                                  |
| `SUPABASE_KEY`          | yes      | Service role key                                             |
| `SUPABASE_JWT_SECRET`   | optional | Validate tokens locally instead of round-tripping            |
| `ENCRYPTION_KEY`        | yes      | Fernet key for storing OAuth tokens (`Fernet.generate_key`)  |
| `OPENAI_API_KEY`        | optional | AI receipt parsing and insights                              |
| `PERPLEXITY_API_KEY`    | optional | `/ai/query` market intelligence                              |
| `PLAID_CLIENT_ID`       | yes      | Banking integration                                          |
| `PLAID_SECRET`          | yes      | Banking integration                                          |
| `PLAID_ENV`             | yes      | `sandbox`, `development`, or `production`                    |
| `ADMIN_PASSCODE_PEPPER` | yes      | Pepper for admin passcode hashing                            |
| `QBO_*`, `WORKDAY_*`, `CARTA_*` | optional | Per-integration OAuth credentials                  |

### Frontend (`frontend/.env.local`)

| Variable                          | Required | Notes                          |
| --------------------------------- | -------- | ------------------------------ |
| `NEXT_PUBLIC_API_BASE`            | yes      | Backend base URL               |
| `NEXT_PUBLIC_SUPABASE_URL`        | yes      | Project URL                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | yes      | Anon key                       |
| `NEXT_PUBLIC_DEMO_MODE`           | optional | Skip auth for demo environment |

`.env`, `.env.local`, and `.env.secrets` are gitignored. Only the `.example` templates are committed.

## Recent Changes

- New customizable dashboard with 17 widgets, drag-to-reorder, and per-user preferences
- Admin panel with company-scoped RBAC, passcode flow, and audit log
- Auth lockout after repeated failed attempts and forgot-password flow
- Plaid banking with encrypted token storage and transaction sync
- Auto-journal posting for invoices, bills, and payments
- Sentinel alerts and vertical close for month-end
- AI agent with tool access to ledger and contacts
- PWA shell with installable manifest, service worker, and shortcuts
- Light and dark themes sharing a single CSS variable system
- Migration `027_align_dashboard_widgets.sql` to align widget storage with the new API
- Dashboard AR widget rewritten to join contacts instead of a deprecated `customer_name` column
- Hardened `PUT /dashboard/widgets` so a single failed widget no longer 500s the request

## Deployment

The app deploys cleanly to Vercel for the frontend and Railway, Render, or Fly for the backend. See `DEPLOYMENT_GUIDE.md`, `VERCEL_DEPLOYMENT.md`, and `DEPLOY_QUICK_START.md` for step-by-step instructions. `Dockerfile` and `railway.json` are included for containerized deploys.

## Author

Dhruv Bhatt

## License

Proprietary. All rights reserved.
