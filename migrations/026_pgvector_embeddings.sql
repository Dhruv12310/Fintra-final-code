-- Migration 026: pgvector semantic search + enhanced agent audit trail
-- Run in Supabase SQL Editor

-- Enable pgvector (available on all Supabase projects by default)
CREATE EXTENSION IF NOT EXISTS vector;

-- Semantic embedding column on accounts
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Semantic embedding column on contacts
ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- IVFFlat index for fast cosine similarity on accounts
-- lists=100 is appropriate for up to ~1M rows; re-run REINDEX after backfill
CREATE INDEX IF NOT EXISTS accounts_embedding_cosine_idx
    ON accounts USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- RPC function used by resolver.py to query cosine neighbors
CREATE OR REPLACE FUNCTION match_accounts(
    query_embedding  vector(1536),
    company_id_filter uuid,
    match_count      int DEFAULT 5
)
RETURNS TABLE (
    id           uuid,
    account_name text,
    account_code text,
    account_type text,
    distance     float
)
LANGUAGE sql STABLE
AS $$
    SELECT
        a.id,
        a.account_name,
        a.account_code,
        a.account_type,
        (a.embedding <=> query_embedding)::float AS distance
    FROM accounts a
    WHERE
        a.company_id = company_id_filter
        AND a.is_active = true
        AND a.embedding IS NOT NULL
    ORDER BY a.embedding <=> query_embedding
    LIMIT match_count;
$$;

-- Enhance agent_actions with full audit fields required by the plan
ALTER TABLE agent_actions
    ADD COLUMN IF NOT EXISTS source                  TEXT DEFAULT 'ai_agent',
    ADD COLUMN IF NOT EXISTS conversation_id         UUID,
    ADD COLUMN IF NOT EXISTS preview_json            JSONB,
    ADD COLUMN IF NOT EXISTS embedding_match_scores  JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS model_versions          JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS reversed_at             TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reversed_by             UUID REFERENCES auth.users(id);

-- ai_suggestions placeholder: ships empty, used by future proactive agents
CREATE TABLE IF NOT EXISTS ai_suggestions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    suggestion_type TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'dismissed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_suggestions_company_isolation
    ON ai_suggestions FOR ALL
    USING (company_id IN (
        SELECT company_id FROM users WHERE id = auth.uid()
    ));
