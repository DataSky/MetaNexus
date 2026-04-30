-- MetaNexus Database Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Enable pgvector extension first:
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Agents table
-- Stores UniversalAgentCards with optional embedding vector for semantic search
-- ============================================================================
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT        PRIMARY KEY,               -- e.g. "https://agent.example.com"
  data          JSONB       NOT NULL,                  -- full UniversalAgentCard JSON
  domain        TEXT        NOT NULL DEFAULT '',
  name          TEXT        NOT NULL DEFAULT '',
  description   TEXT        NOT NULL DEFAULT '',
  protocols     TEXT[]      NOT NULL DEFAULT '{}',     -- e.g. ['a2a', 'mcp']
  tags          TEXT[]      NOT NULL DEFAULT '{}',
  trust_score   FLOAT       NOT NULL DEFAULT 0,
  embedding     vector(1024),                          -- qwen3-embedding-8b dimension
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ANN index for fast cosine similarity search on embeddings
CREATE INDEX IF NOT EXISTS agents_embedding_cosine_idx
  ON agents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- GIN index for fast array/JSONB filtering
CREATE INDEX IF NOT EXISTS agents_tags_idx     ON agents USING gin(tags);
CREATE INDEX IF NOT EXISTS agents_protocols_idx ON agents USING gin(protocols);
CREATE INDEX IF NOT EXISTS agents_domain_idx    ON agents (domain);

-- ============================================================================
-- Intents table
-- ============================================================================
CREATE TABLE IF NOT EXISTS intents (
  intent_id   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  data        JSONB       NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','expired','cancelled')),
  client_id   TEXT        NOT NULL,
  execution_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS intents_client_id_idx ON intents (client_id);
CREATE INDEX IF NOT EXISTS intents_status_idx    ON intents (status);
CREATE INDEX IF NOT EXISTS intents_expires_at_idx ON intents (expires_at);

-- ============================================================================
-- Offers table
-- ============================================================================
CREATE TABLE IF NOT EXISTS offers (
  offer_id     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  intent_id    UUID        NOT NULL REFERENCES intents(intent_id) ON DELETE CASCADE,
  data         JSONB       NOT NULL,
  provider_id  TEXT        NOT NULL,
  valid_until  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offers_intent_id_idx ON offers (intent_id);

-- ============================================================================
-- Executions table
-- ============================================================================
CREATE TABLE IF NOT EXISTS executions (
  execution_id UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_id     UUID        NOT NULL REFERENCES offers(offer_id),
  intent_id    UUID        NOT NULL REFERENCES intents(intent_id),
  data         JSONB       NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'accepted'
               CHECK (status IN ('accepted','in_progress','completed','failed','disputed','cancelled')),
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS executions_intent_id_idx ON executions (intent_id);
CREATE INDEX IF NOT EXISTS executions_status_idx    ON executions (status);

-- ============================================================================
-- Trust history table (for behavioral scoring)
-- ============================================================================
CREATE TABLE IF NOT EXISTS trust_records (
  id            BIGSERIAL   PRIMARY KEY,
  agent_id      TEXT        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  execution_id  UUID        REFERENCES executions(execution_id),
  event_type    TEXT        NOT NULL,   -- 'probe_success', 'probe_fail', 'tx_completed', 'tx_disputed'
  score_delta   FLOAT       NOT NULL DEFAULT 0,
  metadata      JSONB,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trust_records_agent_id_idx ON trust_records (agent_id);
