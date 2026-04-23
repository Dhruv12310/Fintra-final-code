-- Migration 015: Month-end close checklists + fixed assets
-- Safe to run multiple times (IF NOT EXISTS guards)

-- ── Fixed Assets ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fixed_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Asset identity
    name TEXT NOT NULL,
    description TEXT,
    asset_code TEXT,                        -- optional internal code e.g. "FA-001"

    -- Cost & valuation
    purchase_date DATE NOT NULL,
    cost NUMERIC(15,2) NOT NULL,
    salvage_value NUMERIC(15,2) NOT NULL DEFAULT 0,
    useful_life_months INTEGER NOT NULL,    -- e.g. 60 = 5 years

    -- Depreciation
    depreciation_method TEXT NOT NULL DEFAULT 'straight_line'
        CHECK (depreciation_method IN ('straight_line', 'declining_balance', 'units_of_production')),
    accumulated_depreciation NUMERIC(15,2) NOT NULL DEFAULT 0,
    last_depreciation_date DATE,

    -- GL linkage
    asset_account_id UUID REFERENCES accounts(id),          -- DR here on purchase
    depreciation_account_id UUID REFERENCES accounts(id),   -- DR Depreciation Expense
    accumulated_account_id UUID REFERENCES accounts(id),    -- CR Accumulated Depreciation

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    disposed_at DATE,

    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_company ON fixed_assets(company_id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_active ON fixed_assets(company_id, is_active) WHERE is_active = TRUE;

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'fixed_assets' AND policyname = 'company_isolation'
    ) THEN
        CREATE POLICY company_isolation ON fixed_assets
            USING (company_id IN (
                SELECT company_id FROM users WHERE id = auth.uid()
            ));
    END IF;
END$$;

-- ── Close Checklists ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS close_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- Ordered step results stored as JSONB array:
    -- [{ step_number, title, status: pass|fail|warn|skip, detail, completed_at }]
    steps JSONB NOT NULL DEFAULT '[]',

    overall_status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (overall_status IN ('in_progress', 'completed', 'failed')),

    -- Final outcomes
    period_locked BOOLEAN NOT NULL DEFAULT FALSE,
    net_income NUMERIC(15,2),

    -- Actor
    initiated_by UUID REFERENCES auth.users(id),
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_close_checklists_company ON close_checklists(company_id);
CREATE INDEX IF NOT EXISTS idx_close_checklists_period ON close_checklists(company_id, period_start);

ALTER TABLE close_checklists ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'close_checklists' AND policyname = 'company_isolation'
    ) THEN
        CREATE POLICY company_isolation ON close_checklists
            USING (company_id IN (
                SELECT company_id FROM users WHERE id = auth.uid()
            ));
    END IF;
END$$;

-- Auto-update triggers
CREATE OR REPLACE FUNCTION update_fixed_assets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_fixed_assets_updated_at ON fixed_assets;
CREATE TRIGGER trg_fixed_assets_updated_at
    BEFORE UPDATE ON fixed_assets
    FOR EACH ROW EXECUTE FUNCTION update_fixed_assets_updated_at();

CREATE OR REPLACE FUNCTION update_close_checklists_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_close_checklists_updated_at ON close_checklists;
CREATE TRIGGER trg_close_checklists_updated_at
    BEFORE UPDATE ON close_checklists
    FOR EACH ROW EXECUTE FUNCTION update_close_checklists_updated_at();
