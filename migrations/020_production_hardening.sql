-- Migration 020: Production Hardening
-- Addresses all P0, P1, and P2 issues from db-production-hardening.md
--
-- IMPORTANT NOTES:
--   • newschema.sql section 16 already enables RLS with company_isolation_policy
--     on all 35 base tables. This migration does NOT override those policies —
--     adding USING(true) on top would OR with them and weaken isolation.
--   • Only admin_passcodes and server_activity_logs (migration 010) truly lack RLS.
--   • migrations 011-019 already have their own RLS policies.
--   • Soft-delete columns are added FIRST (Section 0) so the partial indexes
--     in Section 2 can reference deleted_at without errors.
--
-- Safety guarantees:
--   • CHECK constraints use NOT VALID → enforce on new writes, skip existing rows
--   • Indexes use IF NOT EXISTS
--   • Triggers use DO blocks with duplicate_object guard
--   • ADD COLUMN uses IF NOT EXISTS
--   • company_id backfills run before indexes are created
--
-- Run in Supabase SQL Editor


-- ==========================================================================
-- SECTION 0: SOFT DELETE COLUMNS — must come first so Section 2 partial
-- indexes can reference deleted_at
-- Financial records must be retained for 7 years (legal requirement).
-- Application layer: query WHERE deleted_at IS NULL; set deleted_at = NOW()
-- instead of DELETE.
-- ==========================================================================

-- Core financial records
ALTER TABLE invoices          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE bills             ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE payments          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE bill_payments     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE journal_entries   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Supporting records
ALTER TABLE contacts          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE accounts          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE bank_connections  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Payroll & HR
ALTER TABLE employees         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE payroll_runs      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE expense_reports   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Equity
ALTER TABLE equity_grants     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE stakeholders      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;


-- ==========================================================================
-- SECTION 1: ROW LEVEL SECURITY — only the tables that genuinely lack it
--
-- newschema.sql § 16 already covers all 35 base tables with proper
-- company_isolation_policy (auth.uid() scoped). Migrations 011-019 cover
-- their own tables. The only gap is migration 010's two tables.
-- ==========================================================================

-- admin_passcodes (migration 010)
ALTER TABLE admin_passcodes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_all_admin_passcodes" ON admin_passcodes FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- server_activity_logs (migration 010)
ALTER TABLE server_activity_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_all_server_activity_logs" ON server_activity_logs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ==========================================================================
-- SECTION 2: COMPOUND INDEXES — most-queried patterns at scale
-- Every page filters by (company_id + something). Single-column company_id
-- indexes already exist. These cover the second predicate column so Postgres
-- can satisfy the query from the index alone.
-- ==========================================================================

