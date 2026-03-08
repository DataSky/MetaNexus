/**
 * Delegation Store — in-memory state machine for TaskIntent/Offer/Execution
 *
 * Phase 1: Map-based in-memory storage
 * Phase 2+: replace with PostgreSQL
 *
 * State machine:
 *
 *   Intent:    open ──(expired)──► expired
 *                └──(offer accepted)──► matched
 *
 *   Execution: accepted ──► in_progress ──► completed
 *                                       └──► failed
 *                                       └──► disputed
 *              (any) ──► cancelled
 */

import { randomUUID } from 'node:crypto';
import type { TaskIntent, TaskOffer, TaskExecution, ExecutionStatus } from '../core/types.js';
import { IntentBuilder } from './intent-builder.js';

// ---- Intent Store -----------------------------------------------------------

export type IntentStatus = 'open' | 'matched' | 'expired' | 'cancelled';

export interface IntentRecord {
  intent: TaskIntent;
  status: IntentStatus;
  offers: TaskOffer[];
  executionId?: string;
  createdAt: string;
}

export class IntentStore {
  private readonly intents = new Map<string, IntentRecord>();

  submit(intent: TaskIntent): IntentRecord {
    const record: IntentRecord = {
      intent,
      status: 'open',
      offers: [],
      createdAt: new Date().toISOString(),
    };
    this.intents.set(intent.intentId, record);
    return record;
  }

  get(intentId: string): IntentRecord | undefined {
    const record = this.intents.get(intentId);
    if (!record) return undefined;

    // Lazily mark expired intents
    if (record.status === 'open' && IntentBuilder.isExpired(record.intent)) {
      record.status = 'expired';
    }
    return record;
  }

  addOffer(intentId: string, offer: TaskOffer): IntentRecord {
    const record = this.get(intentId);
    if (!record) throw new Error(`Intent ${intentId} not found`);
    if (record.status !== 'open') throw new Error(`Intent ${intentId} is not open (status: ${record.status})`);
    record.offers.push(offer);
    return record;
  }

  markMatched(intentId: string, executionId: string): void {
    const record = this.intents.get(intentId);
    if (record) {
      record.status = 'matched';
      record.executionId = executionId;
    }
  }

  cancel(intentId: string): void {
    const record = this.intents.get(intentId);
    if (record && record.status === 'open') {
      record.status = 'cancelled';
    }
  }

  list(filter?: { clientAgentId?: string; status?: IntentStatus }): IntentRecord[] {
    return Array.from(this.intents.values()).filter(r => {
      if (filter?.clientAgentId && r.intent.clientAgentId !== filter.clientAgentId) return false;
      if (filter?.status && r.status !== filter.status) return false;
      return true;
    });
  }

  get size(): number { return this.intents.size; }
}

// ---- Offer Store ------------------------------------------------------------

export class OfferStore {
  private readonly offers = new Map<string, TaskOffer>();

  add(offer: TaskOffer): void {
    this.offers.set(offer.offerId, offer);
  }

  get(offerId: string): TaskOffer | undefined {
    return this.offers.get(offerId);
  }

  forIntent(intentId: string): TaskOffer[] {
    return Array.from(this.offers.values()).filter(o => o.intentId === intentId);
  }
}

// ---- Execution Store --------------------------------------------------------

/** Valid status transitions */
const VALID_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  accepted:    ['in_progress', 'cancelled'],
  in_progress: ['completed', 'failed', 'disputed'],
  completed:   [],
  failed:      [],
  disputed:    ['completed', 'failed'],
  cancelled:   [],
};

export interface ExecutionUpdateParams {
  status: ExecutionStatus;
  result?: unknown;
  clientRating?: number;
}

export class ExecutionStore {
  private readonly executions = new Map<string, TaskExecution>();

  create(offer: TaskOffer): TaskExecution {
    const execution: TaskExecution = {
      executionId: randomUUID(),
      offerId: offer.offerId,
      intentId: offer.intentId,
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
    };
    this.executions.set(execution.executionId, execution);
    return execution;
  }

  get(executionId: string): TaskExecution | undefined {
    return this.executions.get(executionId);
  }

  update(executionId: string, params: ExecutionUpdateParams): TaskExecution {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution ${executionId} not found`);

    const allowed = VALID_TRANSITIONS[execution.status];
    if (!allowed.includes(params.status)) {
      throw new Error(
        `Invalid transition: ${execution.status} → ${params.status}. Allowed: [${allowed.join(', ')}]`
      );
    }

    execution.status = params.status;
    if (params.result !== undefined) execution.result = params.result;
    if (params.clientRating !== undefined) execution.clientRating = params.clientRating;

    const now = new Date().toISOString();
    if (params.status === 'in_progress' && !execution.startedAt) execution.startedAt = now;
    if (params.status === 'completed' || params.status === 'failed') execution.completedAt = now;

    return execution;
  }

  forIntent(intentId: string): TaskExecution[] {
    return Array.from(this.executions.values()).filter(e => e.intentId === intentId);
  }

  get size(): number { return this.executions.size; }
}

// ---- Combined DelegationStore -----------------------------------------------

/**
 * Unified store that wires intent + offer + execution together.
 * Use this in the server to ensure consistent state.
 */
export class DelegationStore {
  readonly intents = new IntentStore();
  readonly offers = new OfferStore();
  readonly executions = new ExecutionStore();

  /**
   * Accept an offer: validates the offer is still valid, creates an execution,
   * marks the intent as matched, and returns the execution.
   */
  acceptOffer(offerId: string): TaskExecution {
    const offer = this.offers.get(offerId);
    if (!offer) throw new Error(`Offer ${offerId} not found`);

    // Check offer validity
    const now = Date.now();
    if (now > new Date(offer.validUntil).getTime()) {
      throw new Error(`Offer ${offerId} has expired`);
    }

    // Check intent is still open
    const intentRecord = this.intents.get(offer.intentId);
    if (!intentRecord) throw new Error(`Intent ${offer.intentId} not found`);
    if (intentRecord.status !== 'open') {
      throw new Error(`Intent ${offer.intentId} is not open (status: ${intentRecord.status})`);
    }

    // Create execution and update intent
    const execution = this.executions.create(offer);
    this.intents.markMatched(offer.intentId, execution.executionId);

    return execution;
  }
}
