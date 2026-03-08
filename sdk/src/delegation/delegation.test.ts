import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPair, sign } from '../core/crypto.js';
import { generateNonce } from '../core/crypto.js';
import { IntentBuilder } from './intent-builder.js';
import { OfferBuilder } from './offer-builder.js';
import { IntentStore, OfferStore, ExecutionStore, DelegationStore } from './store.js';
import type { TaskIntent, TaskOffer } from '../core/types.js';

// ---- Fixtures ----------------------------------------------------------------

const CLIENT_KP = generateKeyPair();
const PROVIDER_KP = generateKeyPair();

const CLIENT_ID = 'https://client.agent.test';
const PROVIDER_ID = 'https://provider.agent.test';

function makeIntent(overrides: Partial<Parameters<IntentBuilder['build']>[0]> = {}) {
  const builder = new IntentBuilder({ agentId: CLIENT_ID, secretKey: CLIENT_KP.secretKey });
  return builder.build({
    type: 'task',
    task: { description: 'Translate 5000 words from English to Chinese' },
    budget: { maxAmount: 0.5, currency: 'usdc' },
    ttl: 300,
    ...overrides,
  });
}

function makeOffer(intent: TaskIntent, overrides: Partial<Parameters<OfferBuilder['build']>[0]> = {}) {
  const builder = new OfferBuilder({ agentId: PROVIDER_ID, secretKey: PROVIDER_KP.secretKey });
  return builder.build({
    intent,
    proposal: { description: 'Will translate using GPT-4 in 2 hours', estimatedDuration: 7200 },
    pricing: { amount: 0.3, asset: 'usdc' },
    validForSeconds: 120,
    ...overrides,
  });
}

// ---- IntentBuilder tests -----------------------------------------------------

describe('IntentBuilder', () => {
  it('builds a valid TaskIntent', () => {
    const intent = makeIntent();
    expect(intent.intentId).toBeTruthy();
    expect(intent.clientAgentId).toBe(CLIENT_ID);
    expect(intent.type).toBe('task');
    expect(intent.task.description).toContain('Translate');
    expect(intent.ttl).toBe(300);
    expect(intent.nonce).toBeTruthy();
    expect(intent.timestamp).toBeTruthy();
    expect(intent.signature).toMatch(/^ed25519:/);
  });

  it('generates unique intentIds for each build', () => {
    const builder = new IntentBuilder({ agentId: CLIENT_ID, secretKey: CLIENT_KP.secretKey });
    const a = builder.build({ type: 'task', task: { description: 'Task A' }, ttl: 60 });
    const b = builder.build({ type: 'task', task: { description: 'Task B' }, ttl: 60 });
    expect(a.intentId).not.toBe(b.intentId);
  });

  it('defaults ttl to 300 seconds', () => {
    const builder = new IntentBuilder({ agentId: CLIENT_ID, secretKey: CLIENT_KP.secretKey });
    const intent = builder.build({ type: 'task', task: { description: 'test' } });
    expect(intent.ttl).toBe(300);
  });

  it('includes optional budget fields', () => {
    const intent = makeIntent();
    expect(intent.budget?.maxAmount).toBe(0.5);
    expect(intent.budget?.currency).toBe('usdc');
  });

  it('isExpired() returns false for fresh intent', () => {
    const intent = makeIntent({ ttl: 300 });
    expect(IntentBuilder.isExpired(intent)).toBe(false);
  });

  it('isExpired() returns true for past intent', () => {
    const intent = makeIntent({ ttl: 1 });
    // Backdating timestamp to 2 seconds ago
    const pastIntent = { ...intent, timestamp: new Date(Date.now() - 2000).toISOString() };
    expect(IntentBuilder.isExpired(pastIntent)).toBe(true);
  });
});

// ---- OfferBuilder tests ------------------------------------------------------

describe('OfferBuilder', () => {
  it('builds a valid TaskOffer referencing the intent', () => {
    const intent = makeIntent();
    const offer = makeOffer(intent);

    expect(offer.offerId).toBeTruthy();
    expect(offer.intentId).toBe(intent.intentId);
    expect(offer.providerAgentId).toBe(PROVIDER_ID);
    expect(offer.proposal.description).toBeTruthy();
    expect(offer.pricing.amount).toBe(0.3);
    expect(offer.pricing.asset).toBe('usdc');
    expect(offer.signature).toMatch(/^ed25519:/);
  });

  it('sets validUntil to future time', () => {
    const intent = makeIntent();
    const offer = makeOffer(intent, { validForSeconds: 60 });
    const validUntil = new Date(offer.validUntil).getTime();
    expect(validUntil).toBeGreaterThan(Date.now());
  });

  it('generates unique offerIds', () => {
    const intent = makeIntent();
    const a = makeOffer(intent);
    const b = makeOffer(intent);
    expect(a.offerId).not.toBe(b.offerId);
  });

  it('isValid() returns true for fresh offer', () => {
    const offer = makeOffer(makeIntent(), { validForSeconds: 120 });
    expect(OfferBuilder.isValid(offer)).toBe(true);
  });

  it('isValid() returns false for expired offer', () => {
    const offer = makeOffer(makeIntent(), { validForSeconds: 1 });
    const expiredOffer = { ...offer, validUntil: new Date(Date.now() - 1000).toISOString() };
    expect(OfferBuilder.isValid(expiredOffer)).toBe(false);
  });
});

// ---- IntentStore tests -------------------------------------------------------

