import { describe, it, expect } from 'vitest';
import { generateKeyPair, sign, verify, signCard, verifyCard, canonicalize } from './crypto.js';
import type { UniversalAgentCard } from './types.js';

describe('ed25519 crypto', () => {
  it('generates a key pair', async () => {
    const keys = await generateKeyPair();
    expect(keys.publicKey).toBeTruthy();
    expect(keys.privateKey).toBeTruthy();
    expect(keys.publicKey.length).toBeGreaterThan(10);
    expect(keys.privateKey.length).toBeGreaterThan(10);
  });

  it('signs and verifies a string', async () => {
    const keys = await generateKeyPair();
    const message = 'hello metanexus';

    const signature = await sign(message, keys.privateKey);
    expect(signature).toMatch(/^ed25519:/);

    const valid = await verify(message, signature, keys.publicKey);
    expect(valid).toBe(true);
  });

  it('rejects tampered data', async () => {
    const keys = await generateKeyPair();
    const signature = await sign('original', keys.privateKey);

    const valid = await verify('tampered', signature, keys.publicKey);
    expect(valid).toBe(false);
  });

  it('rejects wrong key', async () => {
    const keys1 = await generateKeyPair();
    const keys2 = await generateKeyPair();

    const signature = await sign('message', keys1.privateKey);
    const valid = await verify('message', signature, keys2.publicKey);
    expect(valid).toBe(false);
  });

  it('rejects invalid signature format', async () => {
    const keys = await generateKeyPair();
    const valid = await verify('message', 'rsa:invalid', keys.publicKey);
    expect(valid).toBe(false);
  });
});

describe('signCard / verifyCard', () => {
  it('signs and verifies an agent card', async () => {
    const keys = await generateKeyPair();

    const card: Omit<UniversalAgentCard, 'signature'> = {
      id: 'https://test.example.com/.well-known/agent.json',
      name: 'Test Agent',
      description: 'A test agent',
      version: '1.0.0',
      capabilities: [{ id: 'test.ping', name: 'Ping' }],
      protocols: [],
      endpoint: 'https://test.example.com/api',
      publicKey: keys.publicKey,
      domain: 'test.example.com',
      created: '2026-03-08T00:00:00Z',
      updated: '2026-03-08T00:00:00Z',
    };

    const signed = await signCard(card, keys.privateKey);
    expect(signed.signature).toMatch(/^ed25519:/);

    const valid = await verifyCard(signed);
    expect(valid).toBe(true);
  });

  it('detects tampered card', async () => {
    const keys = await generateKeyPair();

    const card: Omit<UniversalAgentCard, 'signature'> = {
      id: 'https://test.example.com/.well-known/agent.json',
      name: 'Original Name',
      description: 'A test agent',
      version: '1.0.0',
      capabilities: [{ id: 'test.ping', name: 'Ping' }],
      protocols: [],
      endpoint: 'https://test.example.com/api',
      publicKey: keys.publicKey,
      domain: 'test.example.com',
      created: '2026-03-08T00:00:00Z',
      updated: '2026-03-08T00:00:00Z',
    };

    const signed = await signCard(card, keys.privateKey);

    // Tamper with the name
    const tampered = { ...signed, name: 'Hacked Agent' };
    const valid = await verifyCard(tampered);
    expect(valid).toBe(false);
  });

  it('ignores trust field during verification', async () => {
    const keys = await generateKeyPair();

    const card: Omit<UniversalAgentCard, 'signature'> = {
      id: 'https://test.example.com/.well-known/agent.json',
      name: 'Test Agent',
      description: 'A test agent',
      version: '1.0.0',
      capabilities: [{ id: 'test.ping', name: 'Ping' }],
      protocols: [],
      endpoint: 'https://test.example.com/api',
      publicKey: keys.publicKey,
      domain: 'test.example.com',
      created: '2026-03-08T00:00:00Z',
      updated: '2026-03-08T00:00:00Z',
    };

    const signed = await signCard(card, keys.privateKey);

    // Adding trust metadata (MetaNexus-populated) should not break verification
    const withTrust = {
      ...signed,
      trust: {
        score: 87.3,
        breakdown: { reliability: 90, quality: 85, timeliness: 88, tenure: 70, stake: 95 },
        confidence: 0.8,
        computedAt: '2026-03-08T00:00:00Z',
      },
    };
    const valid = await verifyCard(withTrust);
    expect(valid).toBe(true);
  });
});
