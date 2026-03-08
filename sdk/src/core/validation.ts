/**
 * MetaNexus Validation — Zod schemas for runtime type checking
 */

import { z } from 'zod';

// ============================================================================
// Primitives
// ============================================================================

const ed25519Key = z.string().regex(/^ed25519:[A-Za-z0-9+/=]+$/);
const ed25519Sig = z.string().regex(/^ed25519:[A-Za-z0-9+/=]+$/);
const isoDatetime = z.string().datetime();
const semver = z.string().regex(/^\d+\.\d+(\.\d+)?$/);
const capabilityId = z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/);
const ethAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

// ============================================================================
// Capability
// ============================================================================

export const PricingInfoSchema = z.object({
  model: z.enum(['per_request', 'per_token', 'per_unit', 'flat', 'negotiable']),
  amount: z.number().min(0),
  currency: z.string().default('USD'),
  unit: z.string().optional(),
});

export const QualityMetricSchema = z.object({
  benchmark: z.string(),
  score: z.number(),
  date: z.string().optional(),
});

export const CapabilitySchema = z.object({
  id: capabilityId,
  name: z.string().max(128),
  description: z.string().max(1024),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  qualityMetrics: z.array(QualityMetricSchema).optional(),
  pricing: PricingInfoSchema.optional(),
});

// ============================================================================
// Protocol Support
// ============================================================================

export const ProtocolSupportSchema = z.object({
  protocol: z.enum(['a2a', 'mcp', 'ucp', 'metad', 'rest', 'graphql', 'grpc', 'custom']),
  version: z.string(),
  endpoint: z.string().url(),
  manifest: z.string().url().optional(),
});

// ============================================================================
// Settlement
// ============================================================================

const AssetTypeSchema = z.enum(['usdc', 'compute_credit', 'model_quota', 'data_credit', 'storage_credit']);

export const SettlementConfigSchema = z.object({
  acceptedAssets: z.array(z.object({
    type: AssetTypeSchema,
    details: z.record(z.unknown()).optional(),
  })),
  preferredAsset: AssetTypeSchema.optional(),
  usdc: z.object({
    address: ethAddress,
    chain: z.enum(['base', 'ethereum', 'polygon']),
  }).optional(),
  quotas: z.array(z.object({
    provider: z.string(),
    model: z.string(),
    tokensAvailable: z.number().int().min(0),
    ratePerMToken: z.number().min(0).optional(),
  })).optional(),
  compute: z.array(z.object({
    gpuType: z.string(),
    hoursAvailable: z.number().min(0),
    ratePerHour: z.number().min(0).optional(),
  })).optional(),
});

// ============================================================================
// SLA
// ============================================================================

export const SLADeclarationSchema = z.object({
  uptimePercent: z.number().min(0).max(100).optional(),
  latencyP50Ms: z.number().int().min(0).optional(),
  latencyP99Ms: z.number().int().min(0).optional(),
  throughputRps: z.number().int().min(0).optional(),
  maxConcurrency: z.number().int().min(1).optional(),
  supportHours: z.string().optional(),
});

// ============================================================================
// Trust (read-only, MetaNexus-populated)
// ============================================================================

export const TrustMetadataSchema = z.object({
  score: z.number().min(0).max(100),
  confidence: z.enum(['low', 'medium', 'high']),
  breakdown: z.object({
    reliability: z.number(),
    quality: z.number(),
    timeliness: z.number(),
    tenure: z.number(),
    stake: z.number(),
  }),
  totalTransactions: z.number().int(),
  disputeRate: z.number(),
  lastVerified: isoDatetime.optional(),
  flags: z.array(z.string()).optional(),
});

// ============================================================================
// UniversalAgentCard
// ============================================================================

