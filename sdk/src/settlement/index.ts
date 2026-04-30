/**
 * @metanexus/settlement — Compute-native settlement primitives.
 *
 * This module implements a deterministic MVP for Model Quota Swap:
 * - SOTA Index pricing for model quota assets
 * - QuotaCertificate builders / accounting helpers
 * - swap quote generation and fair-value checks
 * - in-memory swap book for demos and tests
 */

import { randomUUID } from 'node:crypto';
import { generateNonce } from '../core/crypto.js';
import type { ModelPricing, ModelTier, QuotaCertificate, SOTAIndex, SwapOrder } from '../core/types.js';

export interface ModelIndexInput {
  provider: string;
  model: string;
  tier: ModelTier;
  /** Official provider price per 1M tokens, normalized to USD. */
  officialPrice: number;
  /** Quality multiplier, e.g. 1.35 for frontier reasoning, 0.7 for economy. */
  quality: number;
  /** Scarcity multiplier from rate limits, waitlists, and quota tightness. */
  scarcity: number;
  /** Market-demand multiplier from recent order flow. */
  marketAdjustment: number;
  arenaElo?: number;
  volume24h?: number;
  priceChange24h?: number;
  supplyTokens?: number;
  demandTokens?: number;
}

export interface QuotaCertificateInput {
  issuer: string;
  grantee: string;
  provider: string;
  model: string;
  tokensGranted: number;
  proxyEndpoint: string;
  validUntil: string;
  validFrom?: string;
  tokensUsed?: number;
  revocable?: boolean;
  escrowId?: string;
  signature?: string;
}

export interface SwapQuoteRequest {
  from: { model: string; tokens: number };
  to: { model: string; tokens?: number };
  /** Max percentage value gap accepted by the requester. Default: 5%. */
  maxValueGapPercent?: number;
}

export interface SwapQuote {
  from: { model: string; tokens: number; indexPrice: number; value: number };
  to: { model: string; tokens: number; indexPrice: number; value: number };
  exchangeRate: number;
  valueGapPercent: number;
  fair: boolean;
  recommendation: 'accept' | 'renegotiate';
  rationale: string;
}

export interface SwapExecution {
  executionId: string;
  sellOrder: SwapOrder;
  buyOrder: SwapOrder;
  quote: SwapQuote;
  status: 'matched' | 'completed';
  createdAt: string;
  completedAt?: string;
}

const DEFAULT_MODELS: ModelIndexInput[] = [
  { provider: 'openai', model: 'gpt-5.5', tier: 'frontier', officialPrice: 15, quality: 1.35, scarcity: 1.15, marketAdjustment: 1.08, arenaElo: 1460, supplyTokens: 20_000_000, demandTokens: 35_000_000 },
  { provider: 'anthropic', model: 'claude-sonnet-4.6', tier: 'frontier', officialPrice: 12, quality: 1.28, scarcity: 1.2, marketAdjustment: 1.05, arenaElo: 1430, supplyTokens: 12_000_000, demandTokens: 27_000_000 },
  { provider: 'google', model: 'gemini-3-pro', tier: 'frontier', officialPrice: 10, quality: 1.22, scarcity: 1.05, marketAdjustment: 1.02, arenaElo: 1410, supplyTokens: 30_000_000, demandTokens: 32_000_000 },
  { provider: 'google', model: 'gemini-flash', tier: 'economy', officialPrice: 0.35, quality: 0.72, scarcity: 0.95, marketAdjustment: 1.18, arenaElo: 1230, supplyTokens: 250_000_000, demandTokens: 410_000_000 },
  { provider: 'minimax', model: 'minimax-m2.7', tier: 'mid', officialPrice: 1.2, quality: 0.82, scarcity: 0.9, marketAdjustment: 0.96, arenaElo: 1275, supplyTokens: 80_000_000, demandTokens: 65_000_000 },
];

/** Compute SOTA index price per 1M tokens. */
export function computeIndexPrice(input: Pick<ModelIndexInput, 'officialPrice' | 'quality' | 'scarcity' | 'marketAdjustment'>): number {
  return roundMoney(input.officialPrice * input.quality * input.scarcity * input.marketAdjustment);
}

export function createSOTAIndex(inputs: ModelIndexInput[] = DEFAULT_MODELS, source = 'metanexus-static-mvp'): SOTAIndex {
  return {
    source,
    lastUpdated: new Date().toISOString(),
    models: inputs.map(toModelPricing),
  };
}

export function getModel(index: SOTAIndex, model: string): ModelPricing {
  const found = index.models.find(m => m.model === model);
  if (!found) throw new Error(`Unknown model in SOTA index: ${model}`);
  return found;
}

export function quoteSwap(index: SOTAIndex, request: SwapQuoteRequest): SwapQuote {
  if (request.from.tokens <= 0) throw new Error('from.tokens must be positive');
  if (request.to.tokens !== undefined && request.to.tokens <= 0) throw new Error('to.tokens must be positive');

  const fromModel = getModel(index, request.from.model);
  const toModel = getModel(index, request.to.model);
  const fromValue = valueTokens(request.from.tokens, fromModel.indexPrice);
  const impliedToTokens = (fromValue / toModel.indexPrice) * 1_000_000;
  const toTokens = request.to.tokens ?? Math.floor(impliedToTokens);
  const toValue = valueTokens(toTokens, toModel.indexPrice);
  const denominator = Math.max(fromValue, toValue, Number.EPSILON);
  const valueGapPercent = Math.abs(fromValue - toValue) / denominator * 100;
  const maxGap = request.maxValueGapPercent ?? 5;
  const fair = valueGapPercent <= maxGap;

  return {
    from: { model: fromModel.model, tokens: request.from.tokens, indexPrice: fromModel.indexPrice, value: roundMoney(fromValue) },
    to: { model: toModel.model, tokens: toTokens, indexPrice: toModel.indexPrice, value: roundMoney(toValue) },
    exchangeRate: toTokens / request.from.tokens,
    valueGapPercent: Number(valueGapPercent.toFixed(2)),
    fair,
    recommendation: fair ? 'accept' : 'renegotiate',
    rationale: fair
      ? `Fair swap within ${maxGap}% value gap based on SOTA index prices.`
      : `Value gap exceeds ${maxGap}%; adjust target tokens toward ${Math.floor(impliedToTokens).toLocaleString()}.`,
  };
}

