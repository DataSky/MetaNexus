/**
 * MetaNexus Registry API
 * Hono app — routes only, no side effects, importable in tests.
 */

import { Hono } from 'hono';
import { AgentRegistry } from '../../sdk/src/discovery/registry.js';
import { Crawler } from '../../sdk/src/discovery/crawler.js';
import { RegisterAgentCardSchema } from '../../sdk/src/core/validation.js';
import type { SearchQuery } from '../../sdk/src/core/types.js';

export function createApp(registry = new AgentRegistry()) {
  const app = new Hono();
  const crawler = new Crawler();

  // ---- Health ----------------------------------------------------------------
  app.get('/v1/health', c => c.json({ status: 'ok', agents: registry.size }));

  // ---- Agents ----------------------------------------------------------------

  /** Register or update an agent */
  app.post('/v1/agents', async c => {
    const body = await c.req.json();
    const result = RegisterAgentCardSchema.safeParse(body);
    if (!result.success) {
      return c.json({ error: 'Invalid AgentCard', details: result.error.flatten() }, 400);
    }
    registry.register(result.data);
    return c.json({ agentId: result.data.id, status: 'registered' }, 201);
  });

  /** Get a single agent by ID */
  app.get('/v1/agents/:id', c => {
    const id = decodeURIComponent(c.req.param('id'));
    const card = registry.get(id);
    if (!card) return c.json({ error: 'Agent not found' }, 404);
    return c.json(card);
  });

  /** List all agents (paginated) */
  app.get('/v1/agents', c => {
    const limit = Math.min(Number(c.req.query('limit') ?? 20), 100);
    const offset = Number(c.req.query('offset') ?? 0);
    const all = registry.list();
    return c.json({
      agents: all.slice(offset, offset + limit),
      total: all.length,
      limit,
      offset,
    });
  });

  /** Delete an agent */
  app.delete('/v1/agents/:id', c => {
    const id = decodeURIComponent(c.req.param('id'));
    const deleted = registry.delete(id);
    if (!deleted) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ status: 'deleted' });
  });

  // ---- Search ----------------------------------------------------------------

  /** Semantic search (Phase 1: keyword; Phase 2: pgvector) */
  app.post('/v1/search', async c => {
    const body = (await c.req.json()) as SearchQuery;
    if (!body.query || typeof body.query !== 'string') {
      return c.json({ error: 'query is required' }, 400);
    }
    const results = registry.search(body);
    return c.json({ results, total: results.length });
  });

  // ---- Crawler ---------------------------------------------------------------

  /** Crawl a URL or list of URLs and register discovered agents */
  app.post('/v1/crawl', async c => {
    const body = (await c.req.json()) as { urls: string[] };
    if (!Array.isArray(body.urls) || body.urls.length === 0) {
      return c.json({ error: 'urls array is required' }, 400);
    }
    if (body.urls.length > 50) {
      return c.json({ error: 'max 50 URLs per crawl request' }, 400);
    }

    const crawlResults = await crawler.crawl(body.urls);
    let registered = 0;
    for (const r of crawlResults) {
      if (r.status === 'success' && r.card) {
        registry.register(r.card);
        registered++;
      }
    }

    return c.json({
      crawled: crawlResults.length,
      registered,
      results: crawlResults.map(r => ({
        url: r.url,
        status: r.status,
        protocol: r.protocol,
        agentId: r.card?.id,
        error: r.error,
        durationMs: r.durationMs,
      })),
    });
  });

  return app;
}
