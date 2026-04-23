-- Run this in Supabase SQL Editor
-- Multi-currency foundation: base currency per company, manual exchange
-- rates, currency + fx_rate carried on journal lines, auto-detect for FX
-- gain/loss postings.
--
-- Posting in foreign currency:
--   - The line carries its original currency_code and the fx_rate used at
--     posting time.
--   - base_amount_debit / base_amount_credit are computed via generated
--     columns in base currency, so reports always sum in base.
--   - On settlement (e.g. paying a foreign invoice), the difference between
--     posting rate and settlement rate posts to FX gain/loss (handled in
--     the posting service in a follow-up).

-- ========================================================================
-- 1. Companies: base currency
-- ========================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS base_currency TEXT DEFAULT 'USD';

-- ========================================================================
-- 2. Exchange rates
-- ========================================================================

CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate NUMERIC(20, 10) NOT NULL CHECK (rate > 0),
  as_of_date DATE NOT NULL,
  source TEXT DEFAULT 'manual',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, base_currency, quote_currency, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
  ON exchange_rates(company_id, base_currency, quote_currency, as_of_date DESC);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY company_isolation_policy ON exchange_rates
    FOR ALL USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ========================================================================
-- 3. Journal lines: currency + fx_rate + base amounts
-- ========================================================================

ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS currency_code TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(20, 10) DEFAULT 1;

-- Generated columns: amount in base currency = original * fx_rate.
-- (Postgres requires the expression to be deterministic and reference only
-- columns from the same row, both true here.)
DO $$ BEGIN
  ALTER TABLE journal_lines
    ADD COLUMN base_amount_debit  NUMERIC(15, 2)
      GENERATED ALWAYS AS (ROUND(debit  * COALESCE(fx_rate, 1), 2)) STORED;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines
    ADD COLUMN base_amount_credit NUMERIC(15, 2)
      GENERATED ALWAYS AS (ROUND(credit * COALESCE(fx_rate, 1), 2)) STORED;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ========================================================================
-- 4. Look up the most recent rate at or before a given date.
-- ========================================================================

CREATE OR REPLACE FUNCTION get_fx_rate(
  p_company_id UUID,
  p_base TEXT,
  p_quote TEXT,
  p_as_of DATE
)
RETURNS NUMERIC AS $$
  SELECT rate
    FROM exchange_rates
   WHERE company_id = p_company_id
     AND base_currency = p_base
     AND quote_currency = p_quote
     AND as_of_date <= p_as_of
   ORDER BY as_of_date DESC
   LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ========================================================================
-- 5. FX gain/loss account lookup (account_subtype = 'other_income' or
-- 'other_expense' with name containing 'fx' or 'exchange'). Falls back to
-- NULL; the caller decides what to do.
-- ========================================================================

CREATE OR REPLACE FUNCTION get_fx_gain_loss_account(p_company_id UUID)
RETURNS UUID AS $$
  SELECT id
    FROM accounts
   WHERE company_id = p_company_id
     AND (
       LOWER(account_name) LIKE '%fx%'
       OR LOWER(account_name) LIKE '%exchange%'
       OR LOWER(account_name) LIKE '%foreign currency%'
     )
   ORDER BY account_code
   LIMIT 1;
$$ LANGUAGE sql STABLE;

NOTIFY pgrst, 'reload schema';
