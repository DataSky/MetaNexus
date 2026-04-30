import { describe, it, expect } from 'vitest';
import { TrustLedger, computeHistoricalTrust } from './trust-ledger.js';
import type { ExecutionOutcome } from './trust-ledger.js';

function makeOutcome(overrides: Partial<ExecutionOutcome> = {}): ExecutionOutcome {
  return {
    executionId: 'exec-1',
    intentId: 'intent-1',
    offerId: 'offer-1',
    providerAgentId: 'https://provider.test',
    clientAgentId: 'https://client.test',
    status: 'completed',
    durationMs: 5000,
    onTime: true,
    recordedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeHistoricalTrust', () => {
  it('returns zero score for empty history', () => {
    const score = computeHistoricalTrust([]);
    expect(score.score).toBe(0);
    expect(score.confidence).toBe('low');
  });

  it('gives high reliability for all-completed history', () => {
    const outcomes = Array.from({ length: 10 }, (_, i) =>
      makeOutcome({ executionId: `exec-${i}`, status: 'completed', clientRating: 5 }),
    );
    const score = computeHistoricalTrust(outcomes);
    expect(score.score).toBeGreaterThan(70);
    expect(score.breakdown.reliability).toBe(40);
  });

  it('penalizes failures', () => {
    const good = Array.from({ length: 7 }, (_, i) =>
      makeOutcome({ executionId: `exec-${i}`, status: 'completed' }),
    );
    const bad = Array.from({ length: 3 }, (_, i) =>
      makeOutcome({ executionId: `fail-${i}`, status: 'failed' }),
    );
    const score = computeHistoricalTrust([...good, ...bad]);
    expect(score.breakdown.reliability).toBeLessThan(40);
  });

  it('penalizes disputes more than failures', () => {
    const withFail = computeHistoricalTrust([
      makeOutcome({ status: 'completed' }),
      makeOutcome({ executionId: 'f1', status: 'failed' }),
    ]);
    const withDispute = computeHistoricalTrust([
      makeOutcome({ status: 'completed' }),
      makeOutcome({ executionId: 'd1', status: 'disputed' }),
    ]);
    expect(withDispute.breakdown.reliability).toBeLessThan(withFail.breakdown.reliability);
  });

  it('reflects client ratings in quality score', () => {
    const highRated = computeHistoricalTrust([
      makeOutcome({ clientRating: 5 }),
      makeOutcome({ executionId: 'e2', clientRating: 5 }),
    ]);
    const lowRated = computeHistoricalTrust([
      makeOutcome({ clientRating: 1 }),
      makeOutcome({ executionId: 'e2', clientRating: 1 }),
    ]);
    expect(highRated.breakdown.quality).toBeGreaterThan(lowRated.breakdown.quality);
    expect(highRated.breakdown.quality).toBe(25);
    expect(lowRated.breakdown.quality).toBe(0);
  });

  it('confidence scales with volume', () => {
    const few = computeHistoricalTrust([makeOutcome()]);
    const some = computeHistoricalTrust(
      Array.from({ length: 5 }, (_, i) => makeOutcome({ executionId: `e${i}` })),
    );
    const many = computeHistoricalTrust(
      Array.from({ length: 20 }, (_, i) => makeOutcome({ executionId: `e${i}` })),
    );
    expect(few.confidence).toBe('low');
    expect(some.confidence).toBe('medium');
    expect(many.confidence).toBe('high');
  });
});

describe('TrustLedger', () => {
  it('returns null for unknown agent', () => {
    const ledger = new TrustLedger();
    expect(ledger.getScore('https://unknown.test')).toBeNull();
  });

  it('records outcomes and updates score', () => {
    const ledger = new TrustLedger();
    const score1 = ledger.record(makeOutcome({ clientRating: 5 }));
    expect(score1.score).toBeGreaterThan(0);

    const score2 = ledger.record(makeOutcome({ executionId: 'exec-2', clientRating: 5 }));
    expect(score2.score).toBeGreaterThanOrEqual(score1.score);
  });

  it('leaderboard sorts by score descending', () => {
    const ledger = new TrustLedger();
    ledger.record(makeOutcome({ providerAgentId: 'agent-a', clientRating: 5 }));
    ledger.record(makeOutcome({ providerAgentId: 'agent-b', clientRating: 1 }));

    const board = ledger.leaderboard();
    expect(board[0].agentId).toBe('agent-a');
    expect(board[1].agentId).toBe('agent-b');
  });

  it('fromExecution returns null for non-terminal status', () => {
    const result = TrustLedger.fromExecution(
      {
        executionId: 'e1', offerId: 'o1', intentId: 'i1',
        status: 'in_progress', acceptedAt: new Date().toISOString(),
      },
      'provider', 'client',
    );
    expect(result).toBeNull();
  });

  it('fromExecution computes onTime correctly', () => {
    const acceptedAt = new Date(Date.now() - 5000).toISOString();
    const completedAt = new Date().toISOString();
    const outcome = TrustLedger.fromExecution(
      {
        executionId: 'e1', offerId: 'o1', intentId: 'i1',
        status: 'completed', acceptedAt, completedAt,
      },
      'provider', 'client',
      10_000, // 10s estimated → 5s actual → on time
    );
    expect(outcome?.onTime).toBe(true);
    expect(outcome?.durationMs).toBeGreaterThan(4000);
  });
});
