/**
 * MetaNexus Registry API
 * Hono app — routes only, no side effects, importable in tests.
 */

import { Hono } from 'hono';
import { AgentRegistry } from '../../sdk/src/discovery/registry.js';
import { Crawler } from '../../sdk/src/discovery/crawler.js';
import { getEmbedding } from '../../sdk/src/discovery/embeddings.js';
import { probeAndScore } from '../../sdk/src/discovery/trust.js';
import { DelegationStore } from '../../sdk/src/delegation/store.js';
import { RegisterAgentCardSchema } from '../../sdk/src/core/validation.js';
import { TaskIntentSchema, TaskOfferSchema } from '../../sdk/src/core/validation.js';
import type { SearchQuery, ExecutionStatus } from '../../sdk/src/core/types.js';

export function createApp(registry = new AgentRegistry(), delegation = new DelegationStore()) {
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

  // ---- Trust -----------------------------------------------------------------

  /** Probe an agent's endpoint and return its computed trust score */
  app.get('/v1/agents/:id/trust', async c => {
    const id = decodeURIComponent(c.req.param('id'));
    const card = registry.get(id);
    if (!card) return c.json({ error: 'Agent not found' }, 404);

    const trustScore = await probeAndScore(card);
    // Write back into the card for future searches
    registry.register({ ...card, trust: { ...trustScore, totalTransactions: 0, disputeRate: 0 } });

    return c.json({ agentId: id, ...trustScore });
  });

  // ---- Search ----------------------------------------------------------------

  /** Semantic search: embeds query if DMXAPI_KEY is set, falls back to keyword. */
  app.post('/v1/search', async c => {
    const body = (await c.req.json()) as SearchQuery;
    if (!body.query || typeof body.query !== 'string') {
      return c.json({ error: 'query is required' }, 400);
    }
    // Best-effort: compute query embedding for semantic search
    const queryEmbedding = await getEmbedding(body.query);
    const results = registry.search(body, queryEmbedding);
    return c.json({ results, total: results.length, semantic: !!queryEmbedding });
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

  // ---- Delegation: Intents ---------------------------------------------------

  /** Submit a TaskIntent (client agent looking for a provider) */
  app.post('/v1/intents', async c => {
    const body = await c.req.json();
    const result = TaskIntentSchema.safeParse(body);
    if (!result.success) {
      return c.json({ error: 'Invalid TaskIntent', details: result.error.flatten() }, 400);
    }
    const record = delegation.intents.submit(result.data);
    return c.json({ intentId: result.data.intentId, status: record.status }, 201);
  });

  /** Get an intent with its offers */
  app.get('/v1/intents/:id', c => {
    const record = delegation.intents.get(c.req.param('id'));
    if (!record) return c.json({ error: 'Intent not found' }, 404);
    return c.json(record);
  });

  /** Cancel an open intent */
  app.delete('/v1/intents/:id', c => {
    const record = delegation.intents.get(c.req.param('id'));
    if (!record) return c.json({ error: 'Intent not found' }, 404);
    if (record.status !== 'open') {
      return c.json({ error: `Cannot cancel intent in status: ${record.status}` }, 409);
    }
    delegation.intents.cancel(c.req.param('id'));
    return c.json({ status: 'cancelled' });
  });

  // ---- Delegation: Offers ----------------------------------------------------

  /** Provider submits an offer for an open intent */
  app.post('/v1/intents/:id/offers', async c => {
    const intentId = c.req.param('id');
    const record = delegation.intents.get(intentId);
    if (!record) return c.json({ error: 'Intent not found' }, 404);
    if (record.status !== 'open') {
      return c.json({ error: `Intent is not open (status: ${record.status})` }, 409);
    }

    const body = await c.req.json();
    const result = TaskOfferSchema.safeParse(body);
    if (!result.success) {
      return c.json({ error: 'Invalid TaskOffer', details: result.error.flatten() }, 400);
    }
    if (result.data.intentId !== intentId) {
      return c.json({ error: 'Offer intentId does not match' }, 400);
    }

    delegation.offers.add(result.data);
    delegation.intents.addOffer(intentId, result.data);
    return c.json({ offerId: result.data.offerId, status: 'submitted' }, 201);
  });

  /** Get a single offer */
  app.get('/v1/offers/:id', c => {
    const offer = delegation.offers.get(c.req.param('id'));
    if (!offer) return c.json({ error: 'Offer not found' }, 404);
    return c.json(offer);
  });

  /** Accept an offer → creates a TaskExecution */
  app.post('/v1/offers/:id/accept', c => {
    try {
      const execution = delegation.acceptOffer(c.req.param('id'));
      return c.json({ executionId: execution.executionId, status: execution.status }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('not found') ? 404 : 409;
      return c.json({ error: msg }, status);
    }
  });

  // ---- Delegation: Executions ------------------------------------------------

  /** Get execution status */
  app.get('/v1/executions/:id', c => {
    const execution = delegation.executions.get(c.req.param('id'));
    if (!execution) return c.json({ error: 'Execution not found' }, 404);
    return c.json(execution);
  });

  /** Update execution status (provider reports progress/completion) */
  app.patch('/v1/executions/:id', async c => {
    const body = (await c.req.json()) as { status: ExecutionStatus; result?: unknown; clientRating?: number };
    if (!body.status) return c.json({ error: 'status is required' }, 400);

    try {
      const execution = delegation.executions.update(c.req.param('id'), body);
      return c.json(execution);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('not found') ? 404 : 409;
      return c.json({ error: msg }, status);
    }
  });

  return app;
}
