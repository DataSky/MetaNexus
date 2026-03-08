import { describe, it, expect } from 'vitest';
import { canonicalize } from './crypto.js';
import { validateAgentCard, validateIntent } from './validation.js';

// ─── Canonical JSON ─────────────────────────────────────────────────────────

describe('canonicalize', () => {
  it('sorts keys alphabetically', () => {
    const result = canonicalize({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested keys', () => {
    const result = canonicalize({ b: { z: 1, a: 2 }, a: 1 });
    expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  it('strips signature and trust fields', () => {
    const result = canonicalize({
      name: 'test',
      signature: 'ed25519:xxx',
      trust: { score: 80 },
      description: 'hello',
    });
    expect(result).toBe('{"description":"hello","name":"test"}');
  });

  it('handles arrays without sorting them', () => {
    const result = canonicalize({ tags: ['c', 'a', 'b'] });
    expect(result).toBe('{"tags":["c","a","b"]}');
  });

  it('handles null values', () => {
    const result = canonicalize({ a: null, b: 1 });
    expect(result).toBe('{"a":null,"b":1}');
  });
});

// ─── AgentCard Validation ───────────────────────────────────────────────────

describe('validateAgentCard', () => {
  const validCard = {
    id: 'https://agent.example.com/.well-known/agent.json',
    name: 'Test Agent',
    description: 'A test agent for validation',
    version: '1.0.0',
    capabilities: [
      {
        id: 'translation.general',
        name: 'General Translation',
      },
    ],
    protocols: [
      {
        protocol: 'a2a',
        version: '1.0',
        endpoint: 'https://agent.example.com/a2a',
      },
    ],
    endpoint: 'https://agent.example.com/api',
    publicKey: 'MCowBQYDK2VwAyEAfakekey123456789',
    domain: 'agent.example.com',
    created: '2026-03-08T00:00:00Z',
    updated: '2026-03-08T00:00:00Z',
    signature: 'ed25519:fakesignaturebase64url',
  };

  it('accepts a valid card', () => {
    const result = validateAgentCard(validCard);
    expect(result.success).toBe(true);
  });

  it('rejects card without required fields', () => {
    const { name: _, ...noName } = validCard;
    const result = validateAgentCard(noName);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.includes('name'))).toBe(true);
    }
  });

  it('rejects card with invalid capability ID', () => {
    const invalid = {
      ...validCard,
      capabilities: [{ id: 'InvalidCapId', name: 'Test' }],
    };
    const result = validateAgentCard(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects card with no capabilities', () => {
    const invalid = { ...validCard, capabilities: [] };
    const result = validateAgentCard(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects card with invalid signature format', () => {
    const invalid = { ...validCard, signature: 'not-ed25519-format' };
    const result = validateAgentCard(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts card with settlement config', () => {
    const withSettlement = {
      ...validCard,
      settlement: {
        acceptedAssets: [{ type: 'usdc' }, { type: 'model_quota' }],
        preferredAsset: 'usdc',
        usdc: {
          address: '0x1234567890abcdef1234567890abcdef12345678',
          chain: 'base',
        },
        quotas: [
          {
            provider: 'anthropic',
            model: 'claude-opus-4.6',
            tokensAvailable: 10000000,
            ratePerMToken: 15.0,
          },
        ],
      },
    };
    const result = validateAgentCard(withSettlement);
    expect(result.success).toBe(true);
  });

  it('rejects invalid USDC address', () => {
    const invalid = {
      ...validCard,
      settlement: {
        acceptedAssets: [{ type: 'usdc' }],
        usdc: { address: 'not-an-address', chain: 'base' },
      },
    };
    const result = validateAgentCard(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts card with SLA declaration', () => {
    const withSLA = {
      ...validCard,
      sla: {
        uptime: 99.9,
        latencyP50Ms: 200,
        latencyP99Ms: 2000,
        throughputRps: 100,
      },
    };
    const result = validateAgentCard(withSLA);
    expect(result.success).toBe(true);
  });

  it('accepts card with tags', () => {
    const withTags = {
      ...validCard,
      tags: ['translation', 'chinese', 'legal'],
      regions: ['US', 'CN'],
      languages: ['en', 'zh-Hans'],
    };
    const result = validateAgentCard(withTags);
    expect(result.success).toBe(true);
  });
});

// ─── TaskIntent Validation ──────────────────────────────────────────────────

describe('validateIntent', () => {
  const validIntent = {
    intentId: '01234567-89ab-cdef-0123-456789abcdef',
    clientAgentId: 'https://buyer.example.com/.well-known/agent.json',
    type: 'task',
    task: {
      description: 'Translate this legal document from Chinese to English',
      capabilityRequired: 'translation.legal',
      constraints: {
        quality: 'best',
        minTrustScore: 70,
        compliance: ['hipaa'],
      },
    },
    budget: {
      maxAmount: 100,
      currency: 'USDC',
      acceptedAssets: ['usdc', 'model_quota'],
    },
    ttl: 300,
    deadline: '2026-03-10T00:00:00Z',
    nonce: 'random-nonce-123',
    timestamp: '2026-03-08T00:00:00Z',
    signature: 'ed25519:fakesigbase64url',
  };

  it('accepts a valid intent', () => {
    const result = validateIntent(validIntent);
    expect(result.success).toBe(true);
  });

  it('rejects intent without task description', () => {
    const invalid = {
      ...validIntent,
      task: { ...validIntent.task, description: '' },
    };
    const result = validateIntent(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects intent with zero TTL', () => {
    const invalid = { ...validIntent, ttl: 0 };
    const result = validateIntent(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts barter intent', () => {
    const barter = {
      ...validIntent,
      type: 'barter',
      budget: {
        barterOffer: {
          asset: 'model_quota',
          details: {
            provider: 'openai',
            model: 'gpt-5.4',
            tokens: 5000000,
          },
        },
      },
    };
    const result = validateIntent(barter);
    expect(result.success).toBe(true);
  });
});
