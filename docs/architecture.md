# MetaNexus Technical Architecture

> Version: 0.1 | Date: 2026-03-08 | Status: Draft

---

## 1. System Overview

```
                         Internet
                            │
            ┌───────────────┼───────────────┐
            │               │               │
      ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
      │  Agent A   │  │  Agent B   │  │  Agent C   │
      │  (A2A)     │  │  (MCP)     │  │  (Custom)  │
      └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
            │               │               │
            ▼               ▼               ▼
┌────────────────────────────────────────────────────────────────┐
│                     MetaNexus Gateway                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    API Router (Hono)                      │  │
│  │    /v1/agents  /v1/search  /v1/intents  /v1/swap         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            │                                    │
│  ┌─────────────────────────┼─────────────────────────────────┐ │
│  │                    Service Layer                           │ │
│  │                                                           │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │ │
│  │  │ Registry │  │ Search   │  │  Trust   │  │ Settle-  │  │ │
│  │  │ Service  │  │ Service  │  │  Service │  │ ment     │  │ │
│  │  │          │  │          │  │          │  │ Service  │  │ │
│  │  │ CRUD     │  │ Embed    │  │ Score    │  │ Escrow   │  │ │
│  │  │ Validate │  │ Index    │  │ Probe    │  │ Swap     │  │ │
│  │  │ Sign     │  │ Rank     │  │ Slash    │  │ Price    │  │ │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │ │
│  │       │              │              │              │        │ │
│  └───────┼──────────────┼──────────────┼──────────────┼────────┘ │
│          │              │              │              │          │
│  ┌───────┼──────────────┼──────────────┼──────────────┼────────┐ │
│  │       ▼              ▼              ▼              ▼        │ │
│  │            Data Layer                                       │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │ │
│  │  │PostgreSQL│  │ pgvector │  │  Redis   │  │   Base   │   │ │
│  │  │          │  │          │  │          │  │  Chain   │   │ │
│  │  │ Agents   │  │ Embed-   │  │ Cache    │  │          │   │ │
│  │  │ Intents  │  │ dings    │  │ Rate     │  │ USDC     │   │ │
│  │  │ Offers   │  │ 1024-dim │  │ Limits   │  │ Escrow   │   │ │
│  │  │ Execs    │  │          │  │ SOTA     │  │ Stake    │   │ │
│  │  │ Trust    │  │          │  │ Sessions │  │          │   │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                     Background Workers                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Crawler  │  │ SLA      │  │ Trust    │  │ SOTA     │        │
│  │ Worker   │  │ Prober   │  │ Updater  │  │ Indexer  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### 2.1 API Gateway

**Framework**: Hono (TypeScript, edge-compatible)

**Why Hono**: Fastest TypeScript web framework, runs on Node.js/Bun/Cloudflare Workers, tiny bundle, built-in validation.

```typescript
// server/src/app.ts
import { Hono } from 'hono';
import { agentRoutes } from './routes/agents';
import { searchRoutes } from './routes/search';
import { intentRoutes } from './routes/intents';
import { swapRoutes } from './routes/swap';
import { trustRoutes } from './routes/trust';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';

const app = new Hono();

