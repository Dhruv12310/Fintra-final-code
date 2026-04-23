-- Run this in Supabase SQL Editor
-- Granular RBAC: per-(role, subject, action) permission grants on top of
-- the existing tier-based roles (owner / admin / accountant / user / viewer).
--
-- Default behaviour stays unchanged: if no row exists for a (company, role,
-- subject, action), the app falls back to the hard-coded tier matrix. Owners
-- can grant or revoke specific actions per role per company without code
-- changes.

CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  action TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, role_name, subject, action)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_lookup
  ON role_permissions(company_id, role_name, subject, action);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY company_isolation_policy ON role_permissions
    FOR ALL USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
