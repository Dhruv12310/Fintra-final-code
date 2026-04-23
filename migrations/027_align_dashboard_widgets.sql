-- Run this in Supabase SQL Editor
-- Aligns dashboard_widgets with the API contract used by routes/dashboard.py
-- and frontend/components/dashboard/*. The canonical newschema.sql shipped a
-- legacy shape (widget_type, no company_id, no unique key) that 500'd the
-- PUT /dashboard/widgets endpoint.

ALTER TABLE dashboard_widgets
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS widget_id  TEXT,
  ADD COLUMN IF NOT EXISTS config     JSONB DEFAULT '{}';

-- Backfill widget_id from the legacy widget_type column when present
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dashboard_widgets' AND column_name = 'widget_type'
  ) THEN
    UPDATE dashboard_widgets SET widget_id = widget_type WHERE widget_id IS NULL;
  END IF;
END $$;

-- Backfill company_id from the owning user's company
UPDATE dashboard_widgets dw
   SET company_id = u.company_id
  FROM users u
 WHERE dw.user_id = u.id AND dw.company_id IS NULL;

-- Drop rows we cannot key (orphans without a company or widget_id)
DELETE FROM dashboard_widgets WHERE company_id IS NULL OR widget_id IS NULL;

ALTER TABLE dashboard_widgets
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN widget_id  SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE dashboard_widgets
    ADD CONSTRAINT dashboard_widgets_company_user_widget_uq
    UNIQUE (company_id, user_id, widget_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_company_user
  ON dashboard_widgets(company_id, user_id);

NOTIFY pgrst, 'reload schema';
