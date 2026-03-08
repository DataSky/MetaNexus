import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from './app.js';
import { AgentRegistry } from '../../sdk/src/discovery/registry.js';
import type { UniversalAgentCard } from '../../sdk/src/core/types.js';

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