describe('IntentStore', () => {
  let store: IntentStore;
  beforeEach(() => { store = new IntentStore(); });

  it('submits an intent and returns record with open status', () => {
    const intent = makeIntent();
    const record = store.submit(intent);
    expect(record.status).toBe('open');
    expect(record.offers).toHaveLength(0);
  });

  it('get() returns submitted intent', () => {
    const intent = makeIntent();
    store.submit(intent);
    const record = store.get(intent.intentId);
    expect(record?.intent.intentId).toBe(intent.intentId);
  });

  it('get() returns undefined for unknown intent', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('addOffer() adds offer to intent', () => {
    const intent = makeIntent();
    const offer = makeOffer(intent);
    store.submit(intent);
    const record = store.addOffer(intent.intentId, offer);
    expect(record.offers).toHaveLength(1);
    expect(record.offers[0].offerId).toBe(offer.offerId);
  });

  it('addOffer() throws for unknown intent', () => {
    const intent = makeIntent();
    const offer = makeOffer(intent);
    expect(() => store.addOffer('nonexistent', offer)).toThrow('not found');
  });

  it('cancel() marks intent as cancelled', () => {
    const intent = makeIntent();
    store.submit(intent);
    store.cancel(intent.intentId);
    expect(store.get(intent.intentId)?.status).toBe('cancelled');
  });

  it('list() filters by status', () => {
    const a = makeIntent();
    const b = makeIntent();
    store.submit(a);
    store.submit(b);
    store.cancel(b.intentId);

    const open = store.list({ status: 'open' });
    const cancelled = store.list({ status: 'cancelled' });
    expect(open).toHaveLength(1);
    expect(cancelled).toHaveLength(1);
  });
});

// ---- ExecutionStore tests ----------------------------------------------------

describe('ExecutionStore', () => {
  let store: ExecutionStore;
  let baseOffer: TaskOffer;

  beforeEach(() => {
    store = new ExecutionStore();
    baseOffer = makeOffer(makeIntent());
  });

  it('create() returns execution with accepted status', () => {
    const execution = store.create(baseOffer);
    expect(execution.status).toBe('accepted');
    expect(execution.offerId).toBe(baseOffer.offerId);
    expect(execution.intentId).toBe(baseOffer.intentId);
    expect(execution.executionId).toBeTruthy();
    expect(execution.acceptedAt).toBeTruthy();
  });

  it('update() transitions accepted → in_progress', () => {
    const execution = store.create(baseOffer);
    const updated = store.update(execution.executionId, { status: 'in_progress' });
    expect(updated.status).toBe('in_progress');
    expect(updated.startedAt).toBeTruthy();
  });

  it('update() transitions in_progress → completed with result', () => {
    const execution = store.create(baseOffer);
    store.update(execution.executionId, { status: 'in_progress' });
    const done = store.update(execution.executionId, {
      status: 'completed',
      result: { translatedText: '你好世界' },
      clientRating: 5,
    });
    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ translatedText: '你好世界' });
    expect(done.clientRating).toBe(5);
    expect(done.completedAt).toBeTruthy();
  });

  it('update() rejects invalid transition', () => {
    const execution = store.create(baseOffer);
    expect(() => store.update(execution.executionId, { status: 'completed' }))
      .toThrow('Invalid transition');
  });

  it('update() throws for unknown execution', () => {
    expect(() => store.update('nonexistent', { status: 'in_progress' }))
      .toThrow('not found');
  });
});

// ---- DelegationStore tests ---------------------------------------------------

describe('DelegationStore', () => {
  let store: DelegationStore;

  beforeEach(() => { store = new DelegationStore(); });

  it('full happy path: submit intent → add offer → accept → start → complete', () => {
    const intent = makeIntent();
    const offer = makeOffer(intent);

    // 1. Submit intent
    const record = store.intents.submit(intent);
    expect(record.status).toBe('open');

    // 2. Add offer
    store.offers.add(offer);
    store.intents.addOffer(intent.intentId, offer);

    // 3. Accept offer
    const execution = store.acceptOffer(offer.offerId);
    expect(execution.status).toBe('accepted');
    expect(store.intents.get(intent.intentId)?.status).toBe('matched');

    // 4. Provider starts work
    const started = store.executions.update(execution.executionId, { status: 'in_progress' });
    expect(started.startedAt).toBeTruthy();

    // 5. Provider completes
    const done = store.executions.update(execution.executionId, {
      status: 'completed',
      result: { output: 'Translation done' },
    });
    expect(done.status).toBe('completed');
  });

  it('acceptOffer() throws when offer not found', () => {
    expect(() => store.acceptOffer('nonexistent')).toThrow('not found');
  });

  it('acceptOffer() throws when offer is expired', () => {
    const intent = makeIntent();
    const offer = makeOffer(intent, { validForSeconds: 1 });
    const expiredOffer = { ...offer, validUntil: new Date(Date.now() - 1000).toISOString() };
    store.intents.submit(intent);
    store.offers.add(expiredOffer);
    expect(() => store.acceptOffer(expiredOffer.offerId)).toThrow('expired');
  });

  it('acceptOffer() throws when intent already matched', () => {
    const intent = makeIntent();
    const offer1 = makeOffer(intent);
    const offer2 = makeOffer(intent);

    store.intents.submit(intent);
    store.offers.add(offer1);
    store.offers.add(offer2);
    store.intents.addOffer(intent.intentId, offer1);
    store.intents.addOffer(intent.intentId, offer2);

    store.acceptOffer(offer1.offerId);
    expect(() => store.acceptOffer(offer2.offerId)).toThrow('not open');
  });
});
