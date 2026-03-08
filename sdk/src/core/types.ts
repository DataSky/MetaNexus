/**
 * MetaNexus Core Types
 *
 * Universal agent identity, task delegation, and settlement types.
 * These are the foundational data structures for the entire MetaNexus ecosystem.
 */

// ============================================================================
// Agent Identity
// ============================================================================

/**
 * The canonical agent identity document.
 * Published at `/.well-known/agent.json` on the agent's domain.
 * Superset of A2A AgentCard and MetaD AgentCard.
 */
export interface UniversalAgentCard {
  // === Identity (required) ===
  id: string;
  name: string;
  description: string;
  version: string;

  // === Capabilities (required) ===
  capabilities: Capability[];
  protocols: ProtocolSupport[];

  // === Endpoints (required) ===
  endpoint: string;
  endpoints?: Record<string, string>;

  // === Identity Verification (required) ===
  publicKey: string;
  domain: string;
  domainVerification?: DomainProof;

  // === Trust Metadata (MetaNexus-populated, read-only) ===
  trust?: TrustMetadata;

  // === Settlement (optional) ===
  settlement?: SettlementConfig;

  // === Operational (optional) ===
  sla?: SLADeclaration;
  rateLimit?: RateLimitInfo;
  regions?: string[];
  languages?: string[];
  tags?: string[];

  // === Provenance ===
  created: string;
  updated: string;
  signature: string;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  qualityMetrics?: QualityMetric[];
  pricing?: PricingInfo;
}

export interface QualityMetric {
  benchmark: string;
  score: number;
  date?: string;
}

export interface PricingInfo {
  model: 'per_request' | 'per_token' | 'per_unit' | 'flat' | 'negotiable';
  amount: number;
  currency: string;
  unit?: string;
}

export interface ProtocolSupport {
  protocol: 'a2a' | 'mcp' | 'ucp' | 'metad' | 'rest' | 'graphql' | 'grpc' | 'custom';
  version: string;
  endpoint: string;
  manifest?: string;
}

export interface DomainProof {
  method: 'well_known' | 'dns_txt' | 'meta_tag';
  value?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface RateLimitInfo {
  requestsPerMinute?: number;
  requestsPerDay?: number;
  concurrency?: number;
}

// ============================================================================
// Trust
// ============================================================================

export interface TrustMetadata {
  score: number;
  confidence: 'low' | 'medium' | 'high';
  breakdown: TrustBreakdown;
  totalTransactions: number;
  disputeRate: number;
  lastVerified?: string;
  flags?: string[];
}

export interface TrustBreakdown {
  reliability: number;
  quality: number;
  timeliness: number;
  tenure: number;
  stake: number;
}

export interface TrustScore {
  score: number;
  breakdown: TrustBreakdown;
  confidence: 'low' | 'medium' | 'high';
  computedAt: string;
}

// ============================================================================
// SLA
// ============================================================================

export interface SLADeclaration {
  uptimePercent?: number;
  latencyP50Ms?: number;
  latencyP99Ms?: number;
  throughputRps?: number;
  maxConcurrency?: number;
  supportHours?: string;
}

export interface SLACommitment {
  uptimePercent: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
  penalty?: string;
}

export interface SLAVerification {
  period: string;
  measuredUptime: number;
  measuredP50Ms: number;
  measuredP99Ms: number;
  slaAdherence: number;
  probedAt: string;
}

// ============================================================================
// Settlement
// ============================================================================

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
  chain: 'base' | 'ethereum' | 'polygon';
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

// ============================================================================
// Task Delegation
// ============================================================================

export type IntentType = 'task' | 'query' | 'purchase' | 'barter';
export type QualityPreference = 'best' | 'good' | 'fast';

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
  quality?: QualityPreference;
  latencyMs?: number;
  region?: string[];
  compliance?: string[];
  minTrustScore?: number;
}

export interface BarterOffer {
  asset: AssetType;
  model?: string;
  tokens?: number;
  gpuType?: string;
  hours?: number;
  details?: Record<string, unknown>;
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
  slaCommitment?: SLACommitment;

