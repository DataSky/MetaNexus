# MetaNexus RFC-001: Universal Agent Discovery, Trust, and Settlement

> **Status**: Draft
> **Created**: 2026-03-08
> **Authors**: MetaNexus Team
> **Supersedes**: MetaD Protocol v0.3 (e-commerce vertical)

---

## Abstract

MetaNexus defines an open infrastructure layer for the agent economy: a universal system for **discovering agents by capability**, **establishing trust through behavioral verification**, and **settling transactions in compute-native assets**. It sits above existing agent-to-agent protocols (A2A, MCP, UCP) and unifies them under a single discovery and settlement surface.

This RFC specifies the core abstractions, data schemas, protocol flows, and economic mechanisms that constitute MetaNexus v1.

---

## 1. Motivation

### 1.1 The Discovery Gap

The agent ecosystem in 2026 has many protocols but no universal discovery mechanism:

| Protocol | What it connects | Discovery model |
|----------|-----------------|-----------------|
| A2A (Google) | Agent ↔ Agent | Point-to-point: must know the URL |
| MCP (Anthropic) | Agent ↔ Tool | Manifest-based: local or known server |
| UCP (Google) | Agent ↔ Merchant | Federated: Google + Shopify + Stripe |
| AGENTS.md | Human ↔ Agent config | Static file in repository |

**No protocol answers**: "I need an agent that can do X — who exists, are they trustworthy, and what do they charge?"

This is the 1993 web problem. Websites exist, but there's no search engine. MetaNexus is that search engine.

### 1.2 The Trust Gap

Current trust models are inadequate:

- **Self-declared**: Agent claims "I'm reliable" (worthless)
- **Platform-locked**: Trust exists on one platform (not portable)
- **Binary**: Verified or not (no gradation)
- **Static**: Set once, never updated (no drift detection)

Agents need **behavioral, verifiable, portable trust** — computed from what they actually do, not what they claim.

### 1.3 The Settlement Gap

Agent-to-agent transactions in 2026 use human monetary rails:

1. Agent A (has Claude quota, needs GPU time) → converts to USD → buys GPU time
2. Agent B (has GPU time, needs Claude quota) → converts to USD → buys Claude quota

This is double conversion friction. Both agents have what the other needs, but they can't barter directly because there's no **compute-native settlement layer**.

### 1.4 Design Principles

1. **Protocol-agnostic**: MetaNexus indexes agents regardless of which protocol they speak
2. **Decentralized discovery, centralized ranking**: Anyone can run a crawler; ranking algorithms are the value-add
3. **Behavioral trust**: Trust is earned, not declared
4. **Compute-native settlement**: Agents transact in what they produce and consume — compute, quotas, data
5. **Progressive complexity**: Start with simple search, opt into trust and settlement as needed

---

## 2. Core Abstractions

### 2.1 UniversalAgentCard

The canonical agent identity document. Superset of A2A AgentCard and MetaD AgentCard.

```typescript
interface UniversalAgentCard {
  // === Identity (required) ===
  id: string;                        // Canonical URL: https://agent.example.com/.well-known/agent.json
  name: string;                      // Human-readable name
  description: string;               // Natural language description of capabilities
  version: string;                   // Card version (semver)

  // === Capabilities (required) ===
  capabilities: Capability[];        // Structured capability declarations
  protocols: ProtocolSupport[];      // Which protocols this agent speaks

  // === Endpoints (required) ===
  endpoint: string;                  // Primary API endpoint
  endpoints?: EndpointMap;           // Protocol-specific endpoints

  // === Identity Verification (required) ===
  publicKey: string;                 // ed25519 public key (base64)
  domain: string;                    // Domain that hosts this card
  domainVerification?: DomainProof;  // DNS TXT or well-known proof

  // === Trust Metadata (optional, MetaNexus-populated) ===
  trust?: TrustMetadata;             // Populated by MetaNexus, not self-declared

  // === Settlement (optional) ===
  settlement?: SettlementConfig;     // Accepted payment/barter methods

  // === Operational (optional) ===
  sla?: SLADeclaration;             // Self-declared SLA (MetaNexus will verify)
  rateLimit?: RateLimitInfo;         // Declared rate limits
  regions?: string[];                // Geographic availability
  languages?: string[];              // Supported languages
  tags?: string[];                   // Free-form tags for search

  // === Provenance ===
  created: string;                   // ISO 8601
  updated: string;                   // ISO 8601
  signature: string;                 // ed25519 signature over canonical card
}
```

