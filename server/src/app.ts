/**
 * MetaNexus Registry API
 * Hono app — routes only, no side effects, importable in tests.
 */

import { Hono } from 'hono';
import { AgentRegistry } from '../../sdk/src/discovery/registry.js';
import { Crawler } from '../../sdk/src/discovery/crawler.js';
import { probeAndScore } from '../../sdk/src/discovery/trust.js';
import { TrustLedger } from '../../sdk/src/discovery/trust-ledger.js';
import { DelegationStore } from '../../sdk/src/delegation/store.js';
import { RegisterAgentCardSchema } from '../../sdk/src/core/validation.js';
import { TaskIntentSchema, TaskOfferSchema } from '../../sdk/src/core/validation.js';
import { createSOTAIndex, quoteSwap, createBarterOrder, InMemorySwapBook } from '../../sdk/src/settlement/index.js';
import type { SearchQuery, ExecutionStatus } from '../../sdk/src/core/types.js';
import type { IAgentStore, IDelegationStore } from './db/interfaces.js';

// Shared SOTA index and swap book (in-memory for MVP)
const sotaIndex = createSOTAIndex();
const swapBook = new InMemorySwapBook();
// Shared trust ledger — updated on every terminal execution
const trustLedger = new TrustLedger();

export function createApp(
  registry: IAgentStore = new AgentRegistry(),
  delegation: IDelegationStore = new DelegationStore(),
) {
  const app = new Hono();
  const crawler = new Crawler();

  // ---- Health ----------------------------------------------------------------
  app.get('/v1/health', async c => {
    const agents = registry.count ? await registry.count() : (registry as AgentRegistry).size;
    return c.json({ status: 'ok', agents });
  });

  // ---- Agents ----------------------------------------------------------------

  /** Register or update an agent */
  app.post('/v1/agents', async c => {
    const body = await c.req.json();
    const result = RegisterAgentCardSchema.safeParse(body);
    if (!result.success) {
      return c.json({ error: 'Invalid AgentCard', details: result.error.flatten() }, 400);
    }
    await registry.register(result.data);
    return c.json({ agentId: result.data.id, status: 'registered' }, 201);
  });

  /** Get a single agent by ID */
  app.get('/v1/agents/:id', async c => {
    const id = decodeURIComponent(c.req.param('id'));
    const card = await registry.get(id);
    if (!card) return c.json({ error: 'Agent not found' }, 404);
    return c.json(card);
  });

  /** List all agents (paginated) */
  app.get('/v1/agents', async c => {
    const limit = Math.min(Number(c.req.query('limit') ?? 20), 100);
    const offset = Number(c.req.query('offset') ?? 0);
    const agents = await registry.list(limit, offset);
    const total = registry.count ? await registry.count() : agents.length;
    return c.json({ agents, total, limit, offset });
  });

  /** Delete an agent */
  app.delete('/v1/agents/:id', async c => {
    const id = decodeURIComponent(c.req.param('id'));
    const deleted = await registry.delete(id);
    if (!deleted) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ status: 'deleted' });
  });

  // ---- Trust -----------------------------------------------------------------

  /** Probe an agent's endpoint and return its computed trust score */
  app.get('/v1/agents/:id/trust', async c => {
    const id = decodeURIComponent(c.req.param('id'));
    const card = await registry.get(id);
    if (!card) return c.json({ error: 'Agent not found' }, 404);

    const trustScore = await probeAndScore(card);
    await registry.register({ ...card, trust: { ...trustScore, totalTransactions: 0, disputeRate: 0 } });

    return c.json({ agentId: id, ...trustScore });
  });

  // ---- Search ----------------------------------------------------------------

  /** Semantic search: registry handles embedding internally */
  app.post('/v1/search', async c => {
    const body = (await c.req.json()) as SearchQuery;
    if (!body.query || typeof body.query !== 'string') {
      return c.json({ error: 'query is required' }, 400);
    }
    const results = await registry.search(body);
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
        await registry.register(r.card);
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
    const record = await delegation.intents.submit(result.data);
    return c.json({ intentId: result.data.intentId, status: record.status }, 201);
  });

  /** Get an intent with its offers */
  app.get('/v1/intents/:id', async c => {
    const record = await delegation.intents.get(c.req.param('id'));
    if (!record) return c.json({ error: 'Intent not found' }, 404);
    return c.json(record);
  });

  /** Cancel an open intent */
  app.delete('/v1/intents/:id', async c => {
    const record = await delegation.intents.get(c.req.param('id'));
    if (!record) return c.json({ error: 'Intent not found' }, 404);
    if (record.status !== 'open') {
      return c.json({ error: `Cannot cancel intent in status: ${record.status}` }, 409);
    }
    await delegation.intents.cancel(c.req.param('id'));
    return c.json({ status: 'cancelled' });
  });

  // ---- Delegation: Offers ----------------------------------------------------

  /** Provider submits an offer for an open intent */
  app.post('/v1/intents/:id/offers', async c => {
    const intentId = c.req.param('id');
    const record = await delegation.intents.get(intentId);
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

    await delegation.offers.add(result.data);
    await delegation.intents.addOffer(intentId, result.data);
    return c.json({ offerId: result.data.offerId, status: 'submitted' }, 201);
  });

  /** Get a single offer */
  app.get('/v1/offers/:id', async c => {
    const offer = await delegation.offers.get(c.req.param('id'));
    if (!offer) return c.json({ error: 'Offer not found' }, 404);
    return c.json(offer);
  });

  /** Accept an offer → creates a TaskExecution */
  app.post('/v1/offers/:id/accept', async c => {
    try {
      const execution = await delegation.acceptOffer(c.req.param('id'));
      return c.json({ executionId: execution.executionId, status: execution.status }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('not found') ? 404 : 409;
      return c.json({ error: msg }, status);
    }
  });

  // ---- Delegation: Executions ------------------------------------------------

  /** Get execution status */
  app.get('/v1/executions/:id', async c => {
    const execution = await delegation.executions.get(c.req.param('id'));
    if (!execution) return c.json({ error: 'Execution not found' }, 404);
    return c.json(execution);
  });

  /** Update execution status (provider reports progress/completion) */
  app.patch('/v1/executions/:id', async c => {
    const body = (await c.req.json()) as { status: ExecutionStatus; result?: unknown; clientRating?: number };
    if (!body.status) return c.json({ error: 'status is required' }, 400);

    try {
      const execution = await delegation.executions.update(c.req.param('id'), body);

      // On terminal status: update trust ledger for the provider
      if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'disputed') {
        const offer = await delegation.offers.get(execution.offerId);
        const intent = offer ? await delegation.intents.get(offer.intentId) : null;
        if (offer && intent) {
          const outcome = TrustLedger.fromExecution(
            execution,
            offer.providerAgentId,
            intent.intent.clientAgentId,
          );
          if (outcome) {
            const newScore = trustLedger.record(outcome);
            // Persist updated trust score back to registry
            const card = await registry.get(offer.providerAgentId);
            if (card) {
              await registry.register({
                ...card,
                trust: {
                  ...newScore,
                  totalTransactions: trustLedger.getHistory(offer.providerAgentId)?.outcomes.length ?? 0,
                  disputeRate: outcome.status === 'disputed' ? 1 : 0,
                },
              });
            }
          }
        }
      }

      return c.json(execution);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('not found') ? 404 : 409;
      return c.json({ error: msg }, status);
    }
  });

  /** GET /v1/trust/leaderboard — agents ranked by execution-based trust score */
  app.get('/v1/trust/leaderboard', c => {
    return c.json({ leaderboard: trustLedger.leaderboard() });
  });

  /** GET /v1/trust/:agentId — execution history trust score for an agent */
  app.get('/v1/trust/:agentId', c => {
    const agentId = decodeURIComponent(c.req.param('agentId'));
    const score = trustLedger.getScore(agentId);
    if (!score) return c.json({ error: 'No execution history for this agent' }, 404);
    const history = trustLedger.getHistory(agentId);
    return c.json({
      agentId,
      score,
      totalTransactions: history?.outcomes.length ?? 0,
      lastUpdated: history?.lastUpdated,
    });
  });

  // ---- Quota Swap ----------------------------------------------------------

  /** GET /v1/swap/index — SOTA model price index */
  app.get('/v1/swap/index', c => {
    return c.json(sotaIndex);
  });

  /** POST /v1/swap/quote — compute a fair-value swap quote */
  app.post('/v1/swap/quote', async c => {
    try {
      const body = await c.req.json();
      if (!body.from?.model || typeof body.from?.tokens !== 'number') {
        return c.json({ error: 'from.model and from.tokens are required' }, 400);
      }
      const quote = quoteSwap(sotaIndex, body);
      return c.json(quote);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  /** POST /v1/swap/orders — submit a barter order */
  app.post('/v1/swap/orders', async c => {
    try {
      const body = await c.req.json();
      if (!body.agentId || !body.offering?.model || !body.seeking?.model) {
        return c.json({ error: 'agentId, offering.model, and seeking.model are required' }, 400);
      }
      const order = createBarterOrder(body);
      swapBook.add(order);
      // Attempt immediate match
      const match = swapBook.findMatch(order, sotaIndex);
      return c.json({ ...order, match: match ?? null }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  /** GET /v1/swap/orders — list open barter orders */
  app.get('/v1/swap/orders', c => {
    return c.json({ orders: swapBook.listOpen() });
  });

  return app;
}
