-- Migration 016: Tax rates configuration
-- Safe to run multiple times (IF NOT EXISTS guards)

CREATE TABLE IF NOT EXISTS tax_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    name TEXT NOT NULL,                     -- e.g. "CA Sales Tax", "Federal GST"
    rate NUMERIC(8,4) NOT NULL,             -- e.g. 0.0875 for 8.75%
    tax_type TEXT NOT NULL DEFAULT 'sales'
        CHECK (tax_type IN ('sales', 'purchase', 'both')),
    jurisdiction TEXT,                      -- e.g. "California", "Federal"
    description TEXT,

    -- GL account to credit (for collected tax liability) or debit (for paid tax)
    tax_account_id UUID REFERENCES accounts(id),

    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_rates_company ON tax_rates(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_rates_default
    ON tax_rates(company_id) WHERE is_default = TRUE AND is_active = TRUE;

ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'tax_rates' AND policyname = 'company_isolation'
    ) THEN
        CREATE POLICY company_isolation ON tax_rates
            USING (company_id IN (
                SELECT company_id FROM users WHERE id = auth.uid()
            ));
    END IF;
END$$;

-- Add tax columns to invoices if not present
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS tax_rate_id UUID REFERENCES tax_rates(id),
    ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,4) DEFAULT 0;

-- Add tax columns to bills if not present
ALTER TABLE bills
    ADD COLUMN IF NOT EXISTS tax_rate_id UUID REFERENCES tax_rates(id),
    ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,4) DEFAULT 0;

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_tax_rates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_tax_rates_updated_at ON tax_rates;
CREATE TRIGGER trg_tax_rates_updated_at
    BEFORE UPDATE ON tax_rates
    FOR EACH ROW EXECUTE FUNCTION update_tax_rates_updated_at();