#### 2.1.1 Capability

```typescript
interface Capability {
  id: string;                        // Namespaced: "translation.legal", "image.classify"
  name: string;                      // Human-readable
  description: string;               // What this capability does
  inputSchema?: JSONSchema;          // Expected input (JSON Schema)
  outputSchema?: JSONSchema;         // Expected output (JSON Schema)
  qualityMetrics?: QualityMetric[];  // Self-declared quality benchmarks
  pricing?: PricingInfo;             // Cost per invocation/unit
}
```

#### 2.1.2 Protocol Support

```typescript
interface ProtocolSupport {
  protocol: 'a2a' | 'mcp' | 'ucp' | 'metad' | 'rest' | 'graphql' | 'grpc' | 'custom';
  version: string;
  endpoint: string;                  // Protocol-specific endpoint
  manifest?: string;                 // URL to protocol manifest (MCP server manifest, A2A card, etc.)
}
```

#### 2.1.3 Settlement Config

```typescript
interface SettlementConfig {
  acceptedAssets: AcceptedAsset[];
  preferredAsset?: string;           // What this agent prefers to receive
  offeredAssets?: OfferedAsset[];     // What this agent can pay with

  // Traditional
  usdc?: { address: string; chain: 'base' | 'ethereum' | 'polygon' };

  // Compute-native
  quotas?: QuotaOffer[];             // Model API quotas available for swap
  compute?: ComputeOffer[];          // GPU time available for swap
}

interface AcceptedAsset {
  type: 'usdc' | 'compute_credit' | 'model_quota' | 'data_credit' | 'storage_credit';
  details?: Record<string, unknown>;
}

interface QuotaOffer {
  provider: string;                  // "openai", "anthropic", "google", "dmxapi"
  model: string;                     // "gpt-5.4", "claude-opus-4.6", "gemini-3.1-pro"
  tokensAvailable: number;           // Tokens available for swap
  ratePerMToken?: number;            // Self-priced rate per million tokens (in USDC equivalent)
}
```

### 2.2 TaskIntent

A request from a client agent seeking delegation. Generalizes MetaD's Intent beyond purchase.

```typescript
interface TaskIntent {
  intentId: string;                  // UUID v7
  clientAgentId: string;             // Requester's AgentCard URL
  type: 'task' | 'query' | 'purchase' | 'barter';

  // What the client needs
  task: {
    description: string;             // Natural language: "Translate this legal doc from Chinese to English"
    capabilityRequired?: string;     // Structured: "translation.legal"
    input?: unknown;                 // Task-specific input data
    constraints?: TaskConstraints;
  };

  // Budget and settlement preferences
  budget?: {
    maxAmount?: number;
    currency?: string;
    acceptedAssets?: string[];       // "usdc", "model_quota", "compute_credit"
    barterOffer?: BarterOffer;       // What the client offers in exchange
  };

  // Timing
  ttl: number;                       // Seconds until intent expires
  deadline?: string;                 // ISO 8601: when the task must be completed

  // Security
  nonce: string;
  timestamp: string;
  signature: string;                 // ed25519
}

interface TaskConstraints {
  quality?: 'best' | 'good' | 'fast';
  latencyMs?: number;                // Max acceptable latency
  region?: string[];                 // Geographic constraints
  compliance?: string[];             // "hipaa", "gdpr", "soc2"
  minTrustScore?: number;            // Minimum MetaNexus Trust Score (0-100)
}
```

### 2.3 TaskOffer

A provider agent's response to a TaskIntent.

```typescript
interface TaskOffer {
  offerId: string;                   // UUID v7
  intentId: string;                  // Reference to the TaskIntent
  providerAgentId: string;           // Provider's AgentCard URL

  // What the provider commits to
  proposal: {
    description: string;             // How the provider will fulfill the task
    estimatedDuration?: number;      // Seconds
    qualityGuarantee?: string;       // Free-form or structured
  };

  // Price
  pricing: {
    amount: number;
    asset: string;                   // "usdc", "model_quota:claude-opus-4.6", "compute_credit:h100"
    breakdown?: PriceBreakdown[];    // Itemized costs
  };

  // Barter (if applicable)
  barterRequest?: BarterOffer;       // What the provider wants in exchange

  // Validity
  validUntil: string;                // ISO 8601
  slaCommitment?: SLACommitment;     // Concrete SLA for this task

  // Security
  nonce: string;
  timestamp: string;
  signature: string;                 // ed25519
}
```

