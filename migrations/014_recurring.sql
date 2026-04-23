-- Migration 014: Recurring journal/invoice/bill templates
-- Safe to run multiple times (IF NOT EXISTS guards)

CREATE TABLE IF NOT EXISTS recurring_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- What kind of entry to create
    template_type TEXT NOT NULL CHECK (template_type IN ('journal', 'invoice', 'bill')),

    -- Human label for display
    name TEXT NOT NULL,
    description TEXT,

    -- Recurrence schedule
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
    start_date DATE NOT NULL,
    end_date DATE,                          -- NULL = runs indefinitely

    -- Next scheduled run (updated after each execution)
    next_run_date DATE NOT NULL,

    -- Template payload — exact structure depends on template_type:
    --   journal: { memo, lines: [{account_id, debit, credit, description}] }
    --   invoice: { customer_id, due_days, memo, lines: [{description, amount, revenue_account_id}] }
    --   bill:    { vendor_id, due_days, memo, lines: [{description, amount, expense_account_id}] }
    template_data JSONB NOT NULL DEFAULT '{}',

    -- Execution tracking
    last_run_date DATE,
    run_count INTEGER NOT NULL DEFAULT 0,
    last_journal_entry_id UUID,             -- last created entry (for reference)

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_templates_company ON recurring_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_next_run ON recurring_templates(next_run_date) WHERE is_active = TRUE;

-- RLS
ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'recurring_templates' AND policyname = 'company_isolation'
    ) THEN
        CREATE POLICY company_isolation ON recurring_templates
            USING (company_id IN (
                SELECT company_id FROM users WHERE id = auth.uid()
            ));
    END IF;
END$$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_recurring_templates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_recurring_templates_updated_at ON recurring_templates;
CREATE TRIGGER trg_recurring_templates_updated_at
    BEFORE UPDATE ON recurring_templates
    FOR EACH ROW EXECUTE FUNCTION update_recurring_templates_updated_at();
