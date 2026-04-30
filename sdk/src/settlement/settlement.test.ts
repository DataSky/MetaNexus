import { describe, expect, it } from 'vitest';
import {
  availableTokens,
  consumeQuota,
  createBarterOrder,
  createQuotaCertificate,
  createSOTAIndex,
  formatSwapQuote,
  InMemorySwapBook,
  quoteSwap,
} from './index.js';

describe('SOTA Index and Model Quota Swap MVP', () => {
  it('computes deterministic index prices', () => {
    const index = createSOTAIndex();
    const sonnet = index.models.find(m => m.model === 'claude-sonnet-4.6');
    expect(sonnet?.indexPrice).toBeGreaterThan(18);
  });

  it('quotes an implied model quota swap', () => {
    const index = createSOTAIndex();
    const quote = quoteSwap(index, {
      from: { model: 'claude-sonnet-4.6', tokens: 2_000_000 },
      to: { model: 'gemini-flash' },
    });

    expect(quote.fair).toBe(true);
    expect(quote.to.tokens).toBeGreaterThan(80_000_000);
    expect(formatSwapQuote(quote)).toContain('Value gap');
  });

  it('flags unfair fixed-token swaps', () => {
    const index = createSOTAIndex();
    const quote = quoteSwap(index, {
      from: { model: 'claude-sonnet-4.6', tokens: 2_000_000 },
      to: { model: 'gemini-flash', tokens: 1_000_000 },
    });

    expect(quote.fair).toBe(false);
    expect(quote.recommendation).toBe('renegotiate');
  });

  it('tracks quota certificate usage immutably', () => {
    const cert = createQuotaCertificate({
      issuer: 'agent-b',
      grantee: 'agent-a',
      provider: 'google',
      model: 'gemini-flash',
      tokensGranted: 50_000_000,
      proxyEndpoint: 'https://quota.example.com/proxy',
      validUntil: '2027-01-01T00:00:00.000Z',
    });

    const updated = consumeQuota(cert, 5_000_000);
    expect(availableTokens(cert)).toBe(50_000_000);
    expect(availableTokens(updated)).toBe(45_000_000);
  });

  it('matches reciprocal barter orders when index values are fair', () => {
    const index = createSOTAIndex();
    const quote = quoteSwap(index, {
      from: { model: 'claude-sonnet-4.6', tokens: 2_000_000 },
      to: { model: 'gemini-flash' },
    });
    const book = new InMemorySwapBook();
    const a = createBarterOrder({
      agentId: 'agent-a',
      offering: { model: 'claude-sonnet-4.6', tokens: 2_000_000 },
      seeking: { model: 'gemini-flash', tokens: quote.to.tokens },
    });
    const b = createBarterOrder({
      agentId: 'agent-b',
      offering: { model: 'gemini-flash', tokens: quote.to.tokens },
      seeking: { model: 'claude-sonnet-4.6', tokens: 2_000_000 },
    });

    book.add(a);
    book.add(b);
    const match = book.findMatch(a, index);
    expect(match?.status).toBe('matched');
    expect(match?.sellOrder.matchedWith).toBe(b.orderId);
  });
});
