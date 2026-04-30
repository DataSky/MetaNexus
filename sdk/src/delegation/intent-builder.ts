/**
 * IntentBuilder — creates signed TaskIntents
 *
 * A TaskIntent is a client agent's request to find a provider who can
 * complete a task. It is broadcast to matching agents in the registry.
 *
 * Usage:
 *   const builder = new IntentBuilder({ agentId: 'https://client.example.com', keyPair });
 *   const intent = builder.build({
 *     type: 'task',
 *     task: { description: 'Translate this document to Chinese' },
 *     budget: { maxAmount: 0.5, currency: 'usdc' },
 *     ttl: 300,
 *   });
 */

import { randomUUID } from 'node:crypto';
import { sign, generateNonce } from '../core/crypto.js';
import type { TaskIntent, IntentType, AssetType, TaskConstraints, BarterOffer } from '../core/types.js';

export interface IntentParams {
  type: IntentType;
  task: {
    description: string;
    capabilityRequired?: string;
    input?: unknown;
    constraints?: TaskConstraints;
  };
  budget?: {
    maxAmount?: number;
    currency?: string;
    acceptedAssets?: AssetType[];
    barterOffer?: BarterOffer;
  };
  /** TTL in seconds. Default: 300 (5 minutes) */
  ttl?: number;
  deadline?: string;
}

export interface IntentBuilderConfig {
  /** The client agent's ID (URL) */
  agentId: string;
  /** ed25519 secret key for signing */
  secretKey: Uint8Array;
}

export class IntentBuilder {
  constructor(private readonly config: IntentBuilderConfig) {}

  build(params: IntentParams): TaskIntent {
    const now = new Date().toISOString();
    const intent: Omit<TaskIntent, 'signature'> = {
      intentId: randomUUID(),
      clientAgentId: this.config.agentId,
      type: params.type,
      task: params.task,
      budget: params.budget,
      ttl: params.ttl ?? 300,
      deadline: params.deadline,
      nonce: generateNonce(),
      timestamp: now,
    };

    const signature = sign(intent as Record<string, unknown>, this.config.secretKey);
    return { ...intent, signature };
  }

  /** Check if an intent has expired based on its timestamp + ttl */
  static isExpired(intent: TaskIntent): boolean {
    const created = new Date(intent.timestamp).getTime();
    return Date.now() > created + intent.ttl * 1000;
  }
}
