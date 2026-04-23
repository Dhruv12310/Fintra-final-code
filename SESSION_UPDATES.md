# Session Updates

## 2026-04-23 — Design System Compliance & UI Consistency Pass

### Overview
Major design system audit and enforcement pass. All app pages now follow the "Supabase meets Linear" design spec: `#f8fafc` canvas, white cards, `#e2e8f0` slate borders, single blue accent, no neon gradients outside charts.

---

### New Components

#### `frontend/components/PageHeader.tsx` (NEW)
Shared page header component used across all app pages to enforce consistent heading structure.
- Props: `eyebrow?`, `title`, `subtitle?: React.ReactNode`, `actions?: React.ReactNode`
- Applies `.page-eyebrow`, `.page-title`, `.page-subtitle` CSS utility classes
- Eliminates per-page hand-rolled headers with inline styles

---

### CSS Changes (`frontend/app/globals.css`)

- `.dot-grid` updated with `background-attachment: fixed` so the dot pattern is viewport-relative and visible through transparent page backgrounds
- Added utility classes: `.page-eyebrow`, `.page-title`, `.page-subtitle` for consistent page headers
- Added `.badge`, `.badge-success`, `.badge-danger`, `.badge-warning`, `.badge-info`, `.badge-neutral` for status badges

---

### Pages Updated — PageHeader Migration

All pages below had hand-rolled `<h1>` + inline styled headers replaced with `<PageHeader>`:

| Page | Eyebrow | Actions |
|------|---------|---------|
| `invoices` | Accounts Receivable | New Invoice button |
| `bills` | Accounts Payable | New Bill button |
| `contacts` | CRM | New Contact button |
| `projects` | — | New Project button |
| `alerts` | — | Critical badge + Run Scan |
| `new-journals` | Accounting | Upload + New Entry |
| `payments` | Receivables | — |
| `month-end` | Accounting | Year/month selects + Refresh |
| `banking` | Banking | Link Account button |
| `documents` | AI Document Processing | — |
| `exchange-rates` | — | — |
| `profile` | — | Log out button |
| `chart-of-accounts` | Ledger structure | Export CSV + Upload CSV |
| `integrations` | — | — |
| `credit-notes` | — | New credit note button |
| `vendor-credits` | — | New vendor credit button |
| `admin` | — | Refresh button |
| `new-dashboard` | Overview | Add widget + period control |
| `reports` | Financial Statements | Export PDF |

---

### Pages Updated — Background Fix (Dot Grid Visibility)

Removed `backgroundColor: 'var(--bg-primary)'` from outer `min-h-screen` wrappers on these pages so the AppLayout `dot-grid` background shows through:

- `invoices`, `bills`, `new-journals`, `month-end`, `contacts`, `journals`, `profile`, `admin`

---

### Component Updates

#### `frontend/components/dashboard/widgets.tsx`
- `WidgetCatalogEntry.icon` type changed from `string` (emoji) to `LucideIcon`
- All 17 widget icons replaced with Lucide components

#### `frontend/components/dashboard/AddWidgetModal.tsx`
- Renders `<widget.icon>` JSX component instead of emoji string
- Cancel/Save buttons migrated to `.btn .btn-secondary` / `.btn .btn-primary`

#### `frontend/components/EnhancedAIConsole.tsx`
- `LOCAL_PROMPTS` and `RESEARCH_PROMPTS` icons changed from emoji strings to Lucide icons
- Render updated to `<prompt.icon className="w-4 h-4">` JSX

#### `frontend/app/integrations/page.tsx`
- `PROVIDER_META.logo` and `ComingSoonCard` logo prop type changed from `string` to `LucideIcon`
- Icon chip removed from page header (decorative, not part of spec)

---

### Landing Page (`frontend/app/page.tsx`)

- Hero heading font size: `clamp(2.5rem, 6vw, 4rem)` → `clamp(3rem, 7vw, 5rem)`
- "without the complexity." font weight: `300` → `400`
- Hero glow: removed `overflow-hidden` wrapper that was clipping the circular blur into a square; glow now bleeds naturally
- Glow size: `600px` → `600px` with `blur-[120px]`, opacity `0.1` light / `0.2` dark
- Mockup labels: removed `textTransform: uppercase` from "Revenue vs Expenses" and "Recent" labels
- KPI value size: `text-lg` → `text-xl`
- CTA section background: `#09090b` → `var(--bg-secondary)`
