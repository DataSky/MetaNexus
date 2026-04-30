/**
 * TrustLedger — execution-driven trust score updates
 *
 * Every time a TaskExecution reaches a terminal state (completed / failed /
 * disputed), the ledger records the outcome and recomputes the provider's
 * trust score from the full execution history.
 *
 * This is Phase 2 of the trust system:
 *   Phase 1: static probe (uptime + latency)
 *   Phase 2: behavioral history (this file)
 *   Phase 3: stake & slash (future)
 */

import type { TaskExecution, TrustScore, TrustBreakdown } from '../core/types.js';

// ---- Types -------------------------------------------------------------------

export interface ExecutionOutcome {
  executionId: string;
  intentId: string;
  offerId: string;
  providerAgentId: string;
  clientAgentId: string;
  status: 'completed' | 'failed' | 'disputed';
  /** Duration from accepted → completed/failed in ms */
  durationMs: number;
  /** Client rating 1-5, if provided */
  clientRating?: number;
  /** Whether the execution completed within the offer's estimated duration */
  onTime: boolean;
  recordedAt: string;
}

export interface AgentTrustHistory {
  agentId: string;
  outcomes: ExecutionOutcome[];
  /** Cached score, recomputed on each update */
  cachedScore: TrustScore;
  lastUpdated: string;
}

// ---- Weights -----------------------------------------------------------------

const WEIGHTS = {
  successRate: 40,      // 0-40 pts: % of completed vs total
  qualityScore: 25,     // 0-25 pts: avg client rating (1-5 → 0-25)
  timelinessScore: 20,  // 0-20 pts: % of on-time completions
  volumeScore: 15,      // 0-15 pts: log-scaled transaction volume
} as const;

// ---- Score computation -------------------------------------------------------

export function computeHistoricalTrust(outcomes: ExecutionOutcome[]): TrustScore {
  const now = new Date().toISOString();

  if (outcomes.length === 0) {
    return {
      score: 0,
      confidence: 'low',
      breakdown: { reliability: 0, quality: 0, timeliness: 0, tenure: 0, stake: 0 },
      computedAt: now,
    };
  }

  const total = outcomes.length;
  const completed = outcomes.filter(o => o.status === 'completed').length;
  const failed = outcomes.filter(o => o.status === 'failed').length;
  const disputed = outcomes.filter(o => o.status === 'disputed').length;

  // Reliability: success rate (completed / total), penalize disputes more
  const successRate = (completed - disputed * 0.5) / total;
  const reliability = Math.max(0, Math.min(WEIGHTS.successRate, successRate * WEIGHTS.successRate));

  // Quality: average client rating (only rated completions)
  const rated = outcomes.filter(o => o.clientRating !== undefined && o.status === 'completed');
  const avgRating = rated.length > 0
    ? rated.reduce((sum, o) => sum + (o.clientRating ?? 0), 0) / rated.length
    : 0;
  // 1-5 scale → 0-25 pts; unrated completions get 3/5 (neutral)
  const effectiveRating = rated.length > 0 ? avgRating : (completed > 0 ? 3 : 0);
  const quality = Math.max(0, Math.min(WEIGHTS.qualityScore, ((effectiveRating - 1) / 4) * WEIGHTS.qualityScore));

  // Timeliness: % of on-time completions
  const completedOutcomes = outcomes.filter(o => o.status === 'completed');
  const onTimeRate = completedOutcomes.length > 0
    ? completedOutcomes.filter(o => o.onTime).length / completedOutcomes.length
    : 0;
  const timeliness = Math.max(0, Math.min(WEIGHTS.timelinessScore, onTimeRate * WEIGHTS.timelinessScore));

  // Volume: log-scaled (1 tx → 0, 10 → ~7.5, 100 → ~15)
  const volumeScore = Math.min(WEIGHTS.volumeScore, Math.log10(Math.max(1, total)) * (WEIGHTS.volumeScore / 2));

  const breakdown: TrustBreakdown = {
    reliability: round1(reliability),
    quality: round1(quality),
    timeliness: round1(timeliness),
    tenure: round1(volumeScore),
    stake: 0,
  };

  const rawScore = breakdown.reliability + breakdown.quality + breakdown.timeliness + breakdown.tenure;
  const score = round1(Math.min(100, Math.max(0, rawScore)));

  const confidence: TrustScore['confidence'] =
    total >= 20 ? 'high' : total >= 5 ? 'medium' : 'low';

  return { score, breakdown, confidence, computedAt: now };
}

// ---- TrustLedger -------------------------------------------------------------

export class TrustLedger {
  private readonly history = new Map<string, AgentTrustHistory>();

  /**
   * Record a completed/failed/disputed execution outcome.
   * Automatically recomputes the provider's trust score.
   */
  record(outcome: ExecutionOutcome): TrustScore {
    const existing = this.history.get(outcome.providerAgentId);
    const outcomes = existing ? [...existing.outcomes, outcome] : [outcome];
    const cachedScore = computeHistoricalTrust(outcomes);

    this.history.set(outcome.providerAgentId, {
      agentId: outcome.providerAgentId,
      outcomes,
      cachedScore,
      lastUpdated: new Date().toISOString(),
    });

    return cachedScore;
  }

  /**
   * Get the current trust score for an agent (from execution history only).
   * Returns null if no history exists.
   */
  getScore(agentId: string): TrustScore | null {
    return this.history.get(agentId)?.cachedScore ?? null;
  }

  /**
   * Get full history for an agent.
   */
  getHistory(agentId: string): AgentTrustHistory | null {
    return this.history.get(agentId) ?? null;
  }

  /**
   * List all agents with trust history, sorted by score descending.
   */
  leaderboard(): Array<{ agentId: string; score: number; totalTx: number; confidence: string }> {
    return Array.from(this.history.values())
      .map(h => ({
        agentId: h.agentId,
        score: h.cachedScore.score,
        totalTx: h.outcomes.length,
        confidence: h.cachedScore.confidence,
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Convert a TaskExecution into an ExecutionOutcome.
   * Requires the offer's estimated duration to compute onTime.
   */
  static fromExecution(
    execution: TaskExecution,
    providerAgentId: string,
    clientAgentId: string,
    estimatedDurationMs?: number,
  ): ExecutionOutcome | null {
    if (!['completed', 'failed', 'disputed'].includes(execution.status)) return null;

    const acceptedAt = new Date(execution.acceptedAt).getTime();
    const completedAt = execution.completedAt ? new Date(execution.completedAt).getTime() : Date.now();
    const durationMs = completedAt - acceptedAt;

    const onTime = estimatedDurationMs !== undefined
      ? durationMs <= estimatedDurationMs * 1.1  // 10% grace period
      : true;  // unknown → assume on time

    return {
      executionId: execution.executionId,
      intentId: execution.intentId,
      offerId: execution.offerId,
      providerAgentId,
      clientAgentId,
      status: execution.status as 'completed' | 'failed' | 'disputed',
      durationMs,
      clientRating: execution.clientRating,
      onTime,
      recordedAt: new Date().toISOString(),
    };
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