app.use('*', rateLimitMiddleware());
app.route('/v1/agents', agentRoutes);
app.route('/v1/search', searchRoutes);
app.route('/v1/intents', intentRoutes);
app.route('/v1/swap', swapRoutes);
app.route('/v1/trust', trustRoutes);
```

### 2.2 Registry Service

Manages agent lifecycle: registration, update, deregistration.

**Key responsibilities:**
- Validate UniversalAgentCard format and required fields
- Verify ed25519 signature
- Verify domain ownership (fetch `/.well-known/agent.json` and compare)
- Store in PostgreSQL
- Trigger embedding generation for search indexing

```typescript
// sdk/core/src/registry.ts
class RegistryService {
  async register(card: UniversalAgentCard): Promise<RegisterResult> {
    // 1. Validate schema
    this.validateCard(card);

    // 2. Verify signature
    await this.verifySignature(card);

    // 3. Verify domain ownership (async, can be deferred)
    this.scheduleDomainVerification(card.id);

    // 4. Store
    const agent = await this.db.agents.upsert(card);

    // 5. Index for search
    await this.searchService.index(agent);

    // 6. Initialize trust tracking
    await this.trustService.initAgent(agent.id);

    return { agentId: agent.id, status: 'registered' };
  }
}
```

### 2.3 Search Service

Semantic search over indexed agents.

**Embedding pipeline:**
1. Agent registration → extract searchable text (name + description + capabilities)
2. Generate embedding via model API (1024-dim)
3. Store in pgvector
4. Query: embed user query → cosine similarity → re-rank by trust + relevance

```typescript
// sdk/discovery/src/search.ts
class SearchService {
  async search(query: string, filters?: SearchFilters): Promise<SearchResult[]> {
    // 1. Generate query embedding
    const queryEmbedding = await this.embedder.embed(query);

    // 2. pgvector similarity search
    const candidates = await this.db.query(`
      SELECT a.*, 1 - (e.embedding <=> $1) as similarity
      FROM agents a
      JOIN agent_embeddings e ON a.id = e.agent_id
      WHERE 1 - (e.embedding <=> $1) > $2
      ${this.buildFilterClause(filters)}
      ORDER BY similarity DESC
      LIMIT $3
    `, [queryEmbedding, filters?.minSimilarity ?? 0.3, filters?.limit ?? 20]);

    // 3. Re-rank with trust score
    return this.rerank(candidates, query, filters);
  }

  private rerank(candidates: Agent[], query: string, filters?: SearchFilters): SearchResult[] {
    return candidates
      .map(agent => ({
        ...agent,
        score: this.computeRankScore(agent, query, filters),
      }))
      .sort((a, b) => b.score - a.score);
  }

  private computeRankScore(agent: Agent, query: string, filters?: SearchFilters): number {
    const similarity = agent.similarity;                    // 0-1
    const trust = (agent.trustScore ?? 50) / 100;          // 0-1
    const capabilityMatch = this.matchCapabilities(agent, query); // 0-1

    // Weighted combination
    return similarity * 0.5 + trust * 0.3 + capabilityMatch * 0.2;
  }
}
```

### 2.4 Trust Service

Behavioral trust computation and SLA verification.

```typescript
// sdk/trust/src/service.ts
class TrustService {
  async computeScore(agentId: string): Promise<TrustScore> {
    const metrics = await this.gatherMetrics(agentId);

    const reliability = this.computeReliability(metrics.executions);
    const quality = this.computeQuality(metrics.ratings, metrics.verifications);
    const timeliness = this.computeTimeliness(metrics.slaChecks);
    const tenure = this.computeTenure(metrics.registeredAt, metrics.lastActiveAt);
    const stake = this.computeStakeScore(metrics.stakeAmount);

    const score =
      0.30 * reliability +
      0.25 * quality +
      0.20 * timeliness +
      0.10 * tenure +
      0.15 * stake;

    return {
      score: Math.round(score * 10) / 10,
      breakdown: { reliability, quality, timeliness, tenure, stake },
      computedAt: new Date().toISOString(),
      confidence: this.computeConfidence(metrics),
    };
  }
}
```

### 2.5 Settlement Service

Multi-asset settlement with escrow.

```typescript
// sdk/settlement/src/service.ts
class SettlementService {
  async createEscrow(execution: TaskExecution): Promise<Escrow> {
    const offer = await this.db.offers.get(execution.offerId);

    switch (offer.pricing.asset) {
      case 'usdc':
        return this.createUSDCEscrow(offer);
      case 'model_quota':
        return this.createQuotaEscrow(offer);
      case 'compute_credit':
        return this.createComputeEscrow(offer);
      default:
        throw new Error(`Unsupported asset: ${offer.pricing.asset}`);
    }
  }