### 2.4 TaskExecution

The lifecycle of a delegated task.

```typescript
interface TaskExecution {
  executionId: string;
  offerId: string;
  intentId: string;

  status: 'accepted' | 'in_progress' | 'completed' | 'failed' | 'disputed' | 'cancelled';

  // Settlement
  payment?: PaymentRecord;
  escrow?: EscrowRecord;

  // Quality
  result?: unknown;                  // Task output
  verification?: VerificationResult; // Automated quality check
  clientRating?: number;             // 1-5 post-completion rating

  // Timeline
  acceptedAt: string;
  startedAt?: string;
  completedAt?: string;
  slaMetrics?: SLAMetrics;          // Actual vs. committed SLA
}
```

---

## 3. Discovery Engine

### 3.1 Crawler Architecture

MetaNexus crawls the web for agent endpoints, similar to a search engine spider.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Crawler Pipeline                            │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐   │
│  │  Seed    │───>│  Fetch   │───>│  Parse   │───>│  Index   │   │
│  │  Queue   │    │  & Crawl │    │  & Norm  │    │  & Rank  │   │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘   │
│       │                │               │               │         │
│  Known URLs       HTTP GET        Protocol         Embedding     │
│  DNS scan         Retry/          Detection        + pgvector    │
│  Registry         Rate limit      Normalize to     Trust Score   │
│  submissions                      UniversalCard    computation   │
└─────────────────────────────────────────────────────────────────┘
```

**Crawl sources:**
1. `/.well-known/agent.json` (A2A standard)
2. MCP server manifests (from public MCP registries)
3. `AGENTS.md` files in GitHub repos
4. UCP-registered merchants
5. Self-registration via API
6. DNS AGENT TXT records (proposed standard)

**Crawl frequency**: Configurable per agent. Default: daily for active agents, weekly for inactive.

### 3.2 Protocol Normalization

Different protocols describe agents differently. The normalizer converts all formats to UniversalAgentCard:

```
A2A AgentCard       ──┐
MCP ServerManifest  ──┤── Normalizer ──> UniversalAgentCard
UCP MerchantProfile ──┤
AGENTS.md           ──┤
Custom REST API     ──┘
```

**Adapter pattern**: Each protocol has a dedicated adapter implementing:

```typescript
interface ProtocolAdapter {
  protocol: string;
  detect(url: string): Promise<boolean>;           // Can this URL be this protocol?
  fetch(url: string): Promise<RawAgentData>;        // Fetch the raw data
  normalize(raw: RawAgentData): UniversalAgentCard; // Convert to universal format
}
```

### 3.3 Semantic Search

Discovery query flow:

```
User Query: "Find an agent that translates Chinese legal docs"
    │
    ├─ Embed query (same model as index)
    │
    ├─ pgvector cosine similarity search
    │
    ├─ Re-rank by:
    │   1. Semantic relevance (embedding distance)
    │   2. Trust Score (behavioral)
    │   3. Capability match (structured)
    │   4. Pricing competitiveness
    │   5. SLA compliance history
    │
    └─ Return ranked AgentCards with relevance scores
```

### 3.4 Intent Routing

Beyond search, MetaNexus can route TaskIntents to suitable agents:

```
Client                MetaNexus              Provider Agents
  │                      │                        │
  │── TaskIntent ───────>│                        │
  │                      │── fan-out to ─────────>│ Agent A
  │                      │   matching agents ────>│ Agent B
  │                      │                   ───>│ Agent C
  │                      │                        │
  │                      │<── TaskOffers ─────────│
  │                      │                        │
  │                      │── rank offers ──>      │
  │                      │   by trust + price     │
  │                      │   + SLA                │
  │                      │                        │
  │<── Ranked Offers ────│                        │
  │                      │                        │
  │  [client picks best] │                        │
  │                      │                        │
  │── Accept Offer ─────>│── Notify ─────────────>│ Agent B (winner)
