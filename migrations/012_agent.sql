-- Migration 012: Agent actions audit table
-- The ai_conversations table already exists in the schema (newschema.sql).
-- This migration adds the agent_actions table for tracking AI-initiated actions.
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS agent_actions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID,                   -- FK to ai_conversations.id (optional)
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    tool_name           TEXT NOT NULL,          -- e.g. 'create_journal_entry'
    arguments           JSONB NOT NULL DEFAULT '{}',  -- resolved arguments passed to the tool
    result              JSONB,                  -- result returned by the tool
    status              TEXT NOT NULL DEFAULT 'pending_confirmation'
                            CHECK (status IN ('pending_confirmation', 'confirmed', 'executed', 'rejected', 'error')),
    created_by          UUID REFERENCES auth.users(id),
    confirmed_by        UUID REFERENCES auth.users(id),
    confirmed_at        TIMESTAMPTZ,
    executed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_actions_company_id_idx ON agent_actions (company_id);
CREATE INDEX IF NOT EXISTS agent_actions_session_id_idx ON agent_actions (session_id);
CREATE INDEX IF NOT EXISTS agent_actions_status_idx ON agent_actions (status);

-- Auto-expire pending actions after 24 hours (handled by periodic cleanup, not triggers)
-- Applications should check confirmed_at is within 24h before executing

-- RLS
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_actions_company_isolation
    ON agent_actions
    FOR ALL
    USING (
        company_id IN (
            SELECT company_id FROM users WHERE id = auth.uid()
        )
    );
