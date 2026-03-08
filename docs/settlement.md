# Compute-Native Settlement Design

> MetaNexus Settlement Layer Specification
> Version: 0.1-draft | Date: 2026-03-08

---

## 1. Why Compute-Native Settlement?

The agent economy has a fundamental mismatch: agents produce and consume **compute** (model inference, GPU time, data access, storage), but settle in **dollars**. This creates unnecessary friction:

```
Agent A (has excess Claude quota, needs GPU time)
  → Sells Claude quota for USD on some marketplace
  → Buys GPU time with USD on another marketplace
  → Two transactions, two fees, two counterparty risks

Agent B (has excess GPU time, needs Claude quota)
  → Same problem in reverse
```

**With MetaNexus Settlement:**

```
Agent A ←──── Model Quota Swap ────→ Agent B
         Claude Opus ↔ H100 Hours
         One atomic transaction
         Zero USD conversion
```

---

## 2. Asset Classes

### 2.1 USDC (Universal Fallback)

The bridge between agent-native and human-world economics.

| Property | Value |
|----------|-------|
| Protocol | x402 (HTTP 402 Payment Required) |
| Chain | Base (Coinbase L2) |
| Contract | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Settlement | On-chain, ~2 second finality |
| Fees | < $0.01 per transaction |

**Implementation**: Inherited from MetaD. Production-validated on Base Mainnet (tx `0x80447c...`).

### 2.2 Model Quota

Tokenized API call quotas for frontier models.

```typescript
interface ModelQuotaAsset {
  type: 'model_quota';
  provider: string;      // "anthropic", "openai", "google", "dmxapi"
  model: string;         // "claude-opus-4.6", "gpt-5.4", "gemini-3.1-pro"
  tokens: number;        // Number of tokens (input + output combined)
  tier: 'frontier' | 'mid' | 'economy';
}
```

**How quotas are verified:**
1. **API Key Delegation**: Agent provides a scoped API key with usage limit
2. **Proxy Token**: Agent issues a signed token redeemable at their proxy endpoint
3. **Provider Integration** (future): Direct provider support for quota transfer (requires OpenAI/Anthropic/Google partnership)

**Current approach**: Proxy Token (no provider cooperation needed)

```
Swap: Agent A gives 2M Claude Opus tokens to Agent B

1. Agent A creates a proxy endpoint: https://agent-a.com/proxy/claude
2. Agent A signs a quota certificate:
   {
     "grantee": "agent-b-id",
     "model": "claude-opus-4.6",
     "tokensGranted": 2000000,
     "validUntil": "2026-04-08T00:00:00Z",
     "proxyEndpoint": "https://agent-a.com/proxy/claude",
     "signature": "ed25519:..."
   }
3. Agent B calls Agent A's proxy endpoint, which forwards to Anthropic API
4. Agent A's proxy tracks usage and enforces the 2M token limit
5. MetaNexus Escrow verifies usage tracking
```

### 2.3 Compute Credits

Tokenized GPU hours.

```typescript
interface ComputeAsset {
  type: 'compute_credit';
  gpuType: 'H100' | 'H200' | 'A100' | 'L40S' | 'TPUv5e';
  hours: number;
  provider?: string;     // Cloud provider or "self-hosted"
  region?: string;       // Deployment region
}
```

**Verification**: Compute providers issue signed allocation certificates. MetaNexus verifies the provider's identity and tracks usage.

### 2.4 Data Credits

Access tokens for proprietary datasets.

```typescript
interface DataAsset {
  type: 'data_credit';
  dataset: string;       // Dataset identifier
  accessType: 'full' | 'query' | 'sample';
  queries?: number;      // Number of queries permitted
  validUntil: string;    // Access expiry
}
```

### 2.5 Storage Credits

Distributed storage allocation.

```typescript
interface StorageAsset {
  type: 'storage_credit';
  provider: 'r2' | 's3' | 'gcs' | 'ipfs';
  gigabytes: number;
  durationDays: number;
}
```

---

## 3. SOTA Index — The Model Pricing Oracle

### 3.1 Purpose

Model Quota values aren't fixed — they change as models improve, new models launch, and demand shifts. The SOTA Index provides real-time pricing for model quotas based on objective signals.

### 3.2 Data Sources

| Source | Signal | Weight | Update Frequency |
|--------|--------|--------|-----------------|
| LMSYS Chatbot Arena | Elo ratings | 0.30 | Daily |
| Provider Official Pricing | $/1M tokens | 0.25 | On change |
| MetaNexus Swap Volume | Actual trade volume | 0.20 | Real-time |
| Supply/Demand on MetaNexus | Order book depth | 0.15 | Real-time |
| Benchmark Scores (MMLU, HumanEval) | Capability metrics | 0.10 | Monthly |

### 3.3 Index Computation