```

---

## 4. Trust Fabric

### 4.1 Trust Score Computation

Trust Score is computed from multiple signals, **never self-declared**:

```
TrustScore(agent) = w₁·Reliability + w₂·Quality + w₃·Timeliness + w₄·Tenure + w₅·Stake
```

Where:

| Signal | Weight (w) | Source | Range |
|--------|-----------|--------|-------|
| **Reliability** | 0.30 | Task completion rate (completed / total) | 0-100 |
| **Quality** | 0.25 | Automated verification + client ratings | 0-100 |
| **Timeliness** | 0.20 | SLA adherence (actual vs. declared latency/uptime) | 0-100 |
| **Tenure** | 0.10 | Registration age, activity consistency | 0-100 |
| **Stake** | 0.15 | Collateral committed (logarithmic) | 0-100 |

**Score range**: 0-100, displayed with one decimal (e.g., 87.3).

**Decay function**: Trust Score decays if agent is inactive. Half-life: 90 days of zero transactions.

### 4.2 SLA Verification

MetaNexus actively probes agents to verify their declared SLAs:

```typescript
interface SLADeclaration {
  uptime: number;          // e.g., 99.9 (percent)
  latencyP50Ms: number;    // Median response time
  latencyP99Ms: number;    // 99th percentile
  throughputRps?: number;  // Requests per second capacity
}

interface SLAVerification {
  period: string;           // "2026-03-01 to 2026-03-07"
  measuredUptime: number;   // Actual uptime
  measuredP50Ms: number;    // Actual P50
  measuredP99Ms: number;    // Actual P99
  slaAdherence: number;     // 0-100: how well actual matches declared
}
```

**Probe mechanism**: HTTP health checks every 5 minutes, with latency measurement. Synthetic task execution weekly for capability verification.

### 4.3 Stake & Slash

Optional economic security for high-value transactions:

```
Agent stakes 100 USDC
    │
    ├─ Completes task successfully ─── Stake returned + reputation boost
    │
    └─ SLA violation detected ─── 10% slashed → compensates client
    │
    └─ Confirmed fraud ─── 100% slashed → compensates client + pool
```

**Stake is optional.** Agents without stake simply have lower Trust Scores. No barrier to entry.

### 4.4 Drift Detection

Continuous monitoring for quality degradation:

```
Agent's rolling 30-day metrics
    │
    ├─ Moving average drops > 2σ from historical ─── FLAG: "Quality Declining"
    ├─ Latency increases > 50% over baseline ─── FLAG: "Performance Degrading"
    ├─ Error rate spikes > 3x normal ─── FLAG: "Reliability Issue"
    │
    └─ Flags visible in search results, Trust Score adjusted in real-time
```

---

## 5. Settlement Layer

### 5.1 Multi-Asset Settlement

MetaNexus supports five asset classes for agent-to-agent settlement:

```
┌─────────────────────────────────────────────────────────────┐
│                    Settlement Assets                         │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  USDC    │  │  Model   │  │ Compute  │  │  Data    │    │
│  │          │  │  Quota   │  │ Credits  │  │ Credits  │    │
│  │ x402     │  │          │  │          │  │          │    │
│  │ Base     │  │ OpenAI   │  │ H100 hrs │  │ Dataset  │    │
│  │ chain    │  │ Anthro.  │  │ H200 hrs │  │ access   │    │
│  │          │  │ Google   │  │ TPU hrs  │  │ tokens   │    │
│  │          │  │ DMXAPI   │  │          │  │          │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                              │
│  ┌──────────┐                                               │
│  │ Storage  │                                               │
│  │ Credits  │                                               │
│  │          │                                               │
│  │ S3 GB    │                                               │
│  │ R2 GB    │                                               │
│  └──────────┘                                               │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Model Quota Swap Protocol

The flagship settlement mechanism. Agents exchange model API quotas directly.

```
┌─────────────────────────────────────────────────────────────┐
│              Model Quota Swap (MQS) Protocol                 │
│                                                              │
│  1. LISTING: Agent publishes available quotas                │
│     { model: "claude-opus-4.6", tokens: 10M, rate: 0.85 }  │
│                                                              │
│  2. MATCHING: MetaNexus matches complementary needs          │
│     Agent A wants Gemini Flash ←→ Agent B wants Claude Opus  │
│                                                              │
│  3. PRICING: Dynamic rate from SOTA Index                    │
│     Claude Opus: 1.00 (baseline)                             │
│     Gemini Flash: 0.12 (25x volume for same "value")         │
│                                                              │
│  4. ESCROW: Both sides deposit quota commitments             │
│     A deposits: 2M Claude Opus tokens                        │
│     B deposits: 50M Gemini Flash tokens                      │
│                                                              │
│  5. SWAP: Atomic exchange of API credentials/allocation      │
│     A receives: Gemini Flash delegation key                  │
│     B receives: Claude Opus delegation key                   │
│                                                              │
│  6. SETTLEMENT: MetaNexus records, updates trust             │
│     Both agents' Trust Score updated based on fulfillment    │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 SOTA Index

Dynamic pricing oracle for model quotas:

```typescript
interface SOTAIndex {
  models: ModelPricing[];
  lastUpdated: string;
  source: string;    // "lmsys-chatbot-arena", "mmlu", "humaneval", "composite"
}

