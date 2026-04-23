-- Run this in Supabase SQL Editor
-- General Ledger invariants: source-doc references, posted-entry immutability,
-- reversing-entry pattern, and the SQL functions that back the GL report.
--
-- Principles enforced:
--   1. Money is NUMERIC(15,2) (already true in newschema). No floats.
--   2. Every posted entry must be balanced (db-level CHECK).
--   3. Posted entries are immutable. Lines cannot be UPDATEd / DELETEd, and
--      financial fields on the parent entry cannot change. Status may move
--      posted -> void to support reversing entries.
--   4. Every entry can carry a (source_type, source_id) reference back to
--      the document that produced it (invoice, bill, payment, etc.).
--   5. Voiding posts a NEW reversing entry that mirror-flips debits/credits
--      and links back via reverses_entry_id. The original entry stays intact.

-- ========================================================================
-- 1. Add columns
-- ========================================================================

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id   UUID,
  ADD COLUMN IF NOT EXISTS reverses_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_source
  ON journal_entries(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_reverses
  ON journal_entries(reverses_entry_id);

-- ========================================================================
-- 2. Balanced-on-post check
-- ========================================================================

DO $$ BEGIN
  ALTER TABLE journal_entries
    ADD CONSTRAINT je_posted_must_be_balanced
    CHECK (status <> 'posted' OR is_balanced);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ========================================================================
-- 3. Immutability triggers
-- ========================================================================

-- Block UPDATE / DELETE on journal_lines whose parent entry is posted.
CREATE OR REPLACE FUNCTION je_lines_block_when_posted()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF EXISTS (
      SELECT 1 FROM journal_entries je
       WHERE je.id = OLD.journal_entry_id
         AND je.status = 'posted'
    ) THEN
      RAISE EXCEPTION 'Cannot delete lines on a posted journal entry (id=%). Void the entry to reverse it.', OLD.journal_entry_id;
    END IF;
    RETURN OLD;
  ELSE
    IF EXISTS (
      SELECT 1 FROM journal_entries je
       WHERE je.id = NEW.journal_entry_id
         AND je.status = 'posted'
    ) THEN
      RAISE EXCEPTION 'Cannot update lines on a posted journal entry (id=%). Void the entry to reverse it.', NEW.journal_entry_id;
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_je_lines_block_when_posted ON journal_lines;
CREATE TRIGGER trg_je_lines_block_when_posted
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION je_lines_block_when_posted();

-- Block edits to financial fields on a posted entry. Allowed transitions:
--   - status: posted -> void (so a void can flip the flag while the
--     reversing entry posts)
--   - voided_by, voided_at, void_reason: may be set when status flips to void
-- Anything else (totals, dates, source, lines via FK count, etc.) is locked.
CREATE OR REPLACE FUNCTION je_block_post_edits()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    IF NEW.entry_date IS DISTINCT FROM OLD.entry_date
       OR NEW.total_debit IS DISTINCT FROM OLD.total_debit
       OR NEW.total_credit IS DISTINCT FROM OLD.total_credit
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.source_type IS DISTINCT FROM OLD.source_type
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.reverses_entry_id IS DISTINCT FROM OLD.reverses_entry_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Cannot edit financial fields on a posted journal entry (id=%). Void it to reverse.', OLD.id;
    END IF;
    IF NEW.status NOT IN ('posted', 'void') THEN
      RAISE EXCEPTION 'Posted entries can only transition to void (id=%, attempted=%).', OLD.id, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_je_block_post_edits ON journal_entries;
CREATE TRIGGER trg_je_block_post_edits
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_block_post_edits();

-- ========================================================================
-- 4. General Ledger report functions
-- ========================================================================

-- Per-account totals + ending balance for the period (left-rail data).
CREATE OR REPLACE FUNCTION rpt_general_ledger_accounts(
  p_company_id UUID,
  p_start DATE,
  p_end DATE
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type account_type,
  account_subtype account_subtype,
  opening_balance NUMERIC,
  period_debit NUMERIC,
  period_credit NUMERIC,
  ending_balance NUMERIC
) AS $$
  WITH posted_lines AS (
    SELECT jl.account_id, jl.debit, jl.credit, je.entry_date
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE je.company_id = p_company_id
       AND je.status = 'posted'
  ),
  opening AS (
    SELECT pl.account_id,
           COALESCE(SUM(pl.debit - pl.credit), 0) AS bal
      FROM posted_lines pl
     WHERE pl.entry_date < p_start
     GROUP BY pl.account_id
  ),
  period AS (
    SELECT pl.account_id,
           COALESCE(SUM(pl.debit), 0)  AS dbt,
           COALESCE(SUM(pl.credit), 0) AS crd
      FROM posted_lines pl
     WHERE pl.entry_date BETWEEN p_start AND p_end
     GROUP BY pl.account_id
  )
  SELECT
    a.id                                                                AS account_id,
    a.account_code                                                      AS account_code,
    a.account_name                                                      AS account_name,
    a.account_type                                                      AS account_type,
    a.account_subtype                                                   AS account_subtype,
    COALESCE(o.bal, 0) + COALESCE(a.opening_balance, 0)                 AS opening_balance,
    COALESCE(p.dbt, 0)                                                  AS period_debit,
    COALESCE(p.crd, 0)                                                  AS period_credit,
    COALESCE(o.bal, 0) + COALESCE(a.opening_balance, 0)
      + COALESCE(p.dbt, 0) - COALESCE(p.crd, 0)                         AS ending_balance
  FROM accounts a
  LEFT JOIN opening o ON o.account_id = a.id
  LEFT JOIN period  p ON p.account_id = a.id
  WHERE a.company_id = p_company_id
    AND a.is_active = TRUE
  ORDER BY a.account_code;
$$ LANGUAGE sql STABLE;

-- Transactions for a single account in a period, with running balance.
CREATE OR REPLACE FUNCTION rpt_general_ledger(
  p_company_id UUID,
  p_account_id UUID,
  p_start DATE,
  p_end DATE
)
RETURNS TABLE (
  line_id UUID,
  entry_id UUID,
  entry_date DATE,
  journal_number TEXT,
  memo TEXT,
  description TEXT,
  source TEXT,
  source_type TEXT,
  source_id UUID,
  reverses_entry_id UUID,
  contact_id UUID,
  contact_name TEXT,
  debit NUMERIC,
  credit NUMERIC,
  running_balance NUMERIC
) AS $$
  WITH opening AS (
    SELECT
      COALESCE(a.opening_balance, 0)
        + COALESCE((
            SELECT SUM(jl2.debit - jl2.credit)
              FROM journal_lines jl2
              JOIN journal_entries je2 ON je2.id = jl2.journal_entry_id
             WHERE jl2.account_id = p_account_id
               AND je2.company_id = p_company_id
               AND je2.status = 'posted'
               AND je2.entry_date < p_start
          ), 0) AS bal
      FROM accounts a
     WHERE a.id = p_account_id
       AND a.company_id = p_company_id
  )
  SELECT
    jl.id                                      AS line_id,
    je.id                                      AS entry_id,
    je.entry_date                              AS entry_date,
    je.journal_number                          AS journal_number,
    je.memo                                    AS memo,
    jl.description                             AS description,
    je.source::text                            AS source,
    je.source_type                             AS source_type,
    je.source_id                               AS source_id,
    je.reverses_entry_id                       AS reverses_entry_id,
    jl.contact_id                              AS contact_id,
    c.display_name                             AS contact_name,
    jl.debit                                   AS debit,
    jl.credit                                  AS credit,
    (SELECT bal FROM opening)
      + SUM(jl.debit - jl.credit) OVER (
          ORDER BY je.entry_date, je.journal_number, jl.line_number
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )                                       AS running_balance
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  LEFT JOIN contacts c ON c.id = jl.contact_id
  WHERE jl.account_id = p_account_id
    AND je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.entry_date BETWEEN p_start AND p_end
  ORDER BY je.entry_date, je.journal_number, jl.line_number;
$$ LANGUAGE sql STABLE;

NOTIFY pgrst, 'reload schema';
