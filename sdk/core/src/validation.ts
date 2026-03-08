// ============================================================================
// MetaNexus Validation
// Zod schemas for runtime validation of all core types
// ============================================================================

import { z } from 'zod';

// ─── Primitives ─────────────────────────────────────────────────────────────

const capabilityIdPattern = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;
const ed25519SigPattern = /^ed25519:[A-Za-z0-9_-]+$/;
const ethAddressPattern = /^0x[a-fA-F0-9]{40}$/;

// ─── Capability ─────────────────────────────────────────────────────────────

export const QualityMetricSchema = z.object({
  benchmark: z.string(),
  score: z.number(),
  details: z.string().optional(),
});

export const PricingInfoSchema = z.object({
  model: z.enum(['per_request', 'per_token', 'per_unit', 'per_hour', 'flat', 'negotiable']),
  amount: z.number().nonnegative(),
  currency: z.string(),
  unit: z.string().optional(),
});

export const CapabilitySchema = z.object({
  id: z.string().regex(capabilityIdPattern, 'Capability ID must be namespaced: "domain.subdomain"'),
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  qualityMetrics: z.array(QualityMetricSchema).optional(),
  pricing: PricingInfoSchema.optional(),
});

// ─── Protocol Support ───────────────────────────────────────────────────────

export const ProtocolSupportSchema = z.object({
  protocol: z.enum(['a2a', 'mcp', 'ucp', 'metad', 'rest', 'graphql', 'grpc', 'custom']),
  version: z.string(),
  endpoint: z.string().url(),
  manifest: z.string().url().optional(),
});

// ─── Domain Proof ───────────────────────────────────────────────────────────

export const DomainProofSchema = z.object({
  method: z.enum(['dns_txt', 'well_known', 'meta_tag']),
  value: z.string(),
  verifiedAt: z.string().datetime().optional(),
  verifiedBy: z.string().optional(),
});

// ─── Trust ──────────────────────────────────────────────────────────────────

export const TrustBreakdownSchema = z.object({
  reliability: z.number().min(0).max(100),
  quality: z.number().min(0).max(100),
  timeliness: z.number().min(0).max(100),
  tenure: z.number().min(0).max(100),
  stake: z.number().min(0).max(100),
});

export const TrustMetadataSchema = z.object({
  score: z.number().min(0).max(100),
  breakdown: TrustBreakdownSchema,
  confidence: z.number().min(0).max(1),
  computedAt: z.string().datetime(),
  flags: z.array(z.enum([
    'new_agent',
    'quality_declining',
    'performance_degrading',
    'reliability_issue',
    'high_dispute_rate',
    'stake_at_risk',
  ])).optional(),
});

// ─── Settlement ─────────────────────────────────────────────────────────────

const assetTypes = z.enum(['usdc', 'compute_credit', 'model_quota', 'data_credit', 'storage_credit']);

export const USDCConfigSchema = z.object({
  address: z.string().regex(ethAddressPattern, 'Invalid Ethereum address'),
  chain: z.enum(['base', 'ethereum', 'polygon', 'arbitrum']),
});

export const QuotaOfferSchema = z.object({
  provider: z.string(),
  model: z.string(),
  tokensAvailable: z.number().int().nonnegative(),
  ratePerMToken: z.number().nonnegative().optional(),
});

export const ComputeOfferSchema = z.object({
  gpuType: z.string(),
  hoursAvailable: z.number().nonnegative(),
  ratePerHour: z.number().nonnegative().optional(),
});

export const SettlementConfigSchema = z.object({
  acceptedAssets: z.array(z.object({
    type: assetTypes,
    details: z.record(z.unknown()).optional(),
  })),
  preferredAsset: assetTypes.optional(),
  offeredAssets: z.array(z.object({
    type: assetTypes,
    details: z.record(z.unknown()).optional(),
  })).optional(),
  usdc: USDCConfigSchema.optional(),
  quotas: z.array(QuotaOfferSchema).optional(),
  compute: z.array(ComputeOfferSchema).optional(),
});

// ─── SLA ────────────────────────────────────────────────────────────────────

export const SLADeclarationSchema = z.object({
  uptime: z.number().min(0).max(100).optional(),
  latencyP50Ms: z.number().int().nonnegative().optional(),
  latencyP99Ms: z.number().int().nonnegative().optional(),
  throughputRps: z.number().int().nonnegative().optional(),
  maxConcurrent: z.number().int().positive().optional(),
});

