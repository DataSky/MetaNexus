/**
 * E2E Smoke Test — MetaNexus full delegation + swap flow
 *
 * Spins up the Hono app in-process (no real network) and walks through:
 *   1. Agent registration (client + provider)
 *   2. Client posts a TaskIntent
 *   3. Provider submits a TaskOffer
 *   4. Client accepts the offer → TaskExecution created
 *   5. Provider marks execution complete
 *   6. Quota Swap: quote + barter order + match
 *
 * All crypto is real (ed25519 via tweetnacl), no mocks except DMXAPI embeddings.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createApp } from './app.js';
import { AgentRegistry } from '../../sdk/src/discovery/registry.js';
import { DelegationStore } from '../../sdk/src/delegation/store.js';
import { IntentBuilder } from '../../sdk/src/delegation/intent-builder.js';
import { OfferBuilder } from '../../sdk/src/delegation/offer-builder.js';
import { generateKeyPair } from '../../sdk/src/core/crypto.js';
import type { UniversalAgentCard } from '../../sdk/src/core/types.js';

// Disable real DMXAPI calls
vi.mock('../../sdk/src/discovery/embeddings.js', () => ({
  getEmbedding: vi.fn().mockResolvedValue(null),
  cardToText: (card: UniversalAgentCard) => `${card.name} ${card.description}`,
  cosine: () => 0,
}));

// ---- Helpers -----------------------------------------------------------------

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

function makeCard(id: string, name: string): UniversalAgentCard {
  return {
    id,
    name,
    description: `${name} — smoke test agent`,
    version: '1.0.0',
    capabilities: [{ id: 'translate', name: 'Translate', description: 'Translation service' }],
    protocols: [{ protocol: 'a2a', version: '0.2', endpoint: id }],
    endpoint: id,
    publicKey: '',
    domain: new URL(id).hostname,
    tags: ['smoke-test'],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    signature: '',
  };
}

// ---- Suite -------------------------------------------------------------------

describe('E2E Smoke: Full Delegation Flow', () => {
  const CLIENT_ID = 'https://client.smoke.test';
  const PROVIDER_ID = 'https://provider.smoke.test';
  const clientKP = generateKeyPair();
  const providerKP = generateKeyPair();

  const state: {
    app: ReturnType<typeof createApp>;
    intentId: string;
    offerId: string;
    executionId: string;
  } = {} as never;

  beforeAll(() => {
    state.app = createApp(new AgentRegistry(), new DelegationStore());
  });

  it('health check passes', async () => {
    const { status, body } = await req(state.app, 'GET', '/v1/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('registers client agent', async () => {
    const { status, body } = await req(state.app, 'POST', '/v1/agents', makeCard(CLIENT_ID, 'Client Agent'));
    expect(status).toBe(201);
    expect(body.agentId).toBe(CLIENT_ID);
  });

  it('registers provider agent', async () => {
    const { status, body } = await req(state.app, 'POST', '/v1/agents', makeCard(PROVIDER_ID, 'Provider Agent'));
    expect(status).toBe(201);
    expect(body.agentId).toBe(PROVIDER_ID);
  });

  it('client posts a TaskIntent', async () => {
    const builder = new IntentBuilder({ agentId: CLIENT_ID, secretKey: clientKP.secretKey });
    const intent = builder.build({
      type: 'task',
      task: { description: 'Translate 5000 words EN→ZH' },
      budget: { maxAmount: 0.5, currency: 'usdc' },
      ttl: 300,
    });

    const { status, body } = await req(state.app, 'POST', '/v1/intents', intent);
    expect(status).toBe(201);
    expect(body.intentId).toBeTruthy();
    expect(body.status).toBe('open');
    state.intentId = body.intentId;
  });

  it('provider fetches the intent', async () => {
    const { status, body } = await req(state.app, 'GET', `/v1/intents/${state.intentId}`);
    expect(status).toBe(200);
    expect(body.intent.intentId).toBe(state.intentId);
    expect(body.offers).toHaveLength(0);
  });

  it('provider submits a TaskOffer', async () => {
    const { body: intentBody } = await req(state.app, 'GET', `/v1/intents/${state.intentId}`);
    const intent = intentBody.intent;

    const builder = new OfferBuilder({ agentId: PROVIDER_ID, secretKey: providerKP.secretKey });
    const offer = builder.build({
      intent,
      proposal: { description: 'Will translate using GPT-4 in 2 hours', estimatedDuration: 7200 },
      pricing: { amount: 0.3, asset: 'usdc' },
      validForSeconds: 120,
    });

    const { status, body } = await req(state.app, 'POST', `/v1/intents/${state.intentId}/offers`, offer);
    expect(status).toBe(201);
    expect(body.offerId).toBeTruthy();
    state.offerId = body.offerId;
  });

  it('intent now has one offer attached', async () => {
    const { body } = await req(state.app, 'GET', `/v1/intents/${state.intentId}`);
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0].offerId).toBe(state.offerId);
  });

  it('client accepts the offer → execution created', async () => {
    const { status, body } = await req(state.app, 'POST', `/v1/offers/${state.offerId}/accept`);
    expect(status).toBe(201);
    expect(body.executionId).toBeTruthy();
    expect(body.status).toBe('accepted');
    state.executionId = body.executionId;
  });

  it('provider marks execution as in_progress', async () => {
    const { status, body } = await req(state.app, 'PATCH', `/v1/executions/${state.executionId}`, {
      status: 'in_progress',
    });
    expect(status).toBe(200);
    expect(body.status).toBe('in_progress');
  });

  it('provider marks execution as completed with result', async () => {
    const { status, body } = await req(state.app, 'PATCH', `/v1/executions/${state.executionId}`, {
      status: 'completed',
      result: { translatedWords: 5000, quality: 'high' },
      clientRating: 5,
    });
    expect(status).toBe(200);
    expect(body.status).toBe('completed');
    expect(body.result).toBeTruthy();
  });

  it('completed execution is retrievable', async () => {
    const { status, body } = await req(state.app, 'GET', `/v1/executions/${state.executionId}`);
    expect(status).toBe(200);
    expect(body.status).toBe('completed');
    expect(body.clientRating).toBe(5);
  });
});

describe('E2E Smoke: Quota Swap Flow', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp(new AgentRegistry(), new DelegationStore());
  });

  it('GET /v1/swap/index returns SOTA model prices', async () => {
    const { status, body } = await req(app, 'GET', '/v1/swap/index');
    expect(status).toBe(200);
    expect(body.models).toBeInstanceOf(Array);
    expect(body.models.length).toBeGreaterThan(3);
    const sonnet = body.models.find((m: { model: string }) => m.model === 'claude-sonnet-4.6');
    expect(sonnet?.indexPrice).toBeGreaterThan(18);
  });

  it('POST /v1/swap/quote returns a fair swap quote', async () => {
    const { status, body } = await req(app, 'POST', '/v1/swap/quote', {
      from: { model: 'claude-sonnet-4.6', tokens: 2_000_000 },
      to: { model: 'gemini-flash' },
    });
    expect(status).toBe(200);
    expect(body.fair).toBe(true);
    expect(body.to.tokens).toBeGreaterThan(100_000_000);
    expect(body.recommendation).toBe('accept');
  });

  it('POST /v1/swap/quote flags unfair swap', async () => {
    const { status, body } = await req(app, 'POST', '/v1/swap/quote', {
      from: { model: 'claude-sonnet-4.6', tokens: 2_000_000 },
      to: { model: 'gemini-flash', tokens: 1_000_000 },
    });
    expect(status).toBe(200);
    expect(body.fair).toBe(false);
    expect(body.recommendation).toBe('renegotiate');
  });

  it('POST /v1/swap/orders creates a barter order', async () => {
    const { status, body } = await req(app, 'POST', '/v1/swap/orders', {
      agentId: 'https://agent-a.test',
      offering: { model: 'claude-sonnet-4.6', tokens: 2_000_000 },
      seeking: { model: 'gemini-flash', tokens: 137_000_000 },
    });
    expect(status).toBe(201);
    expect(body.orderId).toBeTruthy();
    expect(body.status).toBe('open');
  });

  it('GET /v1/swap/orders lists open orders', async () => {
    const { status, body } = await req(app, 'GET', '/v1/swap/orders');
    expect(status).toBe(200);
    expect(body.orders).toBeInstanceOf(Array);
    expect(body.orders.length).toBeGreaterThanOrEqual(1);
  });
});
