import { describe, it, expect } from 'vitest';
import {
  validateAgentCard,
  validateTaskIntent,
  validateTaskOffer,
  validateQuotaCertificate,
} from './validation.js';
import { generateKeyPair, sign } from './crypto.js';

describe('validation', () => {
  const kp = generateKeyPair();

  function makeValidCard() {
    const card: Record<string, unknown> = {
      id: 'https://agent.example.com/.well-known/agent.json',
      name: 'Test Agent',
      description: 'A test agent for validation',
      version: '1.0.0',
      capabilities: [
        {
          id: 'translation.general',
          name: 'General Translation',
          description: 'Translates text between languages',
        },
      ],
      protocols: [
        { protocol: 'a2a', version: '1.0', endpoint: 'https://agent.example.com/a2a' },
      ],
      endpoint: 'https://agent.example.com/api',
      publicKey: kp.publicKey,
      domain: 'agent.example.com',
      created: '2026-03-08T00:00:00Z',
      updated: '2026-03-08T00:00:00Z',
    };
    card.signature = sign(card, kp.secretKey);
    return card;
  }

  describe('validateAgentCard', () => {
    it('should validate a correct AgentCard', () => {
      const result = validateAgentCard(makeValidCard());
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const result = validateAgentCard({ name: 'Incomplete' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid capability ID format', () => {
      const card = makeValidCard();
      (card.capabilities as unknown[])[0] = {
        id: 'Invalid-ID',
        name: 'Bad',
        description: 'Bad format',
      };
      const result = validateAgentCard(card);
      expect(result.success).toBe(false);
    });

    it('should reject invalid protocol', () => {
      const card = makeValidCard();
      (card.protocols as unknown[])[0] = {
        protocol: 'invalid_protocol',
        version: '1.0',
        endpoint: 'https://example.com',
      };
      const result = validateAgentCard(card);
      expect(result.success).toBe(false);
    });

    it('should accept card with settlement config', () => {
      const card = makeValidCard();
      card.settlement = {
        acceptedAssets: [{ type: 'usdc' }, { type: 'model_quota' }],
        preferredAsset: 'usdc',
        usdc: {
          address: '0x1234567890abcdef1234567890abcdef12345678',
          chain: 'base',
        },
      };
      card.signature = sign(card, kp.secretKey);
      const result = validateAgentCard(card);
      expect(result.success).toBe(true);
    });

    it('should accept card with SLA', () => {
      const card = makeValidCard();
      card.sla = {
        uptimePercent: 99.9,
        latencyP50Ms: 500,
        latencyP99Ms: 2000,
      };
      card.signature = sign(card, kp.secretKey);
      const result = validateAgentCard(card);
      expect(result.success).toBe(true);
    });

    it('should accept card with trust metadata', () => {
      const card = makeValidCard();
      card.trust = {
        score: 87.3,
        confidence: 'high',
        breakdown: {
          reliability: 92,
          quality: 88,
          timeliness: 85,
          tenure: 70,
          stake: 90,
        },
        totalTransactions: 1500,
        disputeRate: 0.02,
      };
      const result = validateAgentCard(card);
      expect(result.success).toBe(true);
    });

    it('should reject empty capabilities array', () => {
      const card = makeValidCard();
      card.capabilities = [];
      const result = validateAgentCard(card);
      expect(result.success).toBe(false);
    });

    it('should reject name exceeding max length', () => {
      const card = makeValidCard();
      card.name = 'A'.repeat(129);
      const result = validateAgentCard(card);
      expect(result.success).toBe(false);
    });
  });

  describe('validateTaskIntent', () => {
    function makeValidIntent() {
      const intent: Record<string, unknown> = {
        intentId: '550e8400-e29b-41d4-a716-446655440000',
        clientAgentId: 'https://buyer.example.com/.well-known/agent.json',
        type: 'task',
        task: {
          description: 'Translate this document from Chinese to English',
          capabilityRequired: 'translation.legal',
          constraints: { quality: 'best', minTrustScore: 80 },
        },
        budget: { maxAmount: 100, currency: 'USD' },
        ttl: 300,
        nonce: 'abc123',
        timestamp: '2026-03-08T00:00:00Z',
      };
      intent.signature = sign(intent, kp.secretKey);
      return intent;
    }

    it('should validate a correct TaskIntent', () => {
      const result = validateTaskIntent(makeValidIntent());
      expect(result.success).toBe(true);
    });

    it('should reject invalid type', () => {
      const intent = makeValidIntent();
      intent.type = 'invalid';
      const result = validateTaskIntent(intent);
      expect(result.success).toBe(false);
    });

    it('should reject zero TTL', () => {
      const intent = makeValidIntent();
      intent.ttl = 0;
      const result = validateTaskIntent(intent);
      expect(result.success).toBe(false);
    });

    it('should accept barter intent', () => {
      const intent = makeValidIntent();
      intent.type = 'barter';
      (intent.budget as Record<string, unknown>).barterOffer = {
        asset: 'model_quota',
        model: 'claude-opus-4.6',
        tokens: 2000000,
      };
      intent.signature = sign(intent, kp.secretKey);
      const result = validateTaskIntent(intent);
      expect(result.success).toBe(true);
    });
  });

  describe('validateTaskOffer', () => {
    function makeValidOffer() {
      const offer: Record<string, unknown> = {
        offerId: '550e8400-e29b-41d4-a716-446655440001',
        intentId: '550e8400-e29b-41d4-a716-446655440000',
        providerAgentId: 'https://provider.example.com/.well-known/agent.json',
        proposal: {
          description: 'I can translate this with 98% accuracy',
          estimatedDuration: 3600,
        },
        pricing: { amount: 85, asset: 'usdc' },
        validUntil: '2026-03-08T01:00:00Z',
        nonce: 'def456',
        timestamp: '2026-03-08T00:00:00Z',
      };
      offer.signature = sign(offer, kp.secretKey);
      return offer;
    }

    it('should validate a correct TaskOffer', () => {
      const result = validateTaskOffer(makeValidOffer());
      expect(result.success).toBe(true);
    });

    it('should accept offer with SLA commitment', () => {
      const offer = makeValidOffer();
      offer.slaCommitment = {
        uptimePercent: 99.9,
        latencyP50Ms: 500,
        latencyP99Ms: 2000,
      };
      offer.signature = sign(offer, kp.secretKey);
      const result = validateTaskOffer(offer);
      expect(result.success).toBe(true);
    });
  });

  describe('validateQuotaCertificate', () => {
    function makeValidCert() {
      const cert: Record<string, unknown> = {
        id: '550e8400-e29b-41d4-a716-446655440002',
        issuer: 'https://agent-a.example.com/.well-known/agent.json',
        grantee: 'https://agent-b.example.com/.well-known/agent.json',
        model: 'claude-opus-4.6',
        provider: 'anthropic',
        tokensGranted: 2000000,
        tokensUsed: 0,
        proxyEndpoint: 'https://agent-a.example.com/proxy/claude',
        validFrom: '2026-03-08T00:00:00Z',
        validUntil: '2026-04-08T00:00:00Z',
        revocable: false,
      };
      cert.signature = sign(cert, kp.secretKey);
      return cert;
    }

    it('should validate a correct QuotaCertificate', () => {
      const result = validateQuotaCertificate(makeValidCert());
      expect(result.success).toBe(true);
    });

    it('should reject zero tokens', () => {
      const cert = makeValidCert();
      cert.tokensGranted = 0;
      const result = validateQuotaCertificate(cert);
      expect(result.success).toBe(false);
    });

    it('should accept cert with escrow ID', () => {
      const cert = makeValidCert();
      cert.escrowId = 'escrow-123';
      cert.signature = sign(cert, kp.secretKey);
      const result = validateQuotaCertificate(cert);
      expect(result.success).toBe(true);
    });
  });
});