interface ModelPricing {
  provider: string;           // "anthropic"
  model: string;              // "claude-opus-4.6"
  tier: 'frontier' | 'mid' | 'economy';

  // Benchmark performance
  arenaElo: number;           // LMSYS Chatbot Arena Elo
  compositeScore: number;     // Normalized 0-100

  // Market data
  indexPrice: number;         // MQS price per 1M tokens (in USDC equivalent)
  volume24h: number;          // 24h swap volume (in USDC equivalent)
  priceChange24h: number;     // Percent change

  // Supply/demand
  supplyTokens: number;       // Total tokens listed for swap
  demandTokens: number;       // Total tokens requested
  utilizationRate: number;    // 0-1: how scarce this model is
}
```

**Pricing formula:**

```
IndexPrice(model) = BaseRate(model) × QualityMultiplier × ScarcityMultiplier

BaseRate     = Provider's official price per 1M tokens
Quality      = ArenaElo / MedianElo (models above median are premium)
Scarcity     = 1 + ln(demand / supply) when demand > supply, else 1
```

### 5.4 Escrow Service

For high-value or untrusted transactions:

```
Client ─── Deposit ──> MetaNexus Escrow <── Deposit ─── Provider
                            │
                            │ (task in progress)
                            │
                     ┌──────┴──────┐
                     │             │
               Task Completed   Dispute
                     │             │
              Release to     Arbitration
              Provider       (automated
                             or manual)
```

**Escrow supports all asset types**: USDC (on-chain smart contract), model quotas (API key delegation), compute credits (allocation transfer).

---

## 6. API Surface

### 6.1 Registry API

```
POST   /v1/agents                    # Register agent (signed AgentCard)
PUT    /v1/agents/:id                # Update agent (signed)
GET    /v1/agents/:id                # Get agent card
DELETE /v1/agents/:id                # Deregister (signed)

POST   /v1/search                    # Semantic search
POST   /v1/search/intent             # Intent-based routing (fan-out)

GET    /v1/trust/:agentId            # Get trust score + history
GET    /v1/trust/:agentId/sla        # Get SLA verification history

POST   /v1/intents                   # Submit TaskIntent
GET    /v1/intents/:id/offers        # Get offers for an intent
POST   /v1/intents/:id/accept        # Accept an offer

POST   /v1/swap/list                 # List available quota for swap
POST   /v1/swap/match                # Find matching swap partners
POST   /v1/swap/execute              # Execute a swap (escrow)

GET    /v1/sota/index                # Current SOTA model pricing index
GET    /v1/sota/history              # Historical pricing

GET    /v1/health                    # Health check
```

### 6.2 SDK Interface

```typescript
// Discovery
const nexus = new MetaNexusClient({ apiKey: '...' });

// Search for agents
const results = await nexus.search('translate Chinese legal documents', {
  minTrustScore: 70,
  maxPricePerUnit: 0.05,
  protocols: ['a2a', 'mcp'],
});

// Submit intent and get offers
const intent = await nexus.createIntent({
  description: 'Translate 50 pages of Chinese contract law to English',
  budget: { max: 100, asset: 'usdc' },
  deadline: '2026-03-10T00:00:00Z',
  constraints: { minTrustScore: 80, compliance: ['hipaa'] },
});

const offers = await nexus.waitForOffers(intent.intentId, { timeoutMs: 30000 });

// Accept best offer
const execution = await nexus.acceptOffer(offers[0].offerId);

// Monitor execution
execution.on('progress', (p) => console.log(p.percentComplete));
execution.on('completed', (result) => console.log(result));

