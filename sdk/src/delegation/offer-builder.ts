/**
 * OfferBuilder — creates signed TaskOffers in response to a TaskIntent
 *
 * A TaskOffer is a provider agent's proposal to execute a task.
 * It references the original TaskIntent and includes pricing, SLA, and validity.
 *
 * Usage:
 *   const builder = new OfferBuilder({ agentId: 'https://provider.example.com', keyPair });
 *   const offer = builder.build({
 *     intent,
 *     proposal: { description: 'Will translate 5000 words in 2 hours', estimatedDuration: 7200 },
 *     pricing: { amount: 0.3, asset: 'usdc' },
 *     validForSeconds: 120,
 *   });
 */

import { randomUUID } from 'node:crypto';
import { sign, generateNonce } from '../core/crypto.js';
import type { TaskOffer, TaskIntent, BarterOffer, SLACommitment, PriceBreakdown } from '../core/types.js';

export interface OfferParams {
  intent: TaskIntent;
  proposal: {
    description: string;
    estimatedDuration?: number;   // seconds
    qualityGuarantee?: string;
  };
  pricing: {
    amount: number;
    asset: string;
    breakdown?: PriceBreakdown[];
  };
  barterRequest?: BarterOffer;
  slaCommitment?: SLACommitment;
  /** How long this offer is valid for, in seconds. Default: 120 */
  validForSeconds?: number;
}

export interface OfferBuilderConfig {
  /** The provider agent's ID (URL) */
  agentId: string;
  /** ed25519 secret key for signing */
  secretKey: Uint8Array;
}

export class OfferBuilder {
  constructor(private readonly config: OfferBuilderConfig) {}

  build(params: OfferParams): TaskOffer {
    const validForSeconds = params.validForSeconds ?? 120;
    const validUntil = new Date(Date.now() + validForSeconds * 1000).toISOString();
    const now = new Date().toISOString();

    const offer: Omit<TaskOffer, 'signature'> = {
      offerId: randomUUID(),
      intentId: params.intent.intentId,
      providerAgentId: this.config.agentId,
      proposal: params.proposal,
      pricing: params.pricing,
      barterRequest: params.barterRequest,
      slaCommitment: params.slaCommitment,
      validUntil,
      nonce: generateNonce(),
      timestamp: now,
    };

    const signature = sign(offer as Record<string, unknown>, this.config.secretKey);
    return { ...offer, signature };
  }

  /** Check if an offer is still valid */
  static isValid(offer: TaskOffer): boolean {
    return Date.now() < new Date(offer.validUntil).getTime();
  }
}
