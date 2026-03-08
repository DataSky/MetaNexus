// ============================================================================
// MetaNexus Core Types
// Universal Agent Discovery, Trust, and Settlement
// ============================================================================

// ─── Identity ───────────────────────────────────────────────────────────────

/**
 * UniversalAgentCard — the canonical identity document for any agent.
 * Superset of A2A AgentCard and MetaD AgentCard.
 */
export interface UniversalAgentCard {
  /** Canonical URL: https://agent.example.com/.well-known/agent.json */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Natural language description (used for semantic search indexing) */
  description: string;
  /** Card version (semver) */
  version: string;

  /** Structured capability declarations */
  capabilities: Capability[];
  /** Which protocols this agent speaks */
  protocols: ProtocolSupport[];

  /** Primary API endpoint */
  endpoint: string;
  /** Protocol-specific endpoints */
  endpoints?: Record<string, string>;

  /** ed25519 public key (base64) */
  publicKey: string;
  /** Domain that hosts this card */
  domain: string;
  /** Domain ownership proof */
  domainVerification?: DomainProof;

  /** Trust metadata (MetaNexus-populated, not self-declared) */
  trust?: TrustMetadata;

  /** Settlement configuration */
  settlement?: SettlementConfig;

  /** Self-declared SLA */
  sla?: SLADeclaration;
  /** Declared rate limits */
  rateLimit?: RateLimitInfo;
  /** Geographic availability (ISO 3166-1 alpha-2) */
  regions?: string[];
  /** Supported languages (BCP 47) */
  languages?: string[];
  /** Free-form tags */
  tags?: string[];

  /** Agent owner info */
  owner?: AgentOwner;

  /** ISO 8601 creation timestamp */
  created: string;
  /** ISO 8601 last update timestamp */
  updated: string;
  /** ed25519 signature over canonical card */
  signature: string;
}

export interface AgentOwner {
  name?: string;
  url?: string;
  email?: string;
}

// ─── Capabilities ───────────────────────────────────────────────────────────

export interface Capability {
  /** Namespaced id: "translation.legal", "image.classify" */
  id: string;
  /** Human-readable name */
  name: string;
  /** What this capability does */
  description?: string;
  /** Expected input (JSON Schema) */
  inputSchema?: Record<string, unknown>;
  /** Expected output (JSON Schema) */
  outputSchema?: Record<string, unknown>;
  /** Self-declared quality benchmarks */
  qualityMetrics?: QualityMetric[];
  /** Cost per invocation */
  pricing?: PricingInfo;
}

export interface QualityMetric {
  /** Benchmark name: "BLEU", "accuracy", "F1" */
  benchmark: string;
  score: number;
  details?: string;
}

export interface PricingInfo {
  model: 'per_request' | 'per_token' | 'per_unit' | 'per_hour' | 'flat' | 'negotiable';
  amount: number;
  /** ISO 4217 or asset type */
  currency: string;
  /** What the amount is per */
  unit?: string;
}

// ─── Protocols ──────────────────────────────────────────────────────────────

export type ProtocolName = 'a2a' | 'mcp' | 'ucp' | 'metad' | 'rest' | 'graphql' | 'grpc' | 'custom';

export interface ProtocolSupport {
  protocol: ProtocolName;
  version: string;
  endpoint: string;
  /** URL to protocol manifest */
  manifest?: string;
}

// ─── Domain Verification ────────────────────────────────────────────────────

export interface DomainProof {
  method: 'dns_txt' | 'well_known' | 'meta_tag';
  value: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

// ─── Trust ──────────────────────────────────────────────────────────────────

export interface TrustMetadata {
  /** Overall trust score (0-100) */
  score: number;
  breakdown: TrustBreakdown;
  /** Confidence in the score (0-1, based on data volume) */
  confidence: number;
  computedAt: string;
  /** Active flags */
  flags?: TrustFlag[];
}

export interface TrustBreakdown {
  /** Task completion rate */
  reliability: number;
  /** Output quality (verification + ratings) */
  quality: number;
  /** SLA adherence */
  timeliness: number;
  /** Registration age + activity consistency */
  tenure: number;
  /** Collateral committed */
  stake: number;
}

export type TrustFlag =
  | 'new_agent'
  | 'quality_declining'
  | 'performance_degrading'
  | 'reliability_issue'
  | 'high_dispute_rate'
  | 'stake_at_risk';

// ─── Settlement ─────────────────────────────────────────────────────────────

export type AssetType = 'usdc' | 'compute_credit' | 'model_quota' | 'data_credit' | 'storage_credit';

export interface SettlementConfig {
  acceptedAssets: AcceptedAsset[];
  preferredAsset?: AssetType;
  offeredAssets?: OfferedAsset[];

  usdc?: USDCConfig;
  quotas?: QuotaOffer[];
  compute?: ComputeOffer[];
}

export interface AcceptedAsset {
  type: AssetType;
  details?: Record<string, unknown>;
}

export interface OfferedAsset {
  type: AssetType;
  details?: Record<string, unknown>;
}

export interface USDCConfig {
  address: string;
  chain: 'base' | 'ethereum' | 'polygon' | 'arbitrum';
}

export interface QuotaOffer {
  provider: string;
  model: string;
  tokensAvailable: number;
  ratePerMToken?: number;
}

export interface ComputeOffer {
  gpuType: string;
  hoursAvailable: number;
  ratePerHour?: number;
}

// ─── SLA ────────────────────────────────────────────────────────────────────

export interface SLADeclaration {
  /** Declared uptime percentage */
  uptime?: number;
  /** Median response time (ms) */
  latencyP50Ms?: number;
  /** 99th percentile response time (ms) */
  latencyP99Ms?: number;
  /** Requests per second capacity */
  throughputRps?: number;
  /** Max concurrent requests */
  maxConcurrent?: number;
}

export interface SLAVerification {
  period: string;
  measuredUptime: number;
  measuredP50Ms: number;
  measuredP99Ms: number;
  slaAdherence: number;
  probedAt: string;
}

export interface RateLimitInfo {
  requestsPerMinute?: number;
  requestsPerDay?: number;
  tokensPerMinute?: number;
}

// ─── Task Delegation ────────────────────────────────────────────────────────

export type IntentType = 'task' | 'query' | 'purchase' | 'barter';

export interface TaskIntent {
  intentId: string;
  clientAgentId: string;
  type: IntentType;

