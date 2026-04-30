/**
 * Storage interfaces — abstract over in-memory and PostgreSQL implementations.
 * The app.ts uses these interfaces so it works with both backends.
 */

import type { UniversalAgentCard, SearchQuery, SearchResult } from '../../../sdk/src/core/types.js';
import type { TaskIntent, TaskOffer, TaskExecution, ExecutionStatus } from '../../../sdk/src/core/types.js';
import type { IntentRecord, IntentStatus, ExecutionUpdateParams } from '../../../sdk/src/delegation/store.js';

// ---- Agent storage ----------------------------------------------------------

export interface IAgentStore {
  register(card: UniversalAgentCard): Promise<void> | void;
  get(id: string): Promise<UniversalAgentCard | undefined> | UniversalAgentCard | undefined;
  delete(id: string): Promise<boolean> | boolean;
  list(limit?: number, offset?: number): Promise<UniversalAgentCard[]> | UniversalAgentCard[];
  count?(): Promise<number> | number;
  search(query: SearchQuery): Promise<SearchResult[]> | SearchResult[];
}

// ---- Delegation storage -----------------------------------------------------

export interface IIntentStore {
  submit(intent: TaskIntent): Promise<IntentRecord> | IntentRecord;
  get(intentId: string): Promise<IntentRecord | undefined> | IntentRecord | undefined;
  addOffer(intentId: string, offer: TaskOffer): Promise<IntentRecord> | IntentRecord;
  markMatched(intentId: string, executionId: string): Promise<void> | void;
  cancel(intentId: string): Promise<void> | void;
  list(filter?: { clientAgentId?: string; status?: IntentStatus }): Promise<IntentRecord[]> | IntentRecord[];
}

export interface IOfferStore {
  add(offer: TaskOffer): Promise<void> | void;
  get(offerId: string): Promise<TaskOffer | undefined> | TaskOffer | undefined;
  forIntent(intentId: string): Promise<TaskOffer[]> | TaskOffer[];
}

export interface IExecutionStore {
  create(offer: TaskOffer): Promise<TaskExecution> | TaskExecution;
  get(executionId: string): Promise<TaskExecution | undefined> | TaskExecution | undefined;
  update(executionId: string, params: ExecutionUpdateParams): Promise<TaskExecution> | TaskExecution;
}

export interface IDelegationStore {
  intents: IIntentStore;
  offers: IOfferStore;
  executions: IExecutionStore;
  acceptOffer(offerId: string): Promise<TaskExecution> | TaskExecution;
}
