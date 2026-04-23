-- Migration 013: AI bank transaction categorization rules
-- Stores rules learned from user corrections — rule-first engine, AI as fallback.
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS categorization_rules (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    account_id              UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

    -- Matching patterns (at least one must be set)
    vendor_pattern          TEXT,           -- exact or prefix match on bank_transactions.name
    merchant_name_pattern   TEXT,           -- match on merchant_name field
    description_contains    TEXT,           -- substring match on name/memo

    -- Optional amount range filter
    amount_min              NUMERIC(15,2),
    amount_max              NUMERIC(15,2),

    -- Direction filter
    direction               TEXT CHECK (direction IN ('in', 'out', 'both')) DEFAULT 'both',

    -- Learning signal
    hit_count               INTEGER NOT NULL DEFAULT 1,
    last_matched_at         TIMESTAMPTZ,

    -- Metadata
    created_by              UUID REFERENCES auth.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS categorization_rules_company_id_idx
    ON categorization_rules (company_id);

CREATE INDEX IF NOT EXISTS categorization_rules_account_id_idx
    ON categorization_rules (account_id);

-- RLS
ALTER TABLE categorization_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY categorization_rules_company_isolation
    ON categorization_rules
    FOR ALL
    USING (
        company_id IN (
            SELECT company_id FROM users WHERE id = auth.uid()
        )
    );

-- Auto-update updated_at
CREATE TRIGGER set_categorization_rules_updated_at
    BEFORE UPDATE ON categorization_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
