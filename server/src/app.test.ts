import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from './app.js';
import { AgentRegistry } from '../../sdk/src/discovery/registry.js';
import { DelegationStore } from '../../sdk/src/delegation/store.js';
import { generateKeyPair, sign } from '../../sdk/src/core/crypto.js';
import { generateNonce } from '../../sdk/src/core/crypto.js';
import type { UniversalAgentCard, TaskIntent, TaskOffer } from '../../sdk/src/core/types.js';

// Disable real DMXAPI calls in all server tests — use keyword search only.
vi.mock('../../sdk/src/discovery/embeddings.js', () => ({
  getEmbedding: vi.fn().mockResolvedValue(null),
  cardToText: (card: UniversalAgentCard) => `${card.name} ${card.description}`,
  cosine: () => 0,
}));

// ---- Fixture -----------------------------------------------------------------

/**
 * Creates a valid UniversalAgentCard for testing.
 * slug becomes the subdomain: makeCard('agent1') → id='https://agent1.metanexus.test'
 */
function makeCard(slug: string, overrides: Partial<UniversalAgentCard> = {}): UniversalAgentCard {
  const base = `https://${slug}.test`;
  return {
    id: base,
    name: 'Test Agent',
    description: 'A test agent for API tests',
    version: '1.0.0',
    capabilities: [{ id: 'search', name: 'Search', description: 'Does stuff' }],
    protocols: [{ protocol: 'a2a', version: '0.2', endpoint: base }],
    endpoint: base,
    publicKey: '',
    domain: `${slug}.test`,
    tags: ['test'],
    created: '2026-03-08T00:00:00.000Z',
    updated: '2026-03-08T00:00:00.000Z',
    signature: '',
    ...overrides,
  };
}

