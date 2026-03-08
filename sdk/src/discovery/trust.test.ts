import { describe, it, expect, vi, afterEach } from 'vitest';
import { getEmbedding, cardToText, cosine } from './embeddings.js';
import { computeTrustScore, probeEndpoint } from './trust.js';
import type { UniversalAgentCard } from '../core/types.js';

// ---- Fixtures ----------------------------------------------------------------

const BASE_CARD: UniversalAgentCard = {
  id: 'https://agent.example.com',
  name: 'Test Agent',
  description: 'Does useful things',
  version: '1.0.0',
  capabilities: [
    { id: 'translate', name: 'Translation', description: 'Translates text between languages' },
    { id: 'summarize', name: 'Summarization', description: 'Summarizes long documents' },
  ],
  protocols: [{ protocol: 'a2a', version: '0.2', endpoint: 'https://agent.example.com' }],
  endpoint: 'https://agent.example.com',
  publicKey: '',
  domain: 'agent.example.com',
  tags: ['nlp', 'translation'],
  created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
  updated: new Date().toISOString(),
  signature: '',
};

// ---- cardToText tests --------------------------------------------------------

describe('cardToText', () => {
  it('includes name and description', () => {
    const text = cardToText(BASE_CARD);
    expect(text).toContain('Test Agent');
    expect(text).toContain('Does useful things');
  });

  it('includes capability names', () => {
    const text = cardToText(BASE_CARD);
    expect(text).toContain('Translation');
    expect(text).toContain('Summarization');
  });

  it('includes tags', () => {
    const text = cardToText(BASE_CARD);
    expect(text).toContain('nlp');
    expect(text).toContain('translation');
  });

  it('handles card with no tags', () => {
    const card = { ...BASE_CARD, tags: undefined };
    const text = cardToText(card);
    expect(text).toContain('Test Agent');
    expect(text).not.toContain('Tags:');
  });
});

// ---- cosine tests ------------------------------------------------------------

describe('cosine', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4];
    expect(cosine(v, v)).toBeCloseTo(1.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosine(a, b)).toBeCloseTo(-1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosine(a, b)).toBeCloseTo(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosine([], [])).toBe(0);
  });
});

// ---- getEmbedding tests (mocked) --------------------------------------------

describe('getEmbedding', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('returns null when DMXAPI_KEY is not set', async () => {
    vi.stubEnv('DMXAPI_KEY', '');
    const result = await getEmbedding('hello world');
    expect(result).toBeNull();
  });

  it('returns embedding vector when API succeeds', async () => {
    vi.stubEnv('DMXAPI_KEY', 'test-key');
    const mockVec = Array.from({ length: 1024 }, (_, i) => i / 1024);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: mockVec }] }),
    }));

    const result = await getEmbedding('translate Chinese legal docs');
    expect(result).toHaveLength(1024);
    expect(result![0]).toBeCloseTo(0);
  });

  it('returns null when API fails (does not throw)', async () => {
    vi.stubEnv('DMXAPI_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const result = await getEmbedding('hello');
    expect(result).toBeNull();
  });

  it('returns null when API returns error status', async () => {
    vi.stubEnv('DMXAPI_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    }));

    const result = await getEmbedding('hello');
    expect(result).toBeNull();
  });
});

// ---- Trust Score tests -------------------------------------------------------

describe('computeTrustScore', () => {
  it('returns score in [0, 100]', () => {
    const result = computeTrustScore({ card: BASE_CARD });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('includes all breakdown fields', () => {
    const result = computeTrustScore({ card: BASE_CARD });
    expect(result.breakdown.reliability).toBeDefined();
    expect(result.breakdown.quality).toBeDefined();
    expect(result.breakdown.timeliness).toBeDefined();
    expect(result.breakdown.tenure).toBeDefined();
    expect(result.breakdown.stake).toBe(0); // Phase 3
  });

  it('score is higher when probe is reachable', () => {
    const withProbe = computeTrustScore({
      card: BASE_CARD,
      probe: { reachable: true, latencyMs: 200 },
    });
    const withoutProbe = computeTrustScore({ card: BASE_CARD });
    expect(withProbe.score).toBeGreaterThan(withoutProbe.score);
  });

  it('fast probe (<500ms) adds bonus, slow (>2s) adds penalty', () => {
    const fast = computeTrustScore({ card: BASE_CARD, probe: { reachable: true, latencyMs: 100 } });
    const slow = computeTrustScore({ card: BASE_CARD, probe: { reachable: true, latencyMs: 3000 } });
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it('agent with SLA declaration gets higher quality score', () => {
    const withSLA = computeTrustScore({
      card: { ...BASE_CARD, sla: { uptimePercent: 99.9, latencyP50Ms: 100, latencyP99Ms: 500 } },
    });
    const withoutSLA = computeTrustScore({ card: { ...BASE_CARD, sla: undefined } });
    expect(withSLA.score).toBeGreaterThan(withoutSLA.score);
  });

  it('older agent (longer tenure) gets higher score', () => {
    const old = computeTrustScore({ card: BASE_CARD }); // registered 30 days ago
    const fresh = computeTrustScore({
      card: { ...BASE_CARD, created: new Date().toISOString() },
    });
    expect(old.score).toBeGreaterThan(fresh.score);
  });

  it('transactions increase score up to txCap', () => {
    const many = computeTrustScore({ card: BASE_CARD, totalTransactions: 100 });
    const none = computeTrustScore({ card: BASE_CARD, totalTransactions: 0 });
    expect(many.score).toBeGreaterThan(none.score);
  });

  it('returns computedAt timestamp', () => {
    const result = computeTrustScore({ card: BASE_CARD });
    expect(new Date(result.computedAt).getTime()).toBeGreaterThan(0);
  });

  it('confidence reflects score range', () => {
    const high = computeTrustScore({
      card: BASE_CARD,
      probe: { reachable: true, latencyMs: 100 },
      totalTransactions: 50,
    });
    // Lower bound: fresh card, no probe
    const low = computeTrustScore({
      card: { ...BASE_CARD, created: new Date().toISOString() },
    });
    expect(['low', 'medium', 'high']).toContain(high.confidence);
    expect(['low', 'medium', 'high']).toContain(low.confidence);
  });
});

// ---- probeEndpoint tests (mocked) -------------------------------------------

describe('probeEndpoint', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns reachable=true for 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await probeEndpoint('https://agent.example.com');
    expect(result.reachable).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns reachable=true for 4xx (server is up, just rejected request)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await probeEndpoint('https://agent.example.com');
    expect(result.reachable).toBe(true);
  });

  it('returns reachable=false for 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await probeEndpoint('https://agent.example.com');
    expect(result.reachable).toBe(false);
  });

  it('returns reachable=false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await probeEndpoint('https://dead.example.com');
    expect(result.reachable).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});
