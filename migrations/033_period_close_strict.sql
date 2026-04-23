-- Run this in Supabase SQL Editor
-- Tighten the period-close trigger so the legacy is_closed flag also blocks
-- new posted entries. The original trigger from 031 only checked the three
-- module locks (sales_locked / purchases_locked / financial_locked), so the
-- existing month-end checklist (which sets only is_closed) wasn't enforced.
--
-- Treat is_closed = TRUE as "everything locked" — equivalent to all three
-- module flags being on.

CREATE OR REPLACE FUNCTION je_block_post_in_locked_period()
RETURNS TRIGGER AS $$
DECLARE
  v_module TEXT := period_module_for_source(NEW.source_type);
BEGIN
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
         ap.is_closed = TRUE
         OR (v_module = 'sales'      AND ap.sales_locked)
         OR (v_module = 'purchases'  AND ap.purchases_locked)
         OR (v_module = 'financial'  AND ap.financial_locked)
       )
  ) THEN
    RAISE EXCEPTION 'Cannot post entry on % into a closed period (module: %).',
      NEW.entry_date, v_module;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