// Helper: send JSON request to app and return parsed response
async function req(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown,
) {
  const init: RequestInit = {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await app.request(path, init);
  const json = await res.json();
  return { status: res.status, body: json };
}

// ---- Tests -------------------------------------------------------------------

describe('GET /v1/health', () => {
  it('returns ok with agent count', async () => {
    const registry = new AgentRegistry();
    const app = createApp(registry);
    const { status, body } = await req(app, 'GET', '/v1/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.agents).toBe(0);
  });
});

describe('POST /v1/agents', () => {
  it('registers a valid agent', async () => {
    const app = createApp();
    const card = makeCard('example');
    const { status, body } = await req(app, 'POST', '/v1/agents', card);
    expect(status).toBe(201);
    expect(body.agentId).toBe('https://example.test');
    expect(body.status).toBe('registered');
  });

  it('returns 400 for invalid card', async () => {
    const app = createApp();
    const { status, body } = await req(app, 'POST', '/v1/agents', { name: 'missing fields' });
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});

describe('GET /v1/agents/:id', () => {
  it('returns registered card', async () => {
    const registry = new AgentRegistry();
    const card = makeCard('example');
    registry.register(card);
    const app = createApp(registry);

    const { status, body } = await req(app, 'GET', '/v1/agents/https%3A%2F%2Fexample.test');
    expect(status).toBe(200);
    expect(body.id).toBe('https://example.test');
    expect(body.name).toBe('Test Agent');
  });

  it('returns 404 for unknown agent', async () => {
    const app = createApp();
    const { status } = await req(app, 'GET', '/v1/agents/https%3A%2F%2Fnobody.test');
    expect(status).toBe(404);
  });
});

describe('GET /v1/agents', () => {
  it('lists all agents', async () => {
    const registry = new AgentRegistry();
    registry.register(makeCard('agent1'));
    registry.register(makeCard('agent2'));
    const app = createApp(registry);

    const { status, body } = await req(app, 'GET', '/v1/agents');
    expect(status).toBe(200);
    expect(body.agents).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('paginates with limit and offset', async () => {
    const registry = new AgentRegistry();
    for (let i = 0; i < 5; i++) registry.register(makeCard(`agent${i}`));
    const app = createApp(registry);

    const { body } = await req(app, 'GET', '/v1/agents?limit=2&offset=0');
    expect(body.agents).toHaveLength(2);
    expect(body.total).toBe(5);
  });
});

describe('DELETE /v1/agents/:id', () => {
  it('deletes an existing agent', async () => {
    const registry = new AgentRegistry();
    registry.register(makeCard('example'));
    const app = createApp(registry);

    const { status, body } = await req(app, 'DELETE', '/v1/agents/https%3A%2F%2Fexample.test');
    expect(status).toBe(200);
    expect(body.status).toBe('deleted');
  });

  it('returns 404 for unknown agent', async () => {
    const app = createApp();
    const { status } = await req(app, 'DELETE', '/v1/agents/https%3A%2F%2Fnobody.test');
    expect(status).toBe(404);
  });
});

describe('POST /v1/search', () => {
  it('returns matching agents', async () => {
    const registry = new AgentRegistry();
    registry.register(makeCard('weather', { name: 'Weather Agent', description: 'Provides weather data' }));
    registry.register(makeCard('finance', { name: 'Finance Agent', description: 'Stocks and trading' }));
    const app = createApp(registry);

    const { status, body } = await req(app, 'POST', '/v1/search', { query: 'weather' });
    expect(status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].agent.id).toBe('https://weather.test');
  });

  it('returns 400 when query is missing', async () => {
    const app = createApp();
    const { status } = await req(app, 'POST', '/v1/search', {});
    expect(status).toBe(400);
  });
});

describe('POST /v1/crawl', () => {
  it('returns 400 for empty urls', async () => {
    const app = createApp();
    const { status } = await req(app, 'POST', '/v1/crawl', { urls: [] });
    expect(status).toBe(400);
  });

  it('returns 400 for too many urls', async () => {
    const app = createApp();
    const urls = Array.from({ length: 51 }, (_, i) => `https://agent${i}.com`);
    const { status } = await req(app, 'POST', '/v1/crawl', { urls });
    expect(status).toBe(400);
  });

  it('crawls urls and reports results', async () => {
    // Mock fetch so crawl doesn't hit real network
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in tests')));

    const app = createApp();
    const { status, body } = await req(app, 'POST', '/v1/crawl', {
      urls: ['https://agent1.com', 'https://agent2.com'],
    });

    expect(status).toBe(200);
    expect(body.crawled).toBe(2);
    expect(body.registered).toBe(0); // all fail — no network
    expect(body.results).toHaveLength(2);
    expect(body.results[0].status).toBe('no_protocol');

    vi.unstubAllGlobals();
  });
});

// ============================================================================
// Delegation API tests
// ============================================================================

// Shared key pairs for delegation tests
const CLIENT_KP = generateKeyPair();
const PROVIDER_KP = generateKeyPair();

function makeValidIntent(overrides: Partial<TaskIntent> = {}): TaskIntent {
  const now = new Date().toISOString();
  const intent: Omit<TaskIntent, 'signature'> = {
    intentId: crypto.randomUUID(),
    clientAgentId: 'https://client.test',
    type: 'task',
    task: { description: 'Translate this document' },
    budget: { maxAmount: 0.5, currency: 'usdc' },
    ttl: 300,
    nonce: generateNonce(),
    timestamp: now,
    signature: '',
    ...overrides,
  };
  const signature = sign(intent as Record<string, unknown>, CLIENT_KP.secretKey);
  return { ...intent, signature };
}

function makeValidOffer(intent: TaskIntent, overrides: Partial<TaskOffer> = {}): TaskOffer {
  const now = new Date().toISOString();
  const offer: Omit<TaskOffer, 'signature'> = {
    offerId: crypto.randomUUID(),
    intentId: intent.intentId,
    providerAgentId: 'https://provider.test',
    proposal: { description: 'Will translate using Claude Sonnet', estimatedDuration: 3600 },
    pricing: { amount: 0.3, asset: 'usdc' },
    validUntil: new Date(Date.now() + 120_000).toISOString(),
    nonce: generateNonce(),
    timestamp: now,
    signature: '',
    ...overrides,
  };
  const signature = sign(offer as Record<string, unknown>, PROVIDER_KP.secretKey);
  return { ...offer, signature };
}

describe('POST /v1/intents', () => {
  it('creates a valid intent and returns 201', async () => {
    const app = createApp();
    const intent = makeValidIntent();
    const { status, body } = await req(app, 'POST', '/v1/intents', intent);
    expect(status).toBe(201);
    expect(body.intentId).toBe(intent.intentId);
    expect(body.status).toBe('open');
  });

  it('returns 400 for invalid intent', async () => {
    const app = createApp();
    const { status, body } = await req(app, 'POST', '/v1/intents', { task: 'missing fields' });
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});

describe('GET /v1/intents/:id', () => {
  it('returns intent with offers', async () => {
    const delegation = new DelegationStore();
    const app = createApp(new AgentRegistry(), delegation);
    const intent = makeValidIntent();
    delegation.intents.submit(intent);

    const { status, body } = await req(app, 'GET', `/v1/intents/${intent.intentId}`);
    expect(status).toBe(200);
    expect(body.intent.intentId).toBe(intent.intentId);
    expect(body.offers).toHaveLength(0);
  });

  it('returns 404 for unknown intent', async () => {
    const app = createApp();
    const { status } = await req(app, 'GET', '/v1/intents/nonexistent');
    expect(status).toBe(404);
  });
});

describe('DELETE /v1/intents/:id', () => {
  it('cancels an open intent', async () => {
    const delegation = new DelegationStore();
    const app = createApp(new AgentRegistry(), delegation);
    const intent = makeValidIntent();
    delegation.intents.submit(intent);

    const { status, body } = await req(app, 'DELETE', `/v1/intents/${intent.intentId}`);
    expect(status).toBe(200);
    expect(body.status).toBe('cancelled');
  });
});

describe('POST /v1/intents/:id/offers', () => {
  it('provider submits offer for open intent', async () => {
    const delegation = new DelegationStore();
    const app = createApp(new AgentRegistry(), delegation);
    const intent = makeValidIntent();
    delegation.intents.submit(intent);

    const offer = makeValidOffer(intent);
    const { status, body } = await req(app, 'POST', `/v1/intents/${intent.intentId}/offers`, offer);
    expect(status).toBe(201);
    expect(body.offerId).toBe(offer.offerId);
    expect(body.status).toBe('submitted');
  });

  it('returns 404 when intent not found', async () => {
    const app = createApp();
    const offer = makeValidOffer(makeValidIntent());
    const { status } = await req(app, 'POST', '/v1/intents/nonexistent/offers', offer);
    expect(status).toBe(404);
  });

  it('returns 400 when offer intentId does not match', async () => {
    const delegation = new DelegationStore();
    const app = createApp(new AgentRegistry(), delegation);
    const intent = makeValidIntent();
    delegation.intents.submit(intent);

    const wrongOffer = makeValidOffer(makeValidIntent()); // different intent
    wrongOffer.intentId = 'wrong-id';
    const { status } = await req(app, 'POST', `/v1/intents/${intent.intentId}/offers`, wrongOffer);
    expect(status).toBe(400);
  });
});

describe('POST /v1/offers/:id/accept + execution lifecycle', () => {
  it('full delegation flow: submit → offer → accept → progress → complete', async () => {
    const delegation = new DelegationStore();
    const app = createApp(new AgentRegistry(), delegation);

    // 1. Submit intent
    const intent = makeValidIntent();
    await req(app, 'POST', '/v1/intents', intent);

    // 2. Submit offer
    const offer = makeValidOffer(intent);
    await req(app, 'POST', `/v1/intents/${intent.intentId}/offers`, offer);

    // 3. Accept offer
    const { status: s3, body: exec } = await req(app, 'POST', `/v1/offers/${offer.offerId}/accept`);
    expect(s3).toBe(201);
    expect(exec.status).toBe('accepted');

    const execId = exec.executionId;

    // 4. Provider starts work
    const { body: started } = await req(app, 'PATCH', `/v1/executions/${execId}`, { status: 'in_progress' });
    expect(started.status).toBe('in_progress');
    expect(started.startedAt).toBeTruthy();

    // 5. Provider completes
    const { body: done } = await req(app, 'PATCH', `/v1/executions/${execId}`, {
      status: 'completed',
      result: { translatedText: '你好世界' },
    });
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeTruthy();
  });

  it('returns 409 when accepting already-matched intent via another offer', async () => {
    const delegation = new DelegationStore();
    const app = createApp(new AgentRegistry(), delegation);

    const intent = makeValidIntent();
    await req(app, 'POST', '/v1/intents', intent);

    const offer1 = makeValidOffer(intent);
    const offer2 = makeValidOffer(intent);
    await req(app, 'POST', `/v1/intents/${intent.intentId}/offers`, offer1);
    await req(app, 'POST', `/v1/intents/${intent.intentId}/offers`, offer2);

    await req(app, 'POST', `/v1/offers/${offer1.offerId}/accept`);
    const { status } = await req(app, 'POST', `/v1/offers/${offer2.offerId}/accept`);
    expect(status).toBe(409);
  });

  it('returns 409 for invalid execution status transition', async () => {
    const delegation = new DelegationStore();
    const app = createApp(new AgentRegistry(), delegation);

    const intent = makeValidIntent();
    await req(app, 'POST', '/v1/intents', intent);
    const offer = makeValidOffer(intent);
    await req(app, 'POST', `/v1/intents/${intent.intentId}/offers`, offer);
    const { body: exec } = await req(app, 'POST', `/v1/offers/${offer.offerId}/accept`);

    // Skip in_progress, go directly to completed — invalid
    const { status } = await req(app, 'PATCH', `/v1/executions/${exec.executionId}`, { status: 'completed' });
    expect(status).toBe(409);
  });
});

describe('GET /v1/executions/:id', () => {
  it('returns 404 for unknown execution', async () => {
    const app = createApp();
    const { status } = await req(app, 'GET', '/v1/executions/nonexistent');
    expect(status).toBe(404);
  });
});