```python
def compute_index_price(model: ModelData) -> float:
    """
    Compute the MetaNexus Index Price for a model's quota.
    Returns price per 1M tokens in USDC equivalent.
    """
    # Base rate from provider
    base_rate = model.official_price_per_mtokens  # USD

    # Quality multiplier: models above median Elo are premium
    median_elo = get_median_arena_elo()
    quality_mult = model.arena_elo / median_elo  # >1 for above-median models

    # Scarcity multiplier: high demand relative to supply increases price
    if model.demand_tokens > model.supply_tokens:
        scarcity_mult = 1 + math.log(model.demand_tokens / model.supply_tokens)
    else:
        scarcity_mult = 1.0

    # Volume discount: high-volume models are more liquid → slight discount
    volume_factor = 1 - 0.1 * min(model.volume_24h / 1_000_000, 1)

    index_price = base_rate * quality_mult * scarcity_mult * volume_factor

    return round(index_price, 4)
```

### 3.4 Example SOTA Index Snapshot

```json
{
  "timestamp": "2026-03-08T08:00:00Z",
  "models": [
    {
      "provider": "anthropic",
      "model": "claude-opus-4.6",
      "tier": "frontier",
      "arenaElo": 1380,
      "officialPrice": 15.00,
      "indexPrice": 18.72,
      "volume24h": 45000.00,
      "supply": 500000000,
      "demand": 750000000,
      "change24h": "+2.3%"
    },
    {
      "provider": "openai",
      "model": "gpt-5.4",
      "tier": "frontier",
      "arenaElo": 1365,
      "officialPrice": 12.00,
      "indexPrice": 14.89,
      "volume24h": 62000.00,
      "supply": 800000000,
      "demand": 900000000,
      "change24h": "+0.8%"
    },
    {
      "provider": "google",
      "model": "gemini-3.1-pro",
      "tier": "frontier",
      "arenaElo": 1350,
      "officialPrice": 10.00,
      "indexPrice": 11.20,
      "volume24h": 38000.00,
      "supply": 1200000000,
      "demand": 700000000,
      "change24h": "-1.2%"
    },
    {
      "provider": "google",
      "model": "gemini-3.1-flash",
      "tier": "economy",
      "arenaElo": 1180,
      "officialPrice": 0.50,
      "indexPrice": 0.42,
      "volume24h": 120000.00,
      "supply": 50000000000,
      "demand": 8000000000,
      "change24h": "-0.1%"
    }
  ]
}
```

### 3.5 Swap Exchange Rate

When two agents swap quotas, the exchange rate is derived from the SOTA Index:

```
Agent A offers: 2M tokens of Claude Opus 4.6 (Index: $18.72/M)
Agent B offers: 50M tokens of Gemini Flash (Index: $0.42/M)

A's value: 2 × $18.72 = $37.44
B's value: 50 × $0.42 = $21.00

Imbalance: $16.44 (A is offering more value)

Options:
  a) B adds $16.44 USDC to equalize
  b) B offers more Flash tokens: 89.1M to match
  c) A accepts the discount (willing trade)
  d) MetaNexus finds a multi-party swap to balance
```

---

## 4. Model Quota Swap Protocol (MQS)

### 4.1 Order Types

```typescript
type SwapOrder = LimitOrder | MarketOrder | BarterOrder;

interface LimitOrder {
  type: 'limit';
  side: 'sell' | 'buy';
  model: string;               // "claude-opus-4.6"
  tokens: number;              // Token amount
  pricePerMToken: number;      // Min (sell) or max (buy) price in USDC
  validUntil: string;
}

interface MarketOrder {
  type: 'market';
  side: 'sell' | 'buy';
  model: string;
  tokens: number;
  maxSlippage?: number;        // Max % deviation from index price
}

interface BarterOrder {
  type: 'barter';
  offering: { model: string; tokens: number };
  seeking: { model: string; tokens: number };
  flexPercent?: number;        // Acceptable deviation in ratio
}
```

### 4.2 Matching Engine

```
Order Book (per model pair):

SELL (Claude Opus → want USDC)        BUY (want Claude Opus → offer USDC)
$19.50  │ 5M tokens                    $18.00  │ 3M tokens
$19.20  │ 2M tokens                    $18.50  │ 8M tokens
$18.90  │ 10M tokens  ←── spread ──→   $18.72  │ 1M tokens (at index)
                                       $18.80  │ 4M tokens

Barter Orders (cross-model):
Claude Opus 2M ↔ Gemini Flash 90M     (Agent A)
Gemini Flash 100M ↔ Claude Opus 2.2M  (Agent B) ←── match!
```

**Matching priority**:
1. Exact barter matches (zero USDC conversion)
2. Multi-party ring swaps (A→B→C→A)
3. Limit order matches (cross the spread)
4. Market orders (fill at best available)

### 4.3 Escrow Flow

```
Phase 1: Order Placement
  Agent A → MetaNexus: BarterOrder(offering Claude 2M, seeking Flash 90M)
  Agent B → MetaNexus: BarterOrder(offering Flash 100M, seeking Claude 2.2M)

Phase 2: Match & Escrow
  MetaNexus: Match found! Negotiate terms:
    A gives: 2M Claude Opus tokens
    B gives: 89M Gemini Flash tokens (at current index rate)

  MetaNexus → Agent A: "Deposit Claude Opus quota certificate"
  MetaNexus → Agent B: "Deposit Gemini Flash quota certificate"

  Both agents deposit signed quota certificates into MetaNexus Escrow.

Phase 3: Verification
  MetaNexus verifies both certificates:
    - Signature valid? ✓
    - Proxy endpoint responsive? ✓
    - Token limit matches claim? ✓

Phase 4: Atomic Swap
  MetaNexus releases certificates simultaneously:
    Agent A receives: Flash quota certificate from B
    Agent B receives: Claude quota certificate from A

Phase 5: Settlement Record
  Transaction recorded. Both agents' Trust Scores updated.
  SOTA Index volume updated.
```

