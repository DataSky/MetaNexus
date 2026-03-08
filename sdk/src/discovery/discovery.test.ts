import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Crawler } from './crawler.js';
import { AgentRegistry } from './registry.js';
import type { ProtocolAdapter, RawAgentData, UniversalAgentCard } from '../core/types.js';

// ---- Fixtures ----------------------------------------------------------------

const MOCK_CARD: UniversalAgentCard = {
  id: 'a2a:agent.example.com',
  name: 'Example Agent',
  description: 'A test agent for crawling',
  version: '1.0.0',
  capabilities: [{ id: 'search', name: 'Search', description: 'Search the web' }],
  protocols: [{ protocol: 'a2a', version: '0.2', endpoint: 'https://agent.example.com' }],
  endpoint: 'https://agent.example.com',
  publicKey: '',
  domain: 'agent.example.com',
  tags: ['search', 'web'],
  created: '2026-03-08T00:00:00.000Z',
  updated: '2026-03-08T00:00:00.000Z',
  signature: '',
};

function makeMockAdapter(protocol: string, detects: boolean, card: UniversalAgentCard = MOCK_CARD): ProtocolAdapter {
  return {
    protocol,
    version: '1.0',
    detect: vi.fn().mockResolvedValue({ detected: detects, confidence: detects ? 0.9 : 0, protocol }),
    fetch: vi.fn().mockResolvedValue({ protocol, data: {}, sourceUrl: 'https://agent.example.com/.well-known/agent.json', fetchedAt: new Date().toISOString() } satisfies RawAgentData),
    normalize: vi.fn().mockReturnValue(card),
  };
}

// ---- Crawler tests -----------------------------------------------------------

describe('Crawler', () => {
  it('crawlOne() returns success with card when adapter detects and normalizes', async () => {
    const adapter = makeMockAdapter('a2a', true);
    const crawler = new Crawler({ adapters: [adapter] });

    const result = await crawler.crawlOne('https://agent.example.com');

    expect(result.status).toBe('success');
    expect(result.protocol).toBe('a2a');
    expect(result.card).toBeDefined();
    expect(result.card?.name).toBe('Example Agent');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('crawlOne() returns no_protocol when no adapter detects', async () => {
    const adapter = makeMockAdapter('a2a', false);
    const crawler = new Crawler({ adapters: [adapter] });

    const result = await crawler.crawlOne('https://unknown.example.com');

    expect(result.status).toBe('no_protocol');
    expect(result.card).toBeUndefined();
  });

  it('crawlOne() returns fetch_error when fetch throws', async () => {
    const adapter = makeMockAdapter('a2a', true);
    (adapter.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('timeout'));
    const crawler = new Crawler({ adapters: [adapter] });

    const result = await crawler.crawlOne('https://agent.example.com');

    expect(result.status).toBe('fetch_error');
    expect(result.error).toContain('timeout');
  });

  it('crawlOne() returns normalize_error when normalize throws', async () => {
    const adapter = makeMockAdapter('a2a', true);
    (adapter.normalize as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('bad data');
    });
    const crawler = new Crawler({ adapters: [adapter] });

    const result = await crawler.crawlOne('https://agent.example.com');

    expect(result.status).toBe('normalize_error');
    expect(result.error).toContain('bad data');
  });

  it('crawl() processes multiple URLs', async () => {
    const adapter = makeMockAdapter('a2a', true);
    const crawler = new Crawler({ adapters: [adapter], concurrency: 2 });

    const urls = ['https://agent1.com', 'https://agent2.com', 'https://agent3.com'];
    const results = await crawler.crawl(urls);

    expect(results).toHaveLength(3);
    expect(results.every(r => r.status === 'success')).toBe(true);
  });

  it('crawlCards() returns only successful cards', async () => {
    const successAdapter = makeMockAdapter('a2a', true);
    const failAdapter = makeMockAdapter('mcp', false);
    const crawler = new Crawler({ adapters: [successAdapter, failAdapter] });

    const cards = await crawler.crawlCards(['https://ok.com', 'https://fail.com']);
    // 'https://fail.com' would also be handled by successAdapter (which detects=true for all)
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every(c => c.name === 'Example Agent')).toBe(true);
  });

  it('uses first/highest-confidence adapter when multiple detect', async () => {
    const lowConf: ProtocolAdapter = {
      protocol: 'agentsmd',
      version: '1.0',
      detect: vi.fn().mockResolvedValue({ detected: true, confidence: 0.6, protocol: 'agentsmd' }),
      fetch: vi.fn().mockResolvedValue({ protocol: 'agentsmd', data: {}, sourceUrl: '', fetchedAt: '' } as RawAgentData),
      normalize: vi.fn().mockReturnValue({ ...MOCK_CARD, id: 'agentsmd:x' }),
    };
    const highConf: ProtocolAdapter = {
      protocol: 'a2a',
      version: '0.2',
      detect: vi.fn().mockResolvedValue({ detected: true, confidence: 0.9, protocol: 'a2a' }),
      fetch: vi.fn().mockResolvedValue({ protocol: 'a2a', data: {}, sourceUrl: '', fetchedAt: '' } as RawAgentData),
      normalize: vi.fn().mockReturnValue({ ...MOCK_CARD, id: 'a2a:x' }),
    };

    const crawler = new Crawler({ adapters: [lowConf, highConf] });
    const result = await crawler.crawlOne('https://x.com');

    expect(result.protocol).toBe('a2a');
    expect(result.card?.id).toBe('a2a:x');
  });
});

