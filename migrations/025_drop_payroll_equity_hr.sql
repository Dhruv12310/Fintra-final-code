-- Drop all payroll, equity, and HR tables from Supabase
-- Run in Supabase SQL Editor → Settings → SQL Editor
-- Tables are dropped in dependency order (children before parents)

-- ── Time & Timesheets ──────────────────────────────────────────────
DROP TABLE IF EXISTS time_entries CASCADE;

-- ── Employee Invites ───────────────────────────────────────────────
DROP TABLE IF EXISTS employee_invites CASCADE;

-- ── HR ────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS expense_report_lines CASCADE;
DROP TABLE IF EXISTS expense_reports CASCADE;
DROP TABLE IF EXISTS time_off_requests CASCADE;
DROP TABLE IF EXISTS time_off_policies CASCADE;

-- ── Payroll ───────────────────────────────────────────────────────
DROP TABLE IF EXISTS payroll_lines CASCADE;
DROP TABLE IF EXISTS payroll_runs CASCADE;
DROP TABLE IF EXISTS employees CASCADE;

-- ── Equity / Cap Table ────────────────────────────────────────────
DROP TABLE IF EXISTS equity_transactions CASCADE;
DROP TABLE IF EXISTS equity_grants CASCADE;
DROP TABLE IF EXISTS valuations CASCADE;
DROP TABLE IF EXISTS share_classes CASCADE;
DROP TABLE IF EXISTS stakeholders CASCADE;

-- ── Verify nothing is left ────────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'time_entries', 'employee_invites', 'expense_report_lines',
    'expense_reports', 'time_off_requests', 'time_off_policies',
    'payroll_lines', 'payroll_runs', 'employees',
    'equity_transactions', 'equity_grants', 'valuations',
    'share_classes', 'stakeholders'
  );
-- Should return 0 rows if all dropped successfully
