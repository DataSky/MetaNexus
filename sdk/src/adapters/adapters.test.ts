import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { A2AAdapter } from './a2a.js';
import { MCPAdapter } from './mcp.js';
import { AgentsMdAdapter, parseAgentsMd } from './agentsmd.js';
import type { RawAgentData } from '../core/types.js';

// ---- Fixtures ----------------------------------------------------------------

const A2A_CARD = {
  name: 'Acme Shopping Agent',
  description: 'Helps users find and purchase products',
  url: 'https://agent.acme.com',
  version: '2.0.0',
  skills: [
    {
      id: 'product_search',
      name: 'Product Search',
      description: 'Search for products by keyword',
      tags: ['search', 'ecommerce'],
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
    {
      id: 'checkout',
      name: 'Checkout',
      description: 'Complete a purchase',
      tags: ['ecommerce'],
    },
  ],
  capabilities: { streaming: false, pushNotifications: true },
};

const MCP_MANIFEST = {
  name: 'File System MCP',
  description: 'Read and write files via MCP',
  version: '1.2.0',
  tools: [
    { name: 'read_file', description: 'Read a file from disk', inputSchema: { type: 'object' } },
    { name: 'write_file', description: 'Write content to a file' },
  ],
  resources: [
    { uri: 'file:///workspace', name: 'workspace', description: 'Root workspace directory' },
  ],
};

const AGENTS_MD = `# WeatherBot

The best weather agent for real-time forecasts and alerts.

version: 1.3.0
tags: weather, forecast, alerts

## Current Weather
Returns the current temperature and conditions for a given city.

## 7-Day Forecast
Returns a 7-day forecast including precipitation probability.

## Severe Weather Alerts
Sends push alerts when severe weather is detected in your region.
`;

// ---- Mock fetch helper -------------------------------------------------------

function mockFetch(data: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  });
}

// ---- A2A Adapter tests -------------------------------------------------------

describe('A2AAdapter', () => {
  const adapter = new A2AAdapter();

  beforeEach(() => { vi.stubGlobal('fetch', mockFetch(A2A_CARD)); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has correct protocol metadata', () => {
    expect(adapter.protocol).toBe('a2a');
    expect(adapter.version).toBe('0.2');
  });

  it('detect() returns high confidence for valid A2A card', async () => {
    const result = await adapter.detect('https://agent.acme.com');
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.protocol).toBe('a2a');
  });

  it('detect() returns false when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const result = await adapter.detect('https://bad.example.com');
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('detect() returns false for non-A2A JSON', async () => {
    vi.stubGlobal('fetch', mockFetch({ hello: 'world' }));
    const result = await adapter.detect('https://example.com');
    expect(result.detected).toBe(false);
  });

  it('fetch() returns RawAgentData with correct shape', async () => {
    const raw = await adapter.fetch('https://agent.acme.com');
    expect(raw.protocol).toBe('a2a');
    expect(raw.sourceUrl).toContain('/.well-known/agent.json');
    expect(raw.fetchedAt).toBeTruthy();
    expect(raw.data).toMatchObject({ name: 'Acme Shopping Agent' });
  });

  it('normalize() maps A2A card to UniversalAgentCard', () => {
    const raw: RawAgentData = {
      protocol: 'a2a',
      data: A2A_CARD,
      sourceUrl: 'https://agent.acme.com/.well-known/agent.json',
      fetchedAt: new Date().toISOString(),
    };
    const card = adapter.normalize(raw);

    expect(card.id).toBe('a2a:agent.acme.com');
    expect(card.name).toBe('Acme Shopping Agent');
    expect(card.description).toBe('Helps users find and purchase products');
    expect(card.version).toBe('2.0.0');
    expect(card.domain).toBe('agent.acme.com');
    expect(card.endpoint).toBe('https://agent.acme.com');
    expect(card.protocols[0].protocol).toBe('a2a');
  });

  it('normalize() maps skills to capabilities', () => {
    const raw: RawAgentData = {
      protocol: 'a2a',
      data: A2A_CARD,
      sourceUrl: 'https://agent.acme.com/.well-known/agent.json',
      fetchedAt: new Date().toISOString(),
    };
    const card = adapter.normalize(raw);

    expect(card.capabilities).toHaveLength(2);
    expect(card.capabilities[0].id).toBe('product_search');
    expect(card.capabilities[0].name).toBe('Product Search');
    expect(card.capabilities[1].id).toBe('checkout');
  });

  it('normalize() deduplicates and collects tags', () => {
    const raw: RawAgentData = {
      protocol: 'a2a',
      data: A2A_CARD,
      sourceUrl: 'https://agent.acme.com/.well-known/agent.json',
      fetchedAt: new Date().toISOString(),
    };
    const card = adapter.normalize(raw);
    expect(card.tags).toContain('search');
    expect(card.tags).toContain('ecommerce');
    // 'ecommerce' appears in both skills but should not be duplicated
    expect(card.tags?.filter(t => t === 'ecommerce')).toHaveLength(1);
  });

  it('normalize() creates default capability when no skills', () => {
    const cardWithoutSkills = { ...A2A_CARD, skills: [] };
    const raw: RawAgentData = {
      protocol: 'a2a',
      data: cardWithoutSkills,
      sourceUrl: 'https://agent.acme.com/.well-known/agent.json',
      fetchedAt: new Date().toISOString(),
    };
    const card = adapter.normalize(raw);
    expect(card.capabilities).toHaveLength(1);
    expect(card.capabilities[0].id).toBe('default');
  });

  it('normalize() sets empty publicKey and signature for imported cards', () => {
    const raw: RawAgentData = {
      protocol: 'a2a',
      data: A2A_CARD,
      sourceUrl: 'https://agent.acme.com/.well-known/agent.json',
      fetchedAt: new Date().toISOString(),
    };
    const card = adapter.normalize(raw);
    expect(card.publicKey).toBe('');
    expect(card.signature).toBe('');
  });
});