// ---- AgentRegistry tests -----------------------------------------------------

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => { registry = new AgentRegistry(); });

  it('register and get a card', () => {
    registry.register(MOCK_CARD);
    expect(registry.get(MOCK_CARD.id)).toEqual(MOCK_CARD);
  });

  it('list() returns all registered cards', () => {
    const card2 = { ...MOCK_CARD, id: 'a2a:other.com', name: 'Other Agent' };
    registry.register(MOCK_CARD);
    registry.register(card2);
    expect(registry.list()).toHaveLength(2);
    expect(registry.size).toBe(2);
  });

  it('delete() removes a card', () => {
    registry.register(MOCK_CARD);
    expect(registry.delete(MOCK_CARD.id)).toBe(true);
    expect(registry.get(MOCK_CARD.id)).toBeUndefined();
  });

  it('search() finds by keyword in name', () => {
    registry.register(MOCK_CARD);
    const results = registry.search({ query: 'Example' });
    expect(results).toHaveLength(1);
    expect(results[0].agent.id).toBe(MOCK_CARD.id);
  });

  it('search() finds by keyword in description', () => {
    registry.register(MOCK_CARD);
    const results = registry.search({ query: 'crawling' });
    expect(results).toHaveLength(1);
  });

  it('search() finds by keyword in capability name', () => {
    registry.register(MOCK_CARD);
    const results = registry.search({ query: 'search' });
    expect(results).toHaveLength(1);
  });

  it('search() returns empty for no match', () => {
    registry.register(MOCK_CARD);
    const results = registry.search({ query: 'nonexistent_xyz' });
    expect(results).toHaveLength(0);
  });

  it('search() filters by tag', () => {
    const taggedCard = { ...MOCK_CARD, id: 'a2a:tagged.com', tags: ['finance'] };
    registry.register(MOCK_CARD);
    registry.register(taggedCard);

    const results = registry.search({ query: 'agent', filters: { tags: ['finance'] } });
    expect(results).toHaveLength(1);
    expect(results[0].agent.id).toBe('a2a:tagged.com');
  });

  it('search() sorts by overallScore descending', () => {
    const perfectMatch = {
      ...MOCK_CARD,
      id: 'a2a:perfect.com',
      name: 'search search search',
      description: 'search search',
    };
    const weakMatch = { ...MOCK_CARD, id: 'a2a:weak.com', name: 'Agent', description: 'does search' };
    registry.register(perfectMatch);
    registry.register(weakMatch);

    const results = registry.search({ query: 'search' });
    expect(results[0].agent.id).toBe('a2a:perfect.com');
  });

  it('search() respects limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      registry.register({ ...MOCK_CARD, id: `a2a:agent${i}.com` });
    }
    const page1 = registry.search({ query: 'Example', filters: { limit: 2, offset: 0 } });
    const page2 = registry.search({ query: 'Example', filters: { limit: 2, offset: 2 } });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0].agent.id).not.toBe(page2[0].agent.id);
  });
});