  async releaseEscrow(escrowId: string, verification: VerificationResult): Promise<void> {
    const escrow = await this.db.escrows.get(escrowId);

    if (verification.passed) {
      await this.release(escrow); // Release to provider
    } else {
      await this.dispute(escrow, verification.reason); // Enter dispute
    }
  }
}
```

---

## 3. Data Models

### 3.1 PostgreSQL Schema

```sql
-- Agents table
CREATE TABLE agents (
  id TEXT PRIMARY KEY,                  -- AgentCard URL (canonical)
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  public_key TEXT NOT NULL,
  domain TEXT NOT NULL,
  domain_verified BOOLEAN DEFAULT FALSE,
  card_json JSONB NOT NULL,             -- Full UniversalAgentCard
  trust_score REAL DEFAULT 50.0,
  status TEXT DEFAULT 'active',         -- active, suspended, deregistered
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_crawled_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ
);

-- Agent capabilities (denormalized for search)
CREATE TABLE agent_capabilities (
  id SERIAL PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,          -- "translation.legal"
  name TEXT NOT NULL,
  description TEXT,
  pricing_json JSONB,
  UNIQUE(agent_id, capability_id)
);

-- Embeddings for semantic search
CREATE TABLE agent_embeddings (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  embedding vector(1024),              -- pgvector
  text_indexed TEXT,                    -- Text that was embedded
  model TEXT,                           -- Embedding model used
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_embeddings_ivfflat
  ON agent_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Protocol support
CREATE TABLE agent_protocols (
  id SERIAL PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL,               -- "a2a", "mcp", "ucp", "custom"
  version TEXT,
  endpoint TEXT,
  manifest_url TEXT,
  UNIQUE(agent_id, protocol)
);

-- Task intents
CREATE TABLE task_intents (
  id TEXT PRIMARY KEY,                  -- UUID v7
  client_agent_id TEXT NOT NULL,
  type TEXT NOT NULL,                   -- "task", "query", "purchase", "barter"
  task_json JSONB NOT NULL,
  budget_json JSONB,
  ttl INTEGER NOT NULL,
  deadline TIMESTAMPTZ,
  status TEXT DEFAULT 'open',           -- open, matched, expired, cancelled
  nonce TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Task offers
CREATE TABLE task_offers (
  id TEXT PRIMARY KEY,
  intent_id TEXT REFERENCES task_intents(id),
  provider_agent_id TEXT NOT NULL,
  proposal_json JSONB NOT NULL,
  pricing_json JSONB NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending',        -- pending, accepted, rejected, expired
  nonce TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task executions
CREATE TABLE task_executions (
  id TEXT PRIMARY KEY,
  offer_id TEXT REFERENCES task_offers(id),
  intent_id TEXT REFERENCES task_intents(id),
  status TEXT DEFAULT 'accepted',       -- accepted, in_progress, completed, failed, disputed
  result_json JSONB,
  payment_json JSONB,
  escrow_id TEXT,
  client_rating INTEGER,               -- 1-5
  sla_metrics_json JSONB,
  accepted_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Trust history
CREATE TABLE trust_history (
  id SERIAL PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  score REAL NOT NULL,
  breakdown_json JSONB NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

-- SLA probes
CREATE TABLE sla_probes (
  id SERIAL PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  probe_type TEXT NOT NULL,             -- "health", "latency", "capability"
  result_json JSONB NOT NULL,
  response_time_ms INTEGER,
  success BOOLEAN,
  probed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Model quota swap orders
CREATE TABLE swap_orders (
  id TEXT PRIMARY KEY,
  seller_agent_id TEXT NOT NULL,
  offering_model TEXT NOT NULL,
  offering_tokens BIGINT NOT NULL,
  seeking_model TEXT,
  seeking_tokens BIGINT,
  price_per_mtoken REAL,               -- USDC equivalent
  status TEXT DEFAULT 'open',           -- open, matched, executing, completed, cancelled
  matched_with TEXT,                    -- Counterparty swap order ID
  escrow_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- SOTA index snapshots
CREATE TABLE sota_snapshots (
  id SERIAL PRIMARY KEY,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  arena_elo INTEGER,
  composite_score REAL,
  index_price REAL,
  volume_24h REAL,
  supply_tokens BIGINT,
  demand_tokens BIGINT,
  snapshot_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Redis Schema

```
# Rate limiting
rate:api:{ip}                    → counter (TTL 60s)
rate:search:{agentId}            → counter (TTL 60s)

# SOTA index cache
sota:index:current               → JSON (TTL 300s)
sota:model:{model}               → JSON (TTL 60s)

# Active sessions
session:{intentId}               → JSON (TTL = intent.ttl)
session:offers:{intentId}        → sorted set of offer IDs

# Agent online status
agent:heartbeat:{agentId}        → timestamp (TTL 600s)
agent:status:{agentId}           → "online" | "degraded" | "offline"

# Swap order book
swap:book:{model}                → sorted set (by price)
swap:matches:pending             → list of potential matches
```

---

## 4. Background Workers

### 4.1 Crawler Worker

```typescript
class CrawlerWorker {
  // Runs every 15 minutes
  async tick(): Promise<void> {
    const batch = await this.getNextCrawlBatch(100);

    await Promise.allSettled(
      batch.map(async (target) => {
        const adapter = this.selectAdapter(target);
        try {
          const raw = await adapter.fetch(target.url);
          const card = adapter.normalize(raw);
          await this.registryService.upsert(card);
        } catch (err) {
          await this.markCrawlFailure(target, err);
        }
      })
    );
  }

  private selectAdapter(target: CrawlTarget): ProtocolAdapter {
    switch (target.protocol) {
      case 'a2a': return new A2AAdapter();
      case 'mcp': return new MCPAdapter();
      case 'agents_md': return new AgentsMDAdapter();
      default: return new GenericAdapter();
    }
  }
}
```

### 4.2 SLA Prober

```typescript
class SLAProber {
  // Runs every 5 minutes
  async tick(): Promise<void> {
    const agents = await this.getAgentsToProbe(50);

    for (const agent of agents) {
      const start = performance.now();
      try {
        const response = await fetch(agent.endpoint + '/health', {
          signal: AbortSignal.timeout(10_000),
        });
        const latencyMs = performance.now() - start;

        await this.recordProbe(agent.id, {
          type: 'health',
          success: response.ok,
          responseTimeMs: Math.round(latencyMs),
          statusCode: response.status,
        });
      } catch (err) {
        await this.recordProbe(agent.id, {
          type: 'health',
          success: false,
          error: err.message,
        });
      }
    }
  }
}
```

### 4.3 Trust Updater

```typescript
class TrustUpdater {
  // Runs every hour
  async tick(): Promise<void> {
    const agents = await this.getAgentsForTrustUpdate();

    for (const agent of agents) {
      const score = await this.trustService.computeScore(agent.id);
      await this.db.agents.update(agent.id, { trustScore: score.score });
      await this.db.trustHistory.insert({
        agentId: agent.id,
        score: score.score,
        breakdown: score.breakdown,
      });
    }
  }
}
```

### 4.4 SOTA Indexer

```typescript
class SOTAIndexer {
  // Runs every 6 hours
  async tick(): Promise<void> {
    // 1. Fetch latest benchmark data
    const arenaData = await this.fetchLMSYSArena();
    const officialPricing = await this.fetchOfficialPricing();

    // 2. Fetch swap market data
    const swapVolume = await this.db.swapOrders.getVolume24h();
    const supplyDemand = await this.db.swapOrders.getSupplyDemand();

    // 3. Compute index prices
    const models = this.computeIndexPrices(arenaData, officialPricing, swapVolume, supplyDemand);

    // 4. Store snapshot
    for (const model of models) {
      await this.db.sotaSnapshots.insert(model);
    }

    // 5. Update Redis cache
    await this.redis.set('sota:index:current', JSON.stringify(models), 'EX', 300);
  }
}
```

---

## 5. Protocol Adapters

### 5.1 Adapter Interface

```typescript
interface ProtocolAdapter {
  readonly protocol: string;
  readonly version: string;

  /**
   * Detect if a URL hosts an agent using this protocol
   */
  detect(url: string): Promise<DetectionResult>;

  /**
   * Fetch raw agent data from the URL
   */
  fetch(url: string): Promise<RawAgentData>;

  /**
   * Normalize raw data to UniversalAgentCard
   */
  normalize(raw: RawAgentData): UniversalAgentCard;

  /**
   * Translate a TaskIntent into this protocol's request format
   */
  translateIntent?(intent: TaskIntent): unknown;

  /**
   * Parse this protocol's response into a TaskOffer
   */
  parseOffer?(raw: unknown): TaskOffer;
}
```

### 5.2 A2A Adapter

```typescript
class A2AAdapter implements ProtocolAdapter {
  readonly protocol = 'a2a';
  readonly version = '1.0';

  async detect(url: string): Promise<DetectionResult> {
    const wellKnown = new URL('/.well-known/agent.json', url);
    const res = await fetch(wellKnown, { signal: AbortSignal.timeout(5000) });
    return { detected: res.ok, confidence: res.ok ? 1.0 : 0 };
  }

  async fetch(url: string): Promise<RawAgentData> {
    const wellKnown = new URL('/.well-known/agent.json', url);
    const res = await fetch(wellKnown);
    return { protocol: 'a2a', data: await res.json(), sourceUrl: url };
  }

  normalize(raw: RawAgentData): UniversalAgentCard {
    const a2aCard = raw.data as A2AAgentCard;
    return {
      id: a2aCard.url ?? raw.sourceUrl,
      name: a2aCard.name,
      description: a2aCard.description ?? '',
      version: a2aCard.version ?? '1.0',
      capabilities: this.mapCapabilities(a2aCard.skills ?? []),
      protocols: [{ protocol: 'a2a', version: '1.0', endpoint: a2aCard.url }],
      endpoint: a2aCard.url,
      publicKey: '', // A2A doesn't mandate ed25519
      domain: new URL(a2aCard.url).hostname,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      signature: '',
    };
  }
}
```

### 5.3 MCP Adapter

```typescript
class MCPAdapter implements ProtocolAdapter {
  readonly protocol = 'mcp';
  readonly version = '1.0';

  async detect(url: string): Promise<DetectionResult> {
    // MCP servers typically expose a manifest
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      return { detected: !!data.result?.capabilities, confidence: 0.9 };
    } catch {
      return { detected: false, confidence: 0 };
    }
  }

  normalize(raw: RawAgentData): UniversalAgentCard {
    const manifest = raw.data;
    return {
      id: raw.sourceUrl,
      name: manifest.serverInfo?.name ?? 'Unknown MCP Server',
      description: manifest.serverInfo?.description ?? '',
      version: manifest.serverInfo?.version ?? '1.0',
      capabilities: this.mapTools(manifest.capabilities?.tools ?? []),
      protocols: [{ protocol: 'mcp', version: '1.0', endpoint: raw.sourceUrl }],
      endpoint: raw.sourceUrl,
      publicKey: '',
      domain: new URL(raw.sourceUrl).hostname,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      signature: '',
    };
  }
}
```

---

## 6. Deployment Architecture

### 6.1 Phase 0-1 (MVP)

```
                    Railway
        ┌──────────────────────────────┐
        │                              │
        │  ┌────────────────────────┐  │
        │  │   MetaNexus Server     │  │
        │  │   (Node.js + Hono)     │  │
        │  │                        │  │
        │  │   All services in      │  │
        │  │   single process       │  │
        │  └───────────┬────────────┘  │
        │              │               │
        │  ┌───────────▼────────────┐  │
        │  │  PostgreSQL + pgvector │  │
        │  │  (Railway Volume)      │  │
        │  └────────────────────────┘  │
        │                              │
        │  ┌────────────────────────┐  │
        │  │  Redis (Railway)       │  │
        │  └────────────────────────┘  │
        └──────────────────────────────┘
```

**Cost**: ~$10-20/month on Railway (comparable to MetaD's current deployment)

### 6.2 Phase 2+ (Scale)

```
          Cloudflare Workers (Edge)
        ┌────────────────────────────┐
        │  API Gateway + Rate Limit  │
        └─────────────┬──────────────┘
                      │
        ┌─────────────▼──────────────┐
        │       Load Balancer         │
        └──────┬──────────────┬──────┘
               │              │
    ┌──────────▼──────┐ ┌────▼──────────┐
    │  API Server (1) │ │ API Server (2) │
    │  Registry       │ │ Registry       │
    │  Search         │ │ Search         │
    │  Trust          │ │ Trust          │
    └────────┬────────┘ └────┬───────────┘
             │               │
    ┌────────▼───────────────▼───────────┐
    │        PostgreSQL (Primary)         │
    │        + pgvector                   │
    │        + Read Replicas              │
    └────────────────┬───────────────────┘
                     │
    ┌────────────────▼───────────────────┐
    │        Redis Cluster                │
    └─────────────────────────────────────┘
    
    Background Workers (separate processes):
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Crawler  │ │ Prober   │ │ Indexer  │
    └──────────┘ └──────────┘ └──────────┘
```

---

## 7. SDK Package Structure

```
@metanexus/sdk                          # Meta-package (re-exports all)
├── @metanexus/core                     # Core types, crypto, validation
│   ├── types.ts                        # UniversalAgentCard, TaskIntent, etc.
│   ├── crypto.ts                       # ed25519 sign/verify
│   ├── validation.ts                   # Schema validation (Zod)
│   └── index.ts
├── @metanexus/discovery                # Search and crawl
│   ├── client.ts                       # MetaNexus API client
│   ├── search.ts                       # Search service
│   ├── crawler.ts                      # Crawler engine
│   └── index.ts
├── @metanexus/trust                    # Trust computation
│   ├── score.ts                        # Trust Score algorithm
│   ├── prober.ts                       # SLA prober
│   └── index.ts
├── @metanexus/settlement               # Multi-asset settlement
│   ├── escrow.ts                       # Escrow service
│   ├── swap.ts                         # Model Quota Swap
│   ├── sota.ts                         # SOTA Index
│   ├── x402.ts                         # USDC payment (from MetaD)
│   └── index.ts
└── @metanexus/adapters                 # Protocol adapters
    ├── a2a.ts                          # Google A2A
    ├── mcp.ts                          # Anthropic MCP
    ├── ucp.ts                          # Google UCP
    ├── agents-md.ts                    # AGENTS.md
    └── index.ts
```

---

## 8. Testing Strategy

Inherited from MetaD's discipline (81 tests, all passing):

| Layer | Framework | Focus |
|-------|----------|-------|
| Unit | Vitest | Core types, crypto, validation, trust computation |
| Integration | Vitest + test containers | Database queries, search indexing, API routes |
| E2E | Vitest + real API | Full registration → search → intent → offer → execution flow |
| Adapter | Vitest + mock servers | Each protocol adapter against mock endpoints |

**Test naming convention**: `{module}.test.ts` alongside source files.

**CI**: GitHub Actions, run on every PR and push to main.

---

## 9. Migration from MetaD

MetaNexus inherits and extends MetaD's codebase:

| MetaD Component | MetaNexus Equivalent | Migration Path |
|-----------------|---------------------|----------------|
| `AgentCardManager` | `@metanexus/core` types | Extend with protocols[], settlement |
| `RegistryClient` | `@metanexus/discovery` client | Add semantic search, intent routing |
| `IntentBuilder` | `@metanexus/core` TaskIntent | Generalize beyond purchase |
| `OfferBuilder` | `@metanexus/core` TaskOffer | Add multi-asset pricing |
| `TrustScore` | `@metanexus/trust` | Add SLA probing, stake/slash |
| x402 payment | `@metanexus/settlement` x402 | Reuse, add escrow wrapper |
| SQLite registry | PostgreSQL + pgvector | Upgrade for scale + vector search |
| Shopify adapter | `@metanexus/adapters` (one of many) | Keep as reference adapter |

---

*Architecture version: 0.1 | Date: 2026-03-08*
