-- Run this in Supabase SQL Editor
-- Credit memos (AR) + vendor credits (AP) with multi-application
--
-- A credit memo reduces a customer's outstanding balance. It is a NEGATIVE
-- invoice: reverse the revenue, reduce AR. Common for returns, allowances,
-- write-offs, mistakenly invoiced amounts.
--
-- A vendor credit reduces a vendor's outstanding balance. NEGATIVE bill:
-- reverse the expense (or COGS), reduce AP. Common for returns to supplier,
-- pricing adjustments, refunds.
--
-- Both can be applied (in whole or in parts) against multiple invoices/bills.

-- ========================================================================
-- 1. Status enum (shared)
-- ========================================================================

DO $$ BEGIN
  CREATE TYPE credit_status AS ENUM ('draft','posted','applied','void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ========================================================================
-- 2. Credit memos (AR)
-- ========================================================================

CREATE TABLE IF NOT EXISTS credit_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,

  credit_number TEXT NOT NULL,
  credit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status credit_status NOT NULL DEFAULT 'draft',

  reason TEXT,
  memo TEXT,

  subtotal NUMERIC(15,2) DEFAULT 0,
  tax_total NUMERIC(15,2) DEFAULT 0,
  total NUMERIC(15,2) DEFAULT 0,
  amount_applied NUMERIC(15,2) DEFAULT 0,
  balance_remaining NUMERIC(15,2) DEFAULT 0,

  linked_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(company_id, credit_number)
);

CREATE TABLE IF NOT EXISTS credit_note_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  description TEXT,
  quantity NUMERIC(15,2) DEFAULT 1,
  unit_price NUMERIC(15,2) DEFAULT 0,
  amount NUMERIC(15,2) DEFAULT 0,
  revenue_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(credit_note_id, line_number)
);

CREATE TABLE IF NOT EXISTS credit_note_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_applied NUMERIC(15,2) NOT NULL CHECK (amount_applied > 0),
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(credit_note_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_company ON credit_notes(company_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_customer ON credit_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_apps_invoice ON credit_note_applications(invoice_id);

-- ========================================================================
-- 3. Vendor credits (AP)
-- ========================================================================

CREATE TABLE IF NOT EXISTS vendor_credits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,

  credit_number TEXT NOT NULL,
  credit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status credit_status NOT NULL DEFAULT 'draft',

  reason TEXT,
  memo TEXT,

  subtotal NUMERIC(15,2) DEFAULT 0,
  tax_total NUMERIC(15,2) DEFAULT 0,
  total NUMERIC(15,2) DEFAULT 0,
  amount_applied NUMERIC(15,2) DEFAULT 0,
  balance_remaining NUMERIC(15,2) DEFAULT 0,

  linked_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(company_id, credit_number)
);

CREATE TABLE IF NOT EXISTS vendor_credit_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_credit_id UUID NOT NULL REFERENCES vendor_credits(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  description TEXT,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  expense_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vendor_credit_id, line_number)
);

CREATE TABLE IF NOT EXISTS vendor_credit_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_credit_id UUID NOT NULL REFERENCES vendor_credits(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount_applied NUMERIC(15,2) NOT NULL CHECK (amount_applied > 0),
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(vendor_credit_id, bill_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_credits_company ON vendor_credits(company_id);
CREATE INDEX IF NOT EXISTS idx_vendor_credits_vendor ON vendor_credits(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_credit_apps_bill ON vendor_credit_applications(bill_id);

-- ========================================================================
-- 4. RLS
-- ========================================================================

ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_credit_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_credit_applications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY company_isolation_policy ON credit_notes
    FOR ALL USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY company_isolation_policy ON credit_note_lines
    FOR ALL USING (credit_note_id IN (SELECT id FROM credit_notes));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY company_isolation_policy ON credit_note_applications
    FOR ALL USING (credit_note_id IN (SELECT id FROM credit_notes));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY company_isolation_policy ON vendor_credits
    FOR ALL USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY company_isolation_policy ON vendor_credit_lines
    FOR ALL USING (vendor_credit_id IN (SELECT id FROM vendor_credits));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY company_isolation_policy ON vendor_credit_applications
    FOR ALL USING (vendor_credit_id IN (SELECT id FROM vendor_credits));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