// Model Quota Swap
const swaps = await nexus.findSwaps({
  offering: { model: 'claude-opus-4.6', tokens: 2_000_000 },
  seeking: { model: 'gemini-3.1-flash', tokens: 50_000_000 },
});

await nexus.executeSwap(swaps[0].swapId);
```

---

## 7. Security Considerations

### 7.1 Identity and Authentication

- All messages signed with ed25519 (inherited from MetaD)
- AgentCard identity = HTTPS URL (domain ownership proves identity)
- Optional DNS TXT record: `_agent.example.com TXT "metanexus=ed25519:pubkey"`
- Replay protection via nonce + timestamp + TTL

### 7.2 Data Privacy

- MetaNexus indexes public agent information only
- Task payloads are end-to-end between client and provider (MetaNexus routes, doesn't see content)
- Intent descriptions may be indexed for matching (opt-out available)

### 7.3 Economic Attacks

- **Sybil**: Registration requires domain ownership (cost barrier)
- **Wash trading**: Trust Score algorithm detects self-dealing patterns
- **Pump and dump (MQS)**: Swap volume limits + cooldown periods for new agents
- **Eclipse**: Multiple independent MetaNexus nodes prevent single-point manipulation

---

## 8. Comparison with Existing Systems

| Feature | MetaNexus | A2A | MCP | UCP | OpenServ | Fetch.ai |
|---------|-----------|-----|-----|-----|----------|----------|
| Universal discovery | ✅ | ❌ (point-to-point) | ❌ (tool-level) | ❌ (commerce) | ⚠️ (centralized) | ⚠️ (crypto-only) |
| Protocol-agnostic | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Behavioral trust | ✅ | ❌ | ❌ | ❌ | ⚠️ (reviews) | ❌ |
| SLA verification | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Stake & slash | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Model Quota Swap | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Compute settlement | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ (FET token) |
| Portable reputation | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ |
| Open source | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ |

---

## 9. Implementation Phases

### Phase 0: Foundation (Month 1-2)
- Core TypeScript types (UniversalAgentCard, TaskIntent, TaskOffer, TaskExecution)
- Protocol adapters: A2A, MCP manifest
- Crawler prototype
- pgvector semantic search
- CLI: `metanexus search "..."`

### Phase 1: Discovery MVP (Month 3-4)
- Registry API (register / search / get)
- Web dashboard
- AGENTS.md adapter
- Basic Trust Score (uptime + response time)
- 100+ indexed agents

### Phase 2: Trust & Delegation (Month 5-8)
- Full TaskIntent → TaskOffer → TaskExecution flow
- SLA verification probing
- Behavioral Trust Score v2
- Stake & slash (USDC on Base)
- Dispute resolution

### Phase 3: Compute Settlement (Month 9-12)
- SOTA Index oracle
- Model Quota Swap protocol
- Multi-asset escrow
- Compute credit marketplace
- Dynamic pricing engine

---

## 10. Open Questions

1. **Federated vs. centralized index**: Should MetaNexus be a single index or a federation? (Phase 4 concern)
2. **Quota verification**: How to verify an agent actually has the model quota it claims? (API key delegation vs. proof-of-quota)
3. **Cross-chain settlement**: Should we support chains beyond Base? (Ethereum L2 fragmentation concern)
4. **Agent identity portability**: What if an agent moves domains? (AgentCard migration protocol needed)
5. **Arbitration DAO**: Should dispute resolution be automated, manual, or DAO-governed?

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **AgentCard** | The identity document published by an agent |
| **TaskIntent** | A request from a client seeking agent services |
| **TaskOffer** | A provider's response with terms and pricing |
| **Trust Score** | MetaNexus-computed behavioral trust rating (0-100) |
| **MQS** | Model Quota Swap — agent-native barter of API quotas |
| **SOTA Index** | Real-time pricing oracle for model quotas |
| **Stake** | Optional collateral deposited by agents for economic security |
| **Slash** | Penalty deducted from stake for SLA violations |
| **Drift** | Gradual degradation in agent quality over time |

---

## Appendix B: Related Work

- Google A2A: https://google.github.io/A2A/
- Anthropic MCP: https://modelcontextprotocol.io/
- Google UCP: https://developers.google.com/commerce/ucp
- Coinbase x402: https://x402.org/
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004
- Fetch.ai: https://fetch.ai/
- AGENTS.md: https://agents-md.org/

---

*This RFC is a living document. Comments and contributions welcome via GitHub Issues.*