  task: {
    description: string;
    capabilityRequired?: string;
    input?: unknown;
    constraints?: TaskConstraints;
  };

  budget?: {
    maxAmount?: number;
    currency?: string;
    acceptedAssets?: AssetType[];
    barterOffer?: BarterOffer;
  };

  ttl: number;
  deadline?: string;

  nonce: string;
  timestamp: string;
  signature: string;
}

export interface TaskConstraints {
  quality?: 'best' | 'good' | 'fast';
  latencyMs?: number;
  region?: string[];
  compliance?: string[];
  minTrustScore?: number;
}

export interface BarterOffer {
  asset: AssetType;
  details: Record<string, unknown>;
}

export interface TaskOffer {
  offerId: string;
  intentId: string;
  providerAgentId: string;

  proposal: {
    description: string;
    estimatedDuration?: number;
    qualityGuarantee?: string;
  };

  pricing: {
    amount: number;
    asset: string;
    breakdown?: PriceBreakdown[];
  };

  barterRequest?: BarterOffer;

  validUntil: string;
  slaCommitment?: SLADeclaration;

  nonce: string;
  timestamp: string;
  signature: string;
}

export interface PriceBreakdown {
  item: string;
  amount: number;
  unit: string;
}

export type ExecutionStatus =
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'disputed'
  | 'cancelled';

export interface TaskExecution {
  executionId: string;
  offerId: string;
  intentId: string;
  status: ExecutionStatus;

  result?: unknown;
  payment?: PaymentRecord;
  escrow?: EscrowRecord;
  verification?: VerificationResult;
  clientRating?: number;
  slaMetrics?: SLAMetrics;

  acceptedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PaymentRecord {
  method: string;
  asset: AssetType;
  amount: string;
  txHash?: string;
  chain?: string;
}

export interface EscrowRecord {
  escrowId: string;
  status: 'pending' | 'funded' | 'verified' | 'released' | 'refunded' | 'disputed';
  asset: AssetType;
  amount: string;
  createdAt: string;
  expiresAt: string;
}

export interface VerificationResult {
  passed: boolean;
  method: string;
  details: string;
  checkedAt: string;
}

export interface SLAMetrics {
  actualLatencyP50Ms: number;
  actualLatencyP99Ms: number;
  actualUptime: number;
  slaAdherence: number;
}

// ─── SOTA Index ─────────────────────────────────────────────────────────────

export type ModelTier = 'frontier' | 'mid' | 'economy';

export interface SOTAIndex {
  version: string;
  timestamp: string;
  baseAsset: 'usdc';
  models: ModelPricing[];
}

export interface ModelPricing {
  provider: string;
  model: string;
  tier: ModelTier;

  arenaElo: number;
  compositeScore: number;

  officialPricePerMToken: number;
  indexPricePerMToken: number;
  premiumDiscount: number;

  swapVolume24h: number;
  supplyTokens: number;
  demandTokens: number;
  utilizationRate: number;

  priceChange24h: number;
  priceChange7d: number;
}

// ─── Swap ───────────────────────────────────────────────────────────────────

export type SwapOrderStatus = 'open' | 'matched' | 'escrowed' | 'completed' | 'cancelled' | 'expired';

export interface SwapOrder {
  orderId: string;
  agentId: string;

  offering: {
    model: string;
    provider: string;
    tokens: number;
    delegation: QuotaDelegation;
  };

  seeking?: {
    model?: string;
    minTokens?: number;
    maxPricePerMToken?: number;
  };

  askPricePerMToken: number;
  validUntil: string;
  status: SwapOrderStatus;
  matchedWith?: string;

  nonce: string;
  signature: string;
}

export type DelegationMethod = 'api_key' | 'proxy' | 'sub_account' | 'credit_transfer';

export interface QuotaDelegation {
  method: DelegationMethod;
  credentials?: Record<string, string>;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface SearchQuery {
  query: string;
  filters?: SearchFilters;
  limit?: number;
  offset?: number;
}

export interface SearchFilters {
  protocols?: ProtocolName[];
  capabilities?: string[];
  minTrustScore?: number;
  maxPricePerUnit?: number;
  regions?: string[];
  languages?: string[];
  tags?: string[];
  acceptedAssets?: AssetType[];
}

export interface SearchResult {
  agent: UniversalAgentCard;
  relevanceScore: number;
  matchedCapabilities: string[];
}

// ─── Crawler ────────────────────────────────────────────────────────────────

export type CrawlSource = 'well_known' | 'mcp_registry' | 'github_agents_md' | 'ucp' | 'self_registration' | 'dns';

export interface CrawlTarget {
  url: string;
  source: CrawlSource;
  protocol?: ProtocolName;
  lastCrawledAt?: string;
  priority: number;
}

export interface CrawlResult {
  target: CrawlTarget;
  success: boolean;
  card?: UniversalAgentCard;
  error?: string;
  crawledAt: string;
  responseTimeMs: number;
}
