# Endless — AI-Powered Accounting Platform

Full-stack accounting with double-entry bookkeeping, Supabase auth, and optional AI (OpenAI). Backend: FastAPI. Frontend: Next.js 14 (App Router) + Tailwind.

---

## Quick Start

### Backend

```bash
cd /path/to/endless
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: SUPABASE_URL, SUPABASE_KEY; optional: SUPABASE_JWT_SECRET, OPENAI_API_KEY
uvicorn main:app --reload --port 8000
```

API: **http://127.0.0.1:8000** · Docs: **http://127.0.0.1:8000/docs**

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
# Edit .env.local: NEXT_PUBLIC_API_BASE, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

App: **http://localhost:3000**

### Database

Apply schema in Supabase (SQL Editor or `psql`):

- Root: `supabase_schema.sql`
- Then: `migrations/002_extend_companies_metadata.sql`, `migrations/003_add_website_field.sql`

See **MIGRATION_GUIDE.md** for full migration steps.

---

## Tech Stack

| Layer    | Tech |
|----------|------|
| Backend  | FastAPI, Uvicorn, python-dotenv, Supabase Python SDK, python-jose (JWT), OpenAI (optional) |
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, Supabase JS (auth), Axios, Recharts, Framer Motion, Lucide / Tabler icons |
| Data     | Supabase (PostgreSQL + Auth) |

---

## Project Structure

```
endless/
├── main.py                 # FastAPI app, CORS, route includes
├── database.py             # Supabase client / table helpers
├── smart_parser.py         # OCR / receipt parsing (if used)
├── start.sh                # Production start (e.g. Railway: PORT)
├── requirements.txt       # Dev dependencies
├── requirements.production.txt
├── .env.example            # Backend env template
├── supabase_schema.sql     # Main DB schema
├── migrations/             # Optional schema patches
├── routes/
│   ├── users.py           # /users
│   ├── companies.py       # /companies
│   ├── accounts.py        # /accounts (Chart of Accounts)
│   ├── journals.py        # /journals
│   ├── dashboard.py      # /dashboard
│   ├── ai_insights.py     # /ai-insights
│   ├── ai_research.py     # /ai/research
│   ├── ai_overlook.py     # /ai (expense validation)
│   ├── expenses.py       # /expenses
│   ├── parser.py         # /parse (receipt OCR)
│   ├── coa_templates.py  # /coa-templates
│   ├── banking.py        # /bank
│   ├── contacts.py       # /contacts
│   ├── invoices.py       # /invoices
│   ├── payments.py       # /payments
│   ├── bills.py          # /bills
│   ├── bill_payments.py  # /bill-payments
│   ├── accounting_periods.py  # /accounting-periods
│   ├── reconciliation.py # /reconciliation
│   ├── reports.py        # /reports
│   └── documents.py      # /documents
└── frontend/
    ├── app/               # Next.js App Router
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── login/         # Login
    │   ├── signup/        # Signup
    │   ├── auth/callback/ # Supabase auth callback
    │   ├── onboarding/   # Company setup
    │   ├── new-dashboard/
    │   ├── banking/
    │   ├── new-journals/
    │   ├── chart-of-accounts/
    │   ├── invoices/
    │   ├── bills/
    │   ├── reports/
    │   ├── month-end/
    │   ├── ai/
    │   ├── profile/
    │   ├── company/
    │   └── documents/
    ├── components/        # NewSidebar, shared UI
    ├── contexts/          # AuthContext, ThemeContext
    └── lib/               # API client, Supabase client
```

---

## Environment Variables

**Backend (`.env`):**

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Service role key (backend only) |
| `SUPABASE_JWT_SECRET` | No | JWT secret for local token validation (Project Settings → API) |
| `OPENAI_API_KEY` | No | OpenAI for AI insights / expense validation |
| `PERPLEXITY_API_KEY` | No | For `/ai/research` (e.g. market benchmarks) |

**Frontend (`.env.local`):**

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_BASE` | Yes | Backend base URL (e.g. `http://localhost:8000`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `NEXT_PUBLIC_DEMO_MODE` | No | Set to skip auth (demo) |
| `NEXT_PUBLIC_COMPANY_ID` | No | Pre-fill company (dev) |

Never commit `.env`, `.env.local`, or `.env.secrets`. Use `.env.example` and `.env.local.example` as templates.

---

## Frontend Modules (Current UI)

| Route | Purpose |
|-------|---------|
| `/login`, `/signup` | Supabase auth |
| `/onboarding` | Company setup (industry, COA, etc.) |
| `/new-dashboard` | Main dashboard |
| `/banking` | Banking / transactions |
| `/new-journals` | Journal entries (double-entry) |
| `/chart-of-accounts` | Chart of Accounts |
| `/invoices` | Invoicing |
| `/bills` | Bills / payables |
| `/reports` | Reports |
| `/month-end` | Period close / month-end |
| `/ai` | Ask AI / research |
| `/profile` | User profile |
| `/company` | Company settings |
| `/documents` | Document list |

---

## API Overview

| Area | Prefix / Path | Description |
|------|----------------|-------------|
| Users | `/users` | CRUD, link to company |
| Companies | `/companies` | CRUD, onboarding |
| Accounts | `/accounts` | Chart of Accounts |
| Journals | `/journals` | Journal entries |
| Dashboard | `/dashboard` | Dashboard aggregates |
| AI Insights | `/ai-insights` | Insights generation |
| AI Research | `/ai/research` | Research / benchmarks |
| AI Overlook | `/ai` | Expense validation |
| Expenses | `/expenses` | Expense entries |
| Parser | `/parse` | Receipt/file parsing |
| COA Templates | `/coa-templates` | Onboarding COA |
| Banking | `/bank` | Banking data |
| Contacts | `/contacts` | Vendors / customers |
| Invoices | `/invoices` | Invoices |
| Payments | `/payments` | Payments |
| Bills | `/bills` | Bills |
| Bill Payments | `/bill-payments` | Bill payments |
| Accounting Periods | `/accounting-periods` | Periods |
| Reconciliation | `/reconciliation` | Reconciliation |
| Reports | `/reports` | Reports |
| Documents | `/documents` | Documents |

Health: `GET /`, `GET /health`, `GET /status/healthz`.

---

## Production

- Backend: use `requirements.production.txt` and `start.sh` (e.g. `PORT` from env).
- Frontend: `npm run build` then `npm run start`.
- Set `NEXT_PUBLIC_API_BASE` to the deployed backend URL.
- Keep `SUPABASE_KEY` and API keys only on the server; never in frontend.

See **DEPLOYMENT_GUIDE.md** / **VERCEL_DEPLOYMENT.md** if present.

---

## Documentation

- **MIGRATION_GUIDE.md** — Database migration steps  
- **supabase_schema.sql** — Full schema  
- **API docs** — http://localhost:8000/docs (when backend is running)

---

## Contributors

Endless Moments LLC — Amogh Dagar, Satya Neriyanuru, Atiman Rohtagi, Ashish Kumar, Dhruv Bhatt.