export const RateLimitInfoSchema = z.object({
  requestsPerMinute: z.number().int().positive().optional(),
  requestsPerDay: z.number().int().positive().optional(),
  tokensPerMinute: z.number().int().positive().optional(),
});

// ─── UniversalAgentCard ─────────────────────────────────────────────────────

export const AgentOwnerSchema = z.object({
  name: z.string().optional(),
  url: z.string().url().optional(),
  email: z.string().email().optional(),
});

export const UniversalAgentCardSchema = z.object({
  id: z.string().url(),
  name: z.string().min(1).max(256),
  description: z.string().max(4096),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  capabilities: z.array(CapabilitySchema).min(1),
  protocols: z.array(ProtocolSupportSchema).default([]),
  endpoint: z.string().url(),
  endpoints: z.record(z.string().url()).optional(),
  publicKey: z.string(),
  domain: z.string(),
  domainVerification: DomainProofSchema.optional(),
  trust: TrustMetadataSchema.optional(),
  settlement: SettlementConfigSchema.optional(),
  sla: SLADeclarationSchema.optional(),
  rateLimit: RateLimitInfoSchema.optional(),
  regions: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  owner: AgentOwnerSchema.optional(),
  created: z.string().datetime(),
  updated: z.string().datetime(),
  signature: z.string().regex(ed25519SigPattern, 'Signature must be "ed25519:<base64url>"'),
});

// ─── TaskIntent ─────────────────────────────────────────────────────────────

export const TaskConstraintsSchema = z.object({
  quality: z.enum(['best', 'good', 'fast']).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  region: z.array(z.string()).optional(),
  compliance: z.array(z.string()).optional(),
  minTrustScore: z.number().min(0).max(100).optional(),
});

export const BarterOfferSchema = z.object({
  asset: assetTypes,
  details: z.record(z.unknown()),
});

export const TaskIntentSchema = z.object({
  intentId: z.string().uuid(),
  clientAgentId: z.string().url(),
  type: z.enum(['task', 'query', 'purchase', 'barter']),
  task: z.object({
    description: z.string().min(1),
    capabilityRequired: z.string().optional(),
    input: z.unknown().optional(),
    constraints: TaskConstraintsSchema.optional(),
  }),
  budget: z.object({
    maxAmount: z.number().nonnegative().optional(),
    currency: z.string().optional(),
    acceptedAssets: z.array(assetTypes).optional(),
    barterOffer: BarterOfferSchema.optional(),
  }).optional(),
  ttl: z.number().int().positive(),
  deadline: z.string().datetime().optional(),
  nonce: z.string(),
  timestamp: z.string().datetime(),
  signature: z.string().regex(ed25519SigPattern),
});

// ─── TaskOffer ──────────────────────────────────────────────────────────────

export const TaskOfferSchema = z.object({
  offerId: z.string().uuid(),
  intentId: z.string().uuid(),
  providerAgentId: z.string().url(),
  proposal: z.object({
    description: z.string(),
    estimatedDuration: z.number().nonnegative().optional(),
    qualityGuarantee: z.string().optional(),
  }),
  pricing: z.object({
    amount: z.number().nonnegative(),
    asset: z.string(),
    breakdown: z.array(z.object({
      item: z.string(),
      amount: z.number(),
      unit: z.string(),
    })).optional(),
  }),
  barterRequest: BarterOfferSchema.optional(),
  validUntil: z.string().datetime(),
  slaCommitment: SLADeclarationSchema.optional(),
  nonce: z.string(),
  timestamp: z.string().datetime(),
  signature: z.string().regex(ed25519SigPattern),
});

// ─── Validation Helpers ─────────────────────────────────────────────────────

export type ValidationResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  errors: string[];
};

/**
 * Validate an AgentCard. Returns typed result.
 */
export function validateAgentCard(data: unknown): ValidationResult<z.infer<typeof UniversalAgentCardSchema>> {
  const result = UniversalAgentCardSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

/**
 * Validate a TaskIntent.
 */
export function validateIntent(data: unknown): ValidationResult<z.infer<typeof TaskIntentSchema>> {
  const result = TaskIntentSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

/**
 * Validate a TaskOffer.
 */
export function validateOffer(data: unknown): ValidationResult<z.infer<typeof TaskOfferSchema>> {
  const result = TaskOfferSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}