export function createQuotaCertificate(input: QuotaCertificateInput): QuotaCertificate {
  return {
    id: randomUUID(),
    issuer: input.issuer,
    grantee: input.grantee,
    model: input.model,
    provider: input.provider,
    tokensGranted: input.tokensGranted,
    tokensUsed: input.tokensUsed ?? 0,
    proxyEndpoint: input.proxyEndpoint,
    validFrom: input.validFrom ?? new Date().toISOString(),
    validUntil: input.validUntil,
    revocable: input.revocable ?? true,
    escrowId: input.escrowId,
    signature: input.signature ?? 'unsigned:mvp',
  };
}

export function availableTokens(cert: QuotaCertificate): number {
  return Math.max(0, cert.tokensGranted - cert.tokensUsed);
}

export function consumeQuota(cert: QuotaCertificate, tokens: number): QuotaCertificate {
  if (tokens <= 0) throw new Error('tokens must be positive');
  if (availableTokens(cert) < tokens) throw new Error('insufficient quota');
  return { ...cert, tokensUsed: cert.tokensUsed + tokens };
}

export function createBarterOrder(params: {
  agentId: string;
  offering: { model: string; tokens: number };
  seeking: { model: string; tokens: number };
  validUntil?: string;
  flexPercent?: number;
  signature?: string;
}): SwapOrder {
  return {
    orderId: randomUUID(),
    type: 'barter',
    agentId: params.agentId,
    offering: params.offering,
    seeking: params.seeking,
    flexPercent: params.flexPercent ?? 5,
    status: 'open',
    validUntil: params.validUntil ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    nonce: generateNonce(),
    timestamp: new Date().toISOString(),
    signature: params.signature ?? 'unsigned:mvp',
  };
}

export class InMemorySwapBook {
  private readonly orders = new Map<string, SwapOrder>();

  add(order: SwapOrder): SwapOrder {
    this.orders.set(order.orderId, order);
    return order;
  }

  listOpen(): SwapOrder[] {
    return Array.from(this.orders.values()).filter(o => o.status === 'open');
  }

  findMatch(order: SwapOrder, index: SOTAIndex): SwapExecution | undefined {
    if (!order.offering || !order.seeking) return undefined;
    for (const candidate of this.listOpen()) {
      if (candidate.orderId === order.orderId || !candidate.offering || !candidate.seeking) continue;
      const reciprocal =
        candidate.offering.model === order.seeking.model &&
        candidate.seeking.model === order.offering.model;
      if (!reciprocal) continue;

      const quote = quoteSwap(index, {
        from: order.offering,
        to: candidate.offering,
        maxValueGapPercent: Math.max(order.flexPercent ?? 5, candidate.flexPercent ?? 5),
      });
      if (!quote.fair) continue;

      const now = new Date().toISOString();
      const execution: SwapExecution = {
        executionId: randomUUID(),
        sellOrder: { ...order, status: 'matched', matchedWith: candidate.orderId },
        buyOrder: { ...candidate, status: 'matched', matchedWith: order.orderId },
        quote,
        status: 'matched',
        createdAt: now,
      };
      this.orders.set(order.orderId, execution.sellOrder);
      this.orders.set(candidate.orderId, execution.buyOrder);
      return execution;
    }
    return undefined;
  }
}

export function formatSwapQuote(quote: SwapQuote): string {
  return [
    `Offer: ${quote.from.tokens.toLocaleString()} ${quote.from.model} tokens ($${quote.from.value.toFixed(2)} index value)`,
    `Receive: ${quote.to.tokens.toLocaleString()} ${quote.to.model} tokens ($${quote.to.value.toFixed(2)} index value)`,
    `Rate: 1 ${quote.from.model} token ≈ ${quote.exchangeRate.toFixed(4)} ${quote.to.model} tokens`,
    `Value gap: ${quote.valueGapPercent.toFixed(2)}% — ${quote.recommendation.toUpperCase()}`,
    quote.rationale,
  ].join('\n');
}

function toModelPricing(input: ModelIndexInput): ModelPricing {
  const indexPrice = computeIndexPrice(input);
  const supply = input.supplyTokens ?? 0;
  const demand = input.demandTokens ?? 0;
  return {
    provider: input.provider,
    model: input.model,
    tier: input.tier,
    arenaElo: input.arenaElo ?? 0,
    compositeScore: Number((input.quality * 100).toFixed(2)),
    officialPrice: input.officialPrice,
    indexPrice,
    volume24h: input.volume24h ?? 0,
    priceChange24h: input.priceChange24h ?? 0,
    supplyTokens: supply,
    demandTokens: demand,
    utilizationRate: supply > 0 ? Number(Math.min(1, demand / supply).toFixed(4)) : 0,
  };
}

function valueTokens(tokens: number, pricePerMToken: number): number {
  return (tokens / 1_000_000) * pricePerMToken;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(6));
}
