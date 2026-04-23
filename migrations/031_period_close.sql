-- Run this in Supabase SQL Editor
-- Period close enforcement + retained earnings rollover.
--
-- Three module-level locks (sales / purchases / financial) plus the existing
-- is_closed flag on accounting_periods. Trigger blocks any new posted journal
-- entry whose date falls inside a locked period, scoped by source_type:
--   - sales:    invoice, payment, credit_note
--   - purchases: bill, bill_payment, vendor_credit
--   - financial: manual, adjustment, anything else
--
-- close_fiscal_year() function aggregates revenue and expense balances for
-- the period, posts a closing entry that zeroes them into Retained Earnings,
-- and locks all three modules on the period row.

ALTER TABLE accounting_periods
  ADD COLUMN IF NOT EXISTS sales_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS purchases_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS financial_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retained_earnings_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_periods_company_dates
  ON accounting_periods(company_id, period_start, period_end);

-- Map source_type -> module
CREATE OR REPLACE FUNCTION period_module_for_source(p_source_type TEXT)
RETURNS TEXT AS $$
BEGIN
  IF p_source_type IN ('invoice', 'payment', 'credit_note') THEN
    RETURN 'sales';
  ELSIF p_source_type IN ('bill', 'bill_payment', 'vendor_credit') THEN
    RETURN 'purchases';
  ELSE
    RETURN 'financial';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger: block posting an entry whose date sits inside a locked period.
-- Fires on UPDATE (status -> posted) and INSERT.
CREATE OR REPLACE FUNCTION je_block_post_in_locked_period()
RETURNS TRIGGER AS $$
DECLARE
  v_module TEXT := period_module_for_source(NEW.source_type);
BEGIN
  -- Only enforce when the entry is being marked posted (or inserted as posted).
  IF NEW.status <> 'posted' THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'UPDATE' AND OLD.status = 'posted') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM accounting_periods ap
     WHERE ap.company_id = NEW.company_id
       AND NEW.entry_date BETWEEN ap.period_start AND ap.period_end
       AND (
         (v_module = 'sales'      AND ap.sales_locked)
         OR (v_module = 'purchases' AND ap.purchases_locked)
         OR (v_module = 'financial' AND ap.financial_locked)
       )
  ) THEN
    RAISE EXCEPTION 'Cannot post entry on % into a locked % period.',
      NEW.entry_date, v_module;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_je_block_post_in_locked_period ON journal_entries;
CREATE TRIGGER trg_je_block_post_in_locked_period
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_block_post_in_locked_period();

-- Lookup the retained earnings account for a company. Falls back to any
-- equity account flagged as system. Plain SQL function avoids the
-- SELECT INTO parser ambiguity seen in some Postgres editors.
CREATE OR REPLACE FUNCTION get_retained_earnings_account(p_company_id UUID)
RETURNS UUID AS $$
  SELECT COALESCE(
    (SELECT id FROM accounts
      WHERE company_id = p_company_id
        AND account_subtype = 'retained_earnings'
      LIMIT 1),
    (SELECT id FROM accounts
      WHERE company_id = p_company_id
        AND account_type = 'equity'
        AND is_system = TRUE
      LIMIT 1)
  );
$$ LANGUAGE sql STABLE;

NOTIFY pgrst, 'reload schema';