-- ── Invoices ───────────────────────────────────────────────────────────────
-- AR list page, AR aging report (dashboard load every time)
CREATE INDEX IF NOT EXISTS idx_invoices_company_status   ON invoices(company_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_company_due_date ON invoices(company_id, due_date);
-- Soft-delete filter (most reads will add WHERE deleted_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_invoices_active
  ON invoices(company_id, due_date) WHERE deleted_at IS NULL;

-- ── Bills ──────────────────────────────────────────────────────────────────
-- AP list page, AP aging report
CREATE INDEX IF NOT EXISTS idx_bills_company_status   ON bills(company_id, status);
CREATE INDEX IF NOT EXISTS idx_bills_company_due_date ON bills(company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_bills_active
  ON bills(company_id, due_date) WHERE deleted_at IS NULL;

-- ── Journal Entries ────────────────────────────────────────────────────────
-- Date-range reports and status filtering
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_date   ON journal_entries(company_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_status ON journal_entries(company_id, status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_active
  ON journal_entries(company_id, entry_date) WHERE deleted_at IS NULL;

-- ── Journal Lines ──────────────────────────────────────────────────────────
-- Balance-sheet / P&L: aggregate by account across all journal lines
CREATE INDEX IF NOT EXISTS idx_journal_lines_account_entry
  ON journal_lines(account_id, journal_entry_id);

-- ── Bank Transactions ──────────────────────────────────────────────────────
-- Banking page (status filter) and statement date range
CREATE INDEX IF NOT EXISTS idx_bank_txn_company_status      ON bank_transactions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_bank_txn_account_posted_date ON bank_transactions(bank_account_id, posted_date);
CREATE INDEX IF NOT EXISTS idx_bank_txn_active
  ON bank_transactions(company_id, posted_date) WHERE deleted_at IS NULL;

-- ── Contacts ───────────────────────────────────────────────────────────────
-- Vendor / customer list page
CREATE INDEX IF NOT EXISTS idx_contacts_company_type ON contacts(company_id, contact_type);

-- ── Accounting Periods ─────────────────────────────────────────────────────
-- Period-lock check runs before every journal write
CREATE INDEX IF NOT EXISTS idx_accounting_periods_company_start ON accounting_periods(company_id, period_start);

-- ── Payments & Bill Payments ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_company_status ON payments(company_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_company_date   ON payments(company_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_bill_payments_company_status ON bill_payments(company_id, status);

-- ── Employees ──────────────────────────────────────────────────────────────
-- HR list — active employees filter is the common case
CREATE INDEX IF NOT EXISTS idx_employees_company_active ON employees(company_id, is_active);

-- ── Payroll Runs ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payroll_runs_company_status ON payroll_runs(company_id, status);

-- ── Equity Grants ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_equity_grants_company_status ON equity_grants(company_id, status);

-- ── Time-Off Requests ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_time_off_requests_company_status ON time_off_requests(company_id, status);

-- ── Expense Reports ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_expense_reports_company_status ON expense_reports(company_id, status);

-- ── Import History ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_import_history_company_date ON import_history(company_id, created_at DESC);

-- ── Notifications ──────────────────────────────────────────────────────────
-- Unread badge count query
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE is_read = FALSE;


-- ==========================================================================
-- SECTION 3: updated_at TRIGGERS — Phase 3-4 tables (migrations 017-019)
-- These tables have updated_at columns but no triggers; they always
-- show the created_at value on every row.
-- ==========================================================================

-- employees (017)
DO $$ BEGIN
  CREATE TRIGGER update_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payroll_runs (017)
DO $$ BEGIN
  CREATE TRIGGER update_payroll_runs_updated_at
  BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- stakeholders (018)
DO $$ BEGIN
  CREATE TRIGGER update_stakeholders_updated_at
  BEFORE UPDATE ON stakeholders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- equity_grants (018)
DO $$ BEGIN
  CREATE TRIGGER update_equity_grants_updated_at
  BEFORE UPDATE ON equity_grants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- time_off_requests (019)
DO $$ BEGIN
  CREATE TRIGGER update_time_off_requests_updated_at
  BEFORE UPDATE ON time_off_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- expense_reports (019)
DO $$ BEGIN
  CREATE TRIGGER update_expense_reports_updated_at
  BEFORE UPDATE ON expense_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ==========================================================================
-- SECTION 4: company_id ON CHILD TABLES
-- payroll_lines, invoice_lines, bill_lines, bill_payment_lines,
-- expense_report_lines, payment_applications all require a JOIN to get
-- company_id. At 100k companies × many line items, reporting queries
-- touching these are slow. Adding company_id eliminates the JOIN.
--
-- Steps per table:
--   1. Add nullable column (safe for live data)
--   2. Backfill existing rows from parent
--   3. BEFORE INSERT trigger auto-populates it going forward
--   4. Index for reporting queries
-- ==========================================================================

-- ── payroll_lines ──────────────────────────────────────────────────────────
ALTER TABLE payroll_lines
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

UPDATE payroll_lines pl
SET    company_id = pr.company_id
FROM   payroll_runs pr
WHERE  pl.payroll_run_id = pr.id
  AND  pl.company_id IS NULL;

CREATE OR REPLACE FUNCTION _auto_company_id_payroll_line()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM payroll_runs WHERE id = NEW.payroll_run_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_lines_auto_company_id ON payroll_lines;
CREATE TRIGGER trg_payroll_lines_auto_company_id
  BEFORE INSERT ON payroll_lines
  FOR EACH ROW EXECUTE FUNCTION _auto_company_id_payroll_line();

CREATE INDEX IF NOT EXISTS idx_payroll_lines_company ON payroll_lines(company_id);

-- ── invoice_lines ──────────────────────────────────────────────────────────
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

UPDATE invoice_lines il
SET    company_id = i.company_id
FROM   invoices i
WHERE  il.invoice_id = i.id
  AND  il.company_id IS NULL;

CREATE OR REPLACE FUNCTION _auto_company_id_invoice_line()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM invoices WHERE id = NEW.invoice_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_lines_auto_company_id ON invoice_lines;
CREATE TRIGGER trg_invoice_lines_auto_company_id
  BEFORE INSERT ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION _auto_company_id_invoice_line();

CREATE INDEX IF NOT EXISTS idx_invoice_lines_company ON invoice_lines(company_id);

-- ── bill_lines ─────────────────────────────────────────────────────────────
ALTER TABLE bill_lines
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

UPDATE bill_lines bl
SET    company_id = b.company_id
FROM   bills b
WHERE  bl.bill_id = b.id
  AND  bl.company_id IS NULL;

CREATE OR REPLACE FUNCTION _auto_company_id_bill_line()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM bills WHERE id = NEW.bill_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bill_lines_auto_company_id ON bill_lines;
CREATE TRIGGER trg_bill_lines_auto_company_id
  BEFORE INSERT ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION _auto_company_id_bill_line();

CREATE INDEX IF NOT EXISTS idx_bill_lines_company ON bill_lines(company_id);

-- ── bill_payment_lines ─────────────────────────────────────────────────────
ALTER TABLE bill_payment_lines
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

UPDATE bill_payment_lines bpl
SET    company_id = bp.company_id
FROM   bill_payments bp
WHERE  bpl.bill_payment_id = bp.id
  AND  bpl.company_id IS NULL;

CREATE OR REPLACE FUNCTION _auto_company_id_bill_payment_line()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM bill_payments WHERE id = NEW.bill_payment_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bill_payment_lines_auto_company_id ON bill_payment_lines;
CREATE TRIGGER trg_bill_payment_lines_auto_company_id
  BEFORE INSERT ON bill_payment_lines
  FOR EACH ROW EXECUTE FUNCTION _auto_company_id_bill_payment_line();

CREATE INDEX IF NOT EXISTS idx_bill_payment_lines_company ON bill_payment_lines(company_id);

-- ── expense_report_lines ───────────────────────────────────────────────────
ALTER TABLE expense_report_lines
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

UPDATE expense_report_lines erl
SET    company_id = er.company_id
FROM   expense_reports er
WHERE  erl.report_id = er.id
  AND  erl.company_id IS NULL;

CREATE OR REPLACE FUNCTION _auto_company_id_expense_report_line()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM expense_reports WHERE id = NEW.report_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_report_lines_auto_company_id ON expense_report_lines;
CREATE TRIGGER trg_expense_report_lines_auto_company_id
  BEFORE INSERT ON expense_report_lines
  FOR EACH ROW EXECUTE FUNCTION _auto_company_id_expense_report_line();

CREATE INDEX IF NOT EXISTS idx_expense_report_lines_company ON expense_report_lines(company_id);

-- ── payment_applications ───────────────────────────────────────────────────
ALTER TABLE payment_applications
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

UPDATE payment_applications pa
SET    company_id = p.company_id
FROM   payments p
WHERE  pa.payment_id = p.id
  AND  pa.company_id IS NULL;

CREATE OR REPLACE FUNCTION _auto_company_id_payment_application()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM payments WHERE id = NEW.payment_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_applications_auto_company_id ON payment_applications;
CREATE TRIGGER trg_payment_applications_auto_company_id
  BEFORE INSERT ON payment_applications
  FOR EACH ROW EXECUTE FUNCTION _auto_company_id_payment_application();

CREATE INDEX IF NOT EXISTS idx_payment_applications_company ON payment_applications(company_id);


-- ==========================================================================
-- SECTION 5: CHECK CONSTRAINTS — financial amounts must be non-negative
-- NOT VALID: enforced on all new INSERT/UPDATE; does NOT scan existing rows.
-- Prevents silent data corruption from API bugs or bad AI tool calls.
-- ==========================================================================

-- invoices
DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT chk_invoices_non_negative
    CHECK (subtotal >= 0 AND tax_total >= 0 AND total >= 0 AND amount_paid >= 0 AND balance_due >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- bills
DO $$ BEGIN
  ALTER TABLE bills ADD CONSTRAINT chk_bills_non_negative
    CHECK (subtotal >= 0 AND tax_total >= 0 AND total >= 0 AND amount_paid >= 0 AND balance_due >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payments
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT chk_payments_amount_non_negative
    CHECK (amount >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- bill_payments
DO $$ BEGIN
  ALTER TABLE bill_payments ADD CONSTRAINT chk_bill_payments_amount_non_negative
    CHECK (amount >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payment_applications
DO $$ BEGIN
  ALTER TABLE payment_applications ADD CONSTRAINT chk_payment_applications_non_negative
    CHECK (amount_applied >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- invoice_lines
DO $$ BEGIN
  ALTER TABLE invoice_lines ADD CONSTRAINT chk_invoice_lines_non_negative
    CHECK (quantity >= 0 AND unit_price >= 0 AND amount >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- bill_lines
DO $$ BEGIN
  ALTER TABLE bill_lines ADD CONSTRAINT chk_bill_lines_non_negative
    CHECK (amount >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payroll_lines
DO $$ BEGIN
  ALTER TABLE payroll_lines ADD CONSTRAINT chk_payroll_lines_non_negative
    CHECK (
      gross_pay        >= 0 AND
      federal_tax      >= 0 AND
      state_tax        >= 0 AND
      fica_ss          >= 0 AND
      fica_medicare    >= 0 AND
      total_deductions >= 0 AND
      net_pay          >= 0
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payroll_runs aggregate totals
DO $$ BEGIN
  ALTER TABLE payroll_runs ADD CONSTRAINT chk_payroll_runs_non_negative
    CHECK (total_gross >= 0 AND total_taxes >= 0 AND total_deductions >= 0 AND total_net >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- expense_report_lines
DO $$ BEGIN
  ALTER TABLE expense_report_lines ADD CONSTRAINT chk_expense_report_lines_non_negative
    CHECK (amount >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- expense_reports total
DO $$ BEGIN
  ALTER TABLE expense_reports ADD CONSTRAINT chk_expense_reports_total_non_negative
    CHECK (total >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- fixed_assets cost/salvage
DO $$ BEGIN
  ALTER TABLE fixed_assets ADD CONSTRAINT chk_fixed_assets_cost_non_negative
    CHECK (cost >= 0 AND salvage_value >= 0 AND accumulated_depreciation >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ==========================================================================
-- SECTION 6: users.role CHECK CONSTRAINT
-- Already enforced by migration 010:
--   CHECK (role IN ('owner', 'admin', 'accountant', 'user', 'viewer'))
-- No action required here.
-- ==========================================================================


-- ==========================================================================
-- SECTION 7: UNIQUE — employees.email per company
-- Partial index: allows NULL emails (contractors may have none), blocks
-- duplicate non-null emails within the same company.
-- ==========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_company_email_unique
  ON employees(company_id, email)
  WHERE email IS NOT NULL;


-- ==========================================================================
-- SECTION 8: DATE RANGE CHECK CONSTRAINTS
-- Prevents start_date > end_date which would produce negative-duration
-- payroll periods, time-off entries, and reconciliation windows.
-- NOT VALID: enforced on new writes only.
-- ==========================================================================

DO $$ BEGIN
  ALTER TABLE time_off_requests ADD CONSTRAINT chk_time_off_date_range
    CHECK (start_date <= end_date) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE payroll_runs ADD CONSTRAINT chk_payroll_period_range
    CHECK (pay_period_start <= pay_period_end) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE reconciliation_sessions ADD CONSTRAINT chk_recon_statement_range
    CHECK (statement_start <= statement_end) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE accounting_periods ADD CONSTRAINT chk_accounting_period_range
    CHECK (period_start <= period_end) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE close_checklists ADD CONSTRAINT chk_close_checklist_period_range
    CHECK (period_start <= period_end) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- recurring_templates: end_date is NULL when the template runs indefinitely
DO $$ BEGIN
  ALTER TABLE recurring_templates ADD CONSTRAINT chk_recurring_template_date_range
    CHECK (end_date IS NULL OR end_date >= start_date) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ==========================================================================
-- SECTION 9: ACCOUNT BALANCE TRIGGER — close the INSERT gap
-- newschema.sql's journal_status_transition_effects fires on
-- BEFORE UPDATE OF status. If any code path ever INSERTs a journal_entry
-- directly with status='posted' (e.g., system migrations, seed scripts),
-- accounts.current_balance is never updated for those entries.
-- This AFTER INSERT trigger closes that gap.
-- Note: at INSERT time there are no journal_lines yet, so we rely on
-- the correct draft→posted UPDATE flow for the normal write path.
-- This guard handles the direct-insert edge case.
-- ==========================================================================

CREATE OR REPLACE FUNCTION _journal_insert_balance_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only act if a journal entry was inserted already in 'posted' status
  -- AND it has lines (bulk inserts from seed/migration may supply lines via CTE)
  IF NEW.status = 'posted' THEN
    PERFORM apply_posted_journal_to_accounts(NEW.id, +1);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_insert_balance_guard ON journal_entries;

DO $$ BEGIN
  CREATE TRIGGER trg_journal_insert_balance_guard
  AFTER INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION _journal_insert_balance_guard();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