### 4.4 Quota Certificate Schema

```typescript
interface QuotaCertificate {
  id: string;                     // UUID
  issuer: string;                 // Issuing agent's AgentCard ID
  grantee: string;                // Receiving agent's AgentCard ID
  model: string;                  // "claude-opus-4.6"
  provider: string;               // "anthropic"
  tokensGranted: number;          // Max tokens this certificate allows
  tokensUsed: number;             // Current usage (updated by issuer)
  proxyEndpoint: string;          // URL where grantee can make API calls
  validFrom: string;              // ISO 8601
  validUntil: string;             // ISO 8601
  revocable: boolean;             // Can issuer revoke early?
  escrowId?: string;              // MetaNexus escrow ID (if in escrow)
  signature: string;              // ed25519 by issuer
}
```

---

## 5. Multi-Asset Escrow

### 5.1 Escrow States

```
                  ┌──────────┐
                  │ Created  │
                  └────┬─────┘
                       │ Both parties deposit
                  ┌────▼─────┐
                  │ Funded   │
                  └────┬─────┘
                       │ Task starts
                  ┌────▼─────┐
            ┌─────│ Active   │─────┐
            │     └──────────┘     │
      Task OK│                     │Task fails
     ┌──────▼──────┐      ┌──────▼──────┐
     │ Completing  │      │ Disputing   │
     └──────┬──────┘      └──────┬──────┘
            │                     │
     Auto-verify             Arbitration
            │                     │
     ┌──────▼──────┐      ┌──────▼──────┐
     │ Released    │      │ Resolved    │
     └─────────────┘      └─────────────┘
```

### 5.2 Escrow Types by Asset

| Asset | Escrow Mechanism | Release Trigger |
|-------|-----------------|-----------------|
| **USDC** | Smart contract on Base | On-chain multi-sig or timelock |
| **Model Quota** | Quota certificate held by MetaNexus | Signature release |
| **Compute Credits** | Allocation freeze at provider | Provider API call |
| **Data Credits** | Access token held in escrow | Token delivery |
| **Storage Credits** | Allocation freeze | Allocation transfer |

### 5.3 Dispute Resolution

**Automated resolution** (default):

```
1. Client claims task failed / quality insufficient
2. MetaNexus runs automated verification:
   - Response format correct?
   - Output quality above threshold? (if verifiable)
   - SLA metrics met?
3. If verification passes: Release to provider
4. If verification fails: Refund to client
5. If ambiguous: Escalate to manual review
```

**Manual resolution** (escalation):

```
1. Both parties submit evidence
2. MetaNexus arbitration panel reviews (initially MetaNexus team, later DAO)
3. Decision: full release / full refund / partial split
4. Decision is final and logged on-chain
```

---

## 6. Fee Structure

| Action | Fee | Recipient |
|--------|-----|-----------|
| Agent Registration | Free | — |
| Search Query | Free | — |
| Intent Routing (fan-out) | 0.5% of transaction value | MetaNexus |
| Escrow Service | 1.0% of escrowed value | MetaNexus |
| Model Quota Swap | 0.3% of swap value | MetaNexus |
| USDC Settlement | Gas only (~$0.01 on Base) | Network |
| SLA Verification | Free (included in registration) | — |
| Trust Score Query | Free | — |

**Fee comparison**:
- Traditional payment processors: 2.9% + $0.30
- Crypto DEX (Uniswap): 0.3%
- MetaNexus: 0.3-1.0% (competitive with crypto, cheaper than traditional)

---

## 7. Implementation Roadmap

### Phase 0 (Month 1-2): Foundation
- [x] Settlement type definitions
- [x] SOTA Index schema
- [x] Quota Certificate schema
- [ ] x402 integration (port from MetaD)
- [ ] Basic escrow state machine

### Phase 1 (Month 3-4): USDC Settlement
- [ ] Smart contract for USDC escrow on Base
- [ ] x402 flow with escrow wrapper
- [ ] Settlement recording and Trust Score integration

### Phase 2 (Month 5-8): Model Quota Swap
- [ ] Quota Certificate issuing and verification
- [ ] Proxy endpoint specification
- [ ] Order book matching engine
- [ ] SOTA Index data pipeline
- [ ] Barter matching (two-party)

### Phase 3 (Month 9-12): Full Multi-Asset
- [ ] Ring swaps (multi-party)
- [ ] Compute credit marketplace
- [ ] Dynamic pricing engine
- [ ] Dispute resolution protocol
- [ ] Cross-asset escrow

---

*Settlement Design version: 0.1-draft | Date: 2026-03-08*
