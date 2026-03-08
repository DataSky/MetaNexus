/**
 * Basic Trust Score — Phase 1
 *
 * Computes a behavioral trust score from:
 *   1. HTTP health probe (uptime detection)
 *   2. Longevity (days since registration)
 *   3. Transaction history (when available)
 *   4. Stake (when available, Phase 3)
 *
 * Score is normalized to [0, 100].
 * Phase 2 will add SLA drift detection and Stake & Slash.
 */

import type { UniversalAgentCard, TrustScore, TrustBreakdown } from '../core/types.js';

// ---- Weights (env-configurable, see MetaD trust-config pattern) -------------

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  const n = raw !== undefined ? Number(raw) : NaN;
  return isNaN(n) ? fallback : n;
}

export interface TrustWeights {
  base: number;             // base score every agent starts with
  longevityPerDay: number;  // points/day since registration
  uptimeBonus: number;      // bonus when probe succeeds
  txMultiplier: number;     // points per recorded transaction
  txCap: number;            // max points from transactions
  inactivityPerDay: number; // penalty points/day of inactivity
}

function loadWeights(): TrustWeights {
  return {
    base: envNum('TRUST_BASE', 10),
    longevityPerDay: envNum('TRUST_LONGEVITY', 0.1),
    uptimeBonus: envNum('TRUST_UPTIME_BONUS', 20),
    txMultiplier: envNum('TRUST_TX_MULT', 2),
    txCap: envNum('TRUST_TX_CAP', 40),
    inactivityPerDay: envNum('TRUST_INACTIVITY', 0.05),
  };
}

// ---- HTTP Probe -------------------------------------------------------------

export interface ProbeResult {
  reachable: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
}

/**
 * HTTP GET probe against an agent's endpoint.
 * Uses AbortSignal.timeout to avoid hanging.
 */
export async function probeEndpoint(url: string, timeoutMs = 5000): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      reachable: res.ok || res.status < 500,
      latencyMs: Date.now() - start,
      statusCode: res.status,
    };
  } catch (err) {
    return {
      reachable: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- Score computation ------------------------------------------------------

export interface TrustInput {
  card: UniversalAgentCard;
  probe?: ProbeResult;
  totalTransactions?: number;
  daysSinceLastActive?: number;
}

/**
 * Compute a TrustScore from available signals.
 * All sub-scores are clamped independently; total clamped to [0, 100].
 */
export function computeTrustScore(input: TrustInput): TrustScore {
  const w = loadWeights();
  const now = new Date().toISOString();

  // Longevity: days since registration
  const registeredAt = new Date(input.card.created).getTime();
  const ageMs = Date.now() - registeredAt;
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));

  // Reliability (probe + uptime)
  let reliability = w.base + ageDays * w.longevityPerDay;
  if (input.probe?.reachable) {
    reliability += w.uptimeBonus;
    // Latency bonus: under 500ms → extra 5pts, over 2s → penalty 5pts
    if (input.probe.latencyMs < 500) reliability += 5;
    else if (input.probe.latencyMs > 2000) reliability -= 5;
  }
  reliability = Math.min(Math.max(reliability, 0), 40);

  // Quality: declared SLA quality (Phase 1: just presence)
  const quality = input.card.sla ? 15 : 5;

  // Timeliness: inactivity penalty
  const inactivityPenalty = (input.daysSinceLastActive ?? 0) * w.inactivityPerDay;
  const timeliness = Math.min(Math.max(15 - inactivityPenalty, 0), 15);

  // Tenure: capped longevity sub-score
  const tenure = Math.min(ageDays * w.longevityPerDay, 15);

  // Stake: Phase 3 — always 0 for now
  const stake = 0;

  const breakdown: TrustBreakdown = {
    reliability: Math.round(reliability * 10) / 10,
    quality: Math.round(quality * 10) / 10,
    timeliness: Math.round(timeliness * 10) / 10,
    tenure: Math.round(tenure * 10) / 10,
    stake,
  };

  // Transaction boost
  const txScore = Math.min((input.totalTransactions ?? 0) * w.txMultiplier, w.txCap);
  const rawTotal = breakdown.reliability + breakdown.quality + breakdown.timeliness + txScore;
  const score = Math.round(Math.min(Math.max(rawTotal, 0), 100) * 10) / 10;

  const confidence: TrustScore['confidence'] =
    score > 60 ? 'high' : score > 30 ? 'medium' : 'low';

  return { score, breakdown, confidence, computedAt: now };
}

// ---- Probe + score convenience ----------------------------------------------

/**
 * Probe an agent's endpoint and compute its trust score.
 */
export async function probeAndScore(card: UniversalAgentCard): Promise<TrustScore> {
  const probe = await probeEndpoint(card.endpoint);
  return computeTrustScore({ card, probe });
}
