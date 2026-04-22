-- Migration 011: Integration connections and sync logs
-- Run in Supabase SQL Editor

-- ── Integration Connections ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,          -- 'quickbooks', 'workday', 'carta'
    access_token    TEXT,                   -- Fernet-encrypted
    refresh_token   TEXT,                   -- Fernet-encrypted
    token_expires_at TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'active', 'error', 'disconnected')),
    last_sync_at    TIMESTAMPTZ,
    config          JSONB NOT NULL DEFAULT '{}',  -- realm_id, oauth_state, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active connection per provider per company
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_company_provider_unique
    ON integration_connections (company_id, provider)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS integration_connections_company_id_idx
    ON integration_connections (company_id);

-- ── Integration Sync Logs ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_sync_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id       UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    entity_type         TEXT NOT NULL,       -- 'accounts', 'invoices', 'payroll_summary', etc.
    direction           TEXT NOT NULL CHECK (direction IN ('pull', 'push', 'webhook')),
    records_processed   INTEGER NOT NULL DEFAULT 0,
    errors              JSONB NOT NULL DEFAULT '[]',
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS integration_sync_logs_connection_id_idx
    ON integration_sync_logs (connection_id);

-- ── RLS Policies ──────────────────────────────────────────────────
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_logs ENABLE ROW LEVEL SECURITY;

-- Company isolation for integration_connections
CREATE POLICY integration_connections_company_isolation
    ON integration_connections
    FOR ALL
    USING (
        company_id IN (
            SELECT company_id FROM users WHERE id = auth.uid()
        )
    );

-- Sync logs accessible via connection's company
CREATE POLICY integration_sync_logs_company_isolation
    ON integration_sync_logs
    FOR ALL
    USING (
        connection_id IN (
            SELECT id FROM integration_connections
            WHERE company_id IN (
                SELECT company_id FROM users WHERE id = auth.uid()
            )
        )
    );

-- Auto-update updated_at on integration_connections
CREATE TRIGGER set_integration_connections_updated_at
    BEFORE UPDATE ON integration_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