export const UniversalAgentCardSchema = z.object({
  id: z.string().url(),
  name: z.string().max(128),
  description: z.string().max(2048),
  version: semver,

  capabilities: z.array(CapabilitySchema).min(1),
  protocols: z.array(ProtocolSupportSchema).min(1),

  endpoint: z.string().url(),
  endpoints: z.record(z.string().url()).optional(),

  publicKey: ed25519Key,
  domain: z.string(),
  domainVerification: z.object({
    method: z.enum(['well_known', 'dns_txt', 'meta_tag']),
    value: z.string().optional(),
    verifiedAt: isoDatetime.optional(),
    verifiedBy: z.string().optional(),
  }).optional(),

  trust: TrustMetadataSchema.optional(),

  settlement: SettlementConfigSchema.optional(),
  sla: SLADeclarationSchema.optional(),
  rateLimit: z.object({
    requestsPerMinute: z.number().int().min(1).optional(),
    requestsPerDay: z.number().int().min(1).optional(),
    concurrency: z.number().int().min(1).optional(),
  }).optional(),

  regions: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),

  created: isoDatetime,
  updated: isoDatetime,
  signature: ed25519Sig,
});

// ============================================================================
// TaskIntent
// ============================================================================

export const TaskIntentSchema = z.object({
  intentId: z.string().uuid(),
  clientAgentId: z.string().url(),
  type: z.enum(['task', 'query', 'purchase', 'barter']),

  task: z.object({
    description: z.string(),
    capabilityRequired: z.string().optional(),
    input: z.unknown().optional(),
    constraints: z.object({
      quality: z.enum(['best', 'good', 'fast']).optional(),
      latencyMs: z.number().optional(),
      region: z.array(z.string()).optional(),
      compliance: z.array(z.string()).optional(),
      minTrustScore: z.number().min(0).max(100).optional(),
    }).optional(),
  }),

  budget: z.object({
    maxAmount: z.number().optional(),
    currency: z.string().optional(),
    acceptedAssets: z.array(AssetTypeSchema).optional(),
    barterOffer: z.object({
      asset: AssetTypeSchema,
      model: z.string().optional(),
      tokens: z.number().optional(),
      gpuType: z.string().optional(),
      hours: z.number().optional(),
      details: z.record(z.unknown()).optional(),
    }).optional(),
  }).optional(),

  ttl: z.number().int().positive(),
  deadline: isoDatetime.optional(),

  nonce: z.string(),
  timestamp: isoDatetime,
  signature: ed25519Sig,
});

// ============================================================================
// TaskOffer
// ============================================================================

export const TaskOfferSchema = z.object({
  offerId: z.string().uuid(),
  intentId: z.string().uuid(),
  providerAgentId: z.string().url(),

  proposal: z.object({
    description: z.string(),
    estimatedDuration: z.number().optional(),
    qualityGuarantee: z.string().optional(),
  }),

  pricing: z.object({
    amount: z.number(),
    asset: z.string(),
    breakdown: z.array(z.object({
      item: z.string(),
      amount: z.number(),
      asset: z.string(),
    })).optional(),
  }),

  barterRequest: z.object({
    asset: AssetTypeSchema,
    model: z.string().optional(),
    tokens: z.number().optional(),
    gpuType: z.string().optional(),
    hours: z.number().optional(),
    details: z.record(z.unknown()).optional(),
  }).optional(),

  validUntil: isoDatetime,
  slaCommitment: z.object({
    uptimePercent: z.number(),
    latencyP50Ms: z.number(),
    latencyP99Ms: z.number(),
    penalty: z.string().optional(),
  }).optional(),

  nonce: z.string(),
  timestamp: isoDatetime,
  signature: ed25519Sig,
});

// ============================================================================
// Quota Certificate
// ============================================================================

export const QuotaCertificateSchema = z.object({
  id: z.string().uuid(),
  issuer: z.string().url(),
  grantee: z.string().url(),
  model: z.string(),
  provider: z.string(),
  tokensGranted: z.number().int().positive(),
  tokensUsed: z.number().int().min(0),
  proxyEndpoint: z.string().url(),
  validFrom: isoDatetime,
  validUntil: isoDatetime,
  revocable: z.boolean(),
  escrowId: z.string().optional(),
  signature: ed25519Sig,
});

// ============================================================================
// Validation helpers
// ============================================================================

export function validateAgentCard(data: unknown) {
  return UniversalAgentCardSchema.safeParse(data);
}

export function validateTaskIntent(data: unknown) {
  return TaskIntentSchema.safeParse(data);
}

export function validateTaskOffer(data: unknown) {
  return TaskOfferSchema.safeParse(data);
}

export function validateQuotaCertificate(data: unknown) {
  return QuotaCertificateSchema.safeParse(data);
}
