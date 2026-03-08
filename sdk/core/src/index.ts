// ============================================================================
// @metanexus/core — Public API
// ============================================================================

// Types
export type {
  UniversalAgentCard,
  AgentOwner,
  Capability,
  QualityMetric,
  PricingInfo,
  ProtocolName,
  ProtocolSupport,
  DomainProof,
  TrustMetadata,
  TrustBreakdown,
  TrustFlag,
  AssetType,
  SettlementConfig,
  AcceptedAsset,
  OfferedAsset,
  USDCConfig,
  QuotaOffer,
  ComputeOffer,
  SLADeclaration,
  SLAVerification,
  RateLimitInfo,
  IntentType,
  TaskIntent,
  TaskConstraints,
  BarterOffer,
  TaskOffer,
  PriceBreakdown,
  ExecutionStatus,
  TaskExecution,
  PaymentRecord,
  EscrowRecord,
  VerificationResult,
  SLAMetrics,
  ModelTier,
  SOTAIndex,
  ModelPricing,
  SwapOrderStatus,
  SwapOrder,
  DelegationMethod,
  QuotaDelegation,
  SearchQuery,
  SearchFilters,
  SearchResult,
  CrawlSource,
  CrawlTarget,
  CrawlResult,
} from './types.js';

// Crypto
export {
  generateKeyPair,
  sign,
  verify,
  canonicalize,
  signCard,
  verifyCard,
} from './crypto.js';
export type { KeyPair } from './crypto.js';

// Validation
export {
  UniversalAgentCardSchema,
  CapabilitySchema,
  ProtocolSupportSchema,
  SettlementConfigSchema,
  TaskIntentSchema,
  TaskOfferSchema,
  TrustMetadataSchema,
  validateAgentCard,
  validateIntent,
  validateOffer,
} from './validation.js';
export type { ValidationResult } from './validation.js';
