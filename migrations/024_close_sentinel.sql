-- Migration 024: Vertical Close framework + Proactive Sentinel
-- Run in Supabase SQL Editor

-- ── 1. Projects (Construction WIP / vertical close scaffolding) ────────────

CREATE TABLE IF NOT EXISTS projects (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    project_number          TEXT,
    customer_contact_id     UUID REFERENCES contacts(id),
    contract_value          NUMERIC(14,2) NOT NULL DEFAULT 0,
    estimated_total_costs   NUMERIC(14,2) NOT NULL DEFAULT 0,
    retention_pct           NUMERIC(5,2) DEFAULT 0,
    start_date              DATE,
    end_date                DATE,
    status                  TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','completed','cancelled')),
    notes                   TEXT,
    deleted_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_company_status
    ON projects(company_id, status) WHERE deleted_at IS NULL;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'company_isolation'
    ) THEN
        CREATE POLICY company_isolation ON projects
            USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
    END IF;
END$$;

-- ── 2. Project costs ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_costs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    cost_category   TEXT NOT NULL DEFAULT 'other'
                        CHECK (cost_category IN ('labor','materials','subcontractor','equipment','other')),
    amount          NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    date            DATE NOT NULL,
    description     TEXT,
    source_type     TEXT CHECK (source_type IN ('bill','expense_report','payroll','manual')),
    source_id       UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_costs_project_date
    ON project_costs(project_id, date);
CREATE INDEX IF NOT EXISTS idx_project_costs_company
    ON project_costs(company_id);

ALTER TABLE project_costs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'project_costs' AND policyname = 'company_isolation'
    ) THEN
        CREATE POLICY company_isolation ON project_costs
            USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
    END IF;
END$$;

-- ── 3. WIP entries (snapshot per period-close) ─────────────────────────────

CREATE TABLE IF NOT EXISTS wip_entries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    period_end              DATE NOT NULL,
    costs_to_date           NUMERIC(14,2) NOT NULL DEFAULT 0,
    pct_complete            NUMERIC(5,2),
    earned_revenue          NUMERIC(14,2),
    billed_revenue          NUMERIC(14,2) DEFAULT 0,
    over_under_billing      NUMERIC(14,2),
    journal_entry_id        UUID REFERENCES journal_entries(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, period_end)
);

CREATE INDEX IF NOT EXISTS idx_wip_entries_company_period
    ON wip_entries(company_id, period_end);

ALTER TABLE wip_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'wip_entries' AND policyname = 'company_isolation'
    ) THEN
        CREATE POLICY company_isolation ON wip_entries
            USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
    END IF;
END$$;

-- ── 4. Amortization schedules (prepaids; used by close engine) ─────────────

CREATE TABLE IF NOT EXISTS amortization_schedules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    source_bill_id      UUID REFERENCES bills(id),
    expense_account_id  UUID NOT NULL REFERENCES accounts(id),
    prepaid_account_id  UUID NOT NULL REFERENCES accounts(id),
    original_amount     NUMERIC(14,2) NOT NULL CHECK (original_amount > 0),
    amortized_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    method              TEXT NOT NULL DEFAULT 'straight_line',
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','completed','cancelled')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amortization_company_status
    ON amortization_schedules(company_id, status);

ALTER TABLE amortization_schedules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'amortization_schedules' AND policyname = 'company_isolation'
    ) THEN
        CREATE POLICY company_isolation ON amortization_schedules
            USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
    END IF;
END$$;

-- ── 5. Close checklist state machine upgrade ───────────────────────────────

ALTER TABLE close_checklists DROP CONSTRAINT IF EXISTS close_checklists_overall_status_check;
ALTER TABLE close_checklists ADD CONSTRAINT close_checklists_overall_status_check
    CHECK (overall_status IN (
        'in_progress','vertical_review','controller_review',
        'approved','locked','failed','completed','completed_with_warnings'
    ));

ALTER TABLE close_checklists
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS flux_narrative TEXT,
    ADD COLUMN IF NOT EXISTS industry_data JSONB DEFAULT '{}';

-- Migrate existing 'completed' rows to 'locked' (they were fully closed)
UPDATE close_checklists SET overall_status = 'locked'
    WHERE overall_status = 'completed' AND period_locked = TRUE;

-- ── 6. Sentinel alerts inbox ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_alerts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    trigger_name        TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'info'
                            CHECK (severity IN ('info','warning','critical')),
    title               TEXT NOT NULL,
    body                TEXT,
    related_entity_type TEXT,
    related_entity_id   UUID,
    action_payload      JSONB DEFAULT '{}',
    status              TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','accepted','dismissed','snoozed')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,
    snoozed_until       TIMESTAMPTZ,
    dedupe_key          TEXT,
    UNIQUE (company_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_alerts_company_open
    ON agent_alerts(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_alerts_trigger
    ON agent_alerts(company_id, trigger_name);

ALTER TABLE agent_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'agent_alerts' AND policyname = 'company_isolation'
    ) THEN
        CREATE POLICY company_isolation ON agent_alerts
            USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
    END IF;
END$$;

-- ── 7. Sentinel watermark cursors ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sentinel_cursors (
    trigger_name        TEXT NOT NULL,
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    last_scanned_at     TIMESTAMPTZ,
    last_scanned_id     UUID,
    PRIMARY KEY (trigger_name, company_id)
);

-- ── 8. Notifications sent (dedup + idempotency) ────────────────────────────

CREATE TABLE IF NOT EXISTS notifications_sent (
    alert_id        UUID NOT NULL REFERENCES agent_alerts(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL CHECK (channel IN ('email','slack')),
    dispatched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (alert_id, channel)
);

-- ── 9. Extend bills status to include held_duplicate ──────────────────────
-- bills.status is a PostgreSQL enum type (bill_status), not a CHECK constraint.
-- Use ALTER TYPE to add the new value safely.

DO $$ BEGIN
    ALTER TYPE bill_status ADD VALUE IF NOT EXISTS 'held_duplicate';
EXCEPTION WHEN others THEN
    -- If bill_status doesn't exist as an enum (schema variation), do nothing
    NULL;
END$$;

-- ── 10. company_settings JSONB for notification config ────────────────────
-- (Only add if column doesn't already exist)

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

-- ── 11. Add project_id to invoices and bills (optional FK) ────────────────

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
ALTER TABLE bills ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);

CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bills_project ON bills(project_id) WHERE project_id IS NOT NULL;

-- ── Triggers: updated_at ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_projects_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_projects_updated_at();

CREATE OR REPLACE FUNCTION update_amortization_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_amortization_updated_at ON amortization_schedules;
CREATE TRIGGER trg_amortization_updated_at
    BEFORE UPDATE ON amortization_schedules
    FOR EACH ROW EXECUTE FUNCTION update_amortization_updated_at();