// ---- MCP Adapter tests -------------------------------------------------------

describe('MCPAdapter', () => {
  const adapter = new MCPAdapter();

  beforeEach(() => { vi.stubGlobal('fetch', mockFetch(MCP_MANIFEST)); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has correct protocol metadata', () => {
    expect(adapter.protocol).toBe('mcp');
  });

  it('detect() returns high confidence for valid MCP manifest', async () => {
    const result = await adapter.detect('https://mcp.example.com');
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('detect() returns false when no MCP shape', async () => {
    vi.stubGlobal('fetch', mockFetch({ something: 'else' }));
    const result = await adapter.detect('https://example.com');
    expect(result.detected).toBe(false);
  });

  it('normalize() maps tools, resources, prompts to capabilities', () => {
    const raw: RawAgentData = {
      protocol: 'mcp',
      data: MCP_MANIFEST,
      sourceUrl: 'https://mcp.example.com/.well-known/mcp.json',
      fetchedAt: new Date().toISOString(),
    };
    const card = adapter.normalize(raw);

    expect(card.id).toBe('mcp:mcp.example.com');
    expect(card.name).toBe('File System MCP');
    // 2 tools + 1 resource = 3 capabilities
    expect(card.capabilities).toHaveLength(3);
    expect(card.capabilities[0].id).toBe('read_file');
    expect(card.capabilities[2].id).toBe('resource:workspace');
  });
});

// ---- AGENTS.md Adapter tests -------------------------------------------------

describe('parseAgentsMd', () => {
  it('extracts name from H1', () => {
    const result = parseAgentsMd(AGENTS_MD);
    expect(result.name).toBe('WeatherBot');
  });

  it('extracts description from first paragraph', () => {
    const result = parseAgentsMd(AGENTS_MD);
    expect(result.description).toContain('best weather agent');
  });

  it('extracts version', () => {
    const result = parseAgentsMd(AGENTS_MD);
    expect(result.version).toBe('1.3.0');
  });

  it('extracts tags', () => {
    const result = parseAgentsMd(AGENTS_MD);
    expect(result.tags).toContain('weather');
    expect(result.tags).toContain('forecast');
    expect(result.tags).toContain('alerts');
  });

  it('extracts H2 sections as capabilities', () => {
    const result = parseAgentsMd(AGENTS_MD);
    expect(result.capabilities).toHaveLength(3);
    expect(result.capabilities[0].name).toBe('Current Weather');
    expect(result.capabilities[1].name).toBe('7-Day Forecast');
    expect(result.capabilities[2].name).toBe('Severe Weather Alerts');
  });

  it('generates stable snake_case ids for capabilities', () => {
    const result = parseAgentsMd(AGENTS_MD);
    expect(result.capabilities[0].id).toBe('current_weather');
    expect(result.capabilities[1].id).toBe('7_day_forecast');
  });

  it('handles minimal markdown gracefully', () => {
    const result = parseAgentsMd('# MyAgent\n\nA simple agent.');
    expect(result.name).toBe('MyAgent');
    expect(result.description).toBe('A simple agent.');
    expect(result.capabilities).toHaveLength(0);
  });

  it('falls back to defaults for empty input', () => {
    const result = parseAgentsMd('');
    expect(result.name).toBe('Unknown Agent');
    expect(result.description).toBeTruthy();
  });
});

describe('AgentsMdAdapter', () => {
  const adapter = new AgentsMdAdapter();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch(AGENTS_MD));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('normalize() maps parsed AGENTS.md to UniversalAgentCard', () => {
    const raw: RawAgentData = {
      protocol: 'agentsmd',
      data: { markdown: AGENTS_MD, sourceUrl: 'https://weatherbot.io/.well-known/agents.md' },
      sourceUrl: 'https://weatherbot.io/.well-known/agents.md',
      fetchedAt: new Date().toISOString(),
    };
    const card = adapter.normalize(raw);

    expect(card.id).toBe('agentsmd:weatherbot.io');
    expect(card.name).toBe('WeatherBot');
    expect(card.capabilities).toHaveLength(3);
    expect(card.tags).toContain('weather');
  });
});