  nonce: string;
  timestamp: string;
  signature: string;
}

export interface PriceBreakdown {
  item: string;
  amount: number;
  asset: string;
}

export type ExecutionStatus = 'accepted' | 'in_progress' | 'completed' | 'failed' | 'disputed' | 'cancelled';

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
  txHash?: string;
  amount: string;
  asset: string;
  chain?: string;
  paidAt: string;
}

export interface EscrowRecord {
  escrowId: string;
  status: 'created' | 'funded' | 'active' | 'completing' | 'disputing' | 'released' | 'resolved';
  depositedAssets: { party: string; asset: string; amount: string }[];
  createdAt: string;
  releasedAt?: string;
}

export interface VerificationResult {
  passed: boolean;
  reason?: string;
  checks: { name: string; passed: boolean; details?: string }[];
  verifiedAt: string;
}

export interface SLAMetrics {
  actualLatencyP50Ms: number;
  actualLatencyP99Ms: number;
  taskDurationMs: number;
  slaAdherence: number;
}

// ============================================================================
// Model Quota Swap
// ============================================================================

export interface QuotaCertificate {
  id: string;
  issuer: string;
  grantee: string;
  model: string;
  provider: string;
  tokensGranted: number;
  tokensUsed: number;
  proxyEndpoint: string;
  validFrom: string;
  validUntil: string;
  revocable: boolean;
  escrowId?: string;
  signature: string;
}

export type SwapOrderType = 'limit' | 'market' | 'barter';
export type SwapSide = 'sell' | 'buy';
export type SwapStatus = 'open' | 'matched' | 'executing' | 'completed' | 'cancelled';

export interface SwapOrder {
  orderId: string;
  type: SwapOrderType;
  agentId: string;

  // For limit/market orders
  side?: SwapSide;
  model?: string;
  tokens?: number;
  pricePerMToken?: number;
  maxSlippage?: number;

  // For barter orders
  offering?: { model: string; tokens: number };
  seeking?: { model: string; tokens: number };
  flexPercent?: number;

  status: SwapStatus;
  matchedWith?: string;
  validUntil: string;

  nonce: string;
  timestamp: string;
  signature: string;
}

// ============================================================================
// SOTA Index
// ============================================================================

export type ModelTier = 'frontier' | 'mid' | 'economy';

export interface SOTAIndex {
  models: ModelPricing[];
  lastUpdated: string;
  source: string;
}

export interface ModelPricing {
  provider: string;
  model: string;
  tier: ModelTier;
  arenaElo: number;
  compositeScore: number;
  officialPrice: number;
  indexPrice: number;
  volume24h: number;
  priceChange24h: number;
  supplyTokens: number;
  demandTokens: number;
  utilizationRate: number;
}

// ============================================================================
// Search
// ============================================================================

export interface SearchQuery {
  query: string;
  filters?: SearchFilters;
}

export interface SearchFilters {
  protocols?: string[];
  capabilities?: string[];
  minTrustScore?: number;
  maxPricePerUnit?: number;
  regions?: string[];
  languages?: string[];
  tags?: string[];
  limit?: number;
  offset?: number;
  minSimilarity?: number;
}

export interface SearchResult {
  agent: UniversalAgentCard;
  relevanceScore: number;
  trustScore: number;
  capabilityMatch: number;
  overallScore: number;
}

// ============================================================================
// Protocol Adapter
// ============================================================================

export interface DetectionResult {
  detected: boolean;
  confidence: number;
  protocol?: string;
}

export interface RawAgentData {
  protocol: string;
  data: unknown;
  sourceUrl: string;
  fetchedAt: string;
}

export interface ProtocolAdapter {
  readonly protocol: string;
  readonly version: string;

  detect(url: string): Promise<DetectionResult>;
  fetch(url: string): Promise<RawAgentData>;
  normalize(raw: RawAgentData): UniversalAgentCard;
  translateIntent?(intent: TaskIntent): unknown;
  parseOffer?(raw: unknown): TaskOffer;
}
