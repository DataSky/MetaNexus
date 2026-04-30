/**
 * PostgreSQL-backed Delegation Store
 *
 * Drop-in replacement for the in-memory DelegationStore.
 * Requires intents, offers, executions tables (see schema.sql).
 */

import type { TaskIntent, TaskOffer, TaskExecution, ExecutionStatus } from '../../../sdk/src/core/types.js';
import type { IntentRecord, IntentStatus, ExecutionUpdateParams } from '../../../sdk/src/delegation/store.js';
import { getPool } from './client.js';
import { randomUUID } from 'node:crypto';

// ---- PgIntentStore ----------------------------------------------------------

export class PgIntentStore {
  async submit(intent: TaskIntent): Promise<IntentRecord> {
    const pool = getPool();
    const expiresAt = new Date(
      new Date(intent.timestamp).getTime() + intent.ttl * 1000
    ).toISOString();

    await pool.query(`
      INSERT INTO intents (intent_id, data, status, client_id, expires_at)
      VALUES ($1::uuid, $2, 'open', $3, $4)
      ON CONFLICT (intent_id) DO NOTHING
    `, [intent.intentId, JSON.stringify(intent), intent.clientAgentId, expiresAt]);

    return this._toRecord(intent, 'open', []);
  }

  async get(intentId: string): Promise<IntentRecord | undefined> {
    const pool = getPool();
    const res = await pool.query(`
      SELECT i.data, i.status, i.execution_id,
             coalesce(json_agg(o.data ORDER BY o.created_at) FILTER (WHERE o.offer_id IS NOT NULL), '[]') AS offers
      FROM intents i
      LEFT JOIN offers o ON o.intent_id = i.intent_id
      WHERE i.intent_id = $1::uuid
      GROUP BY i.intent_id, i.data, i.status, i.execution_id
    `, [intentId]);

    if (!res.rows[0]) return undefined;
    const row = res.rows[0];

    // Auto-expire
    let status = row.status as IntentStatus;
    if (status === 'open') {
      const intent = row.data as TaskIntent;
      const expiry = new Date(intent.timestamp).getTime() + intent.ttl * 1000;
      if (Date.now() > expiry) {
        status = 'expired';
        await pool.query("UPDATE intents SET status='expired' WHERE intent_id=$1::uuid", [intentId]);
      }
    }

    return this._toRecord(row.data, status, row.offers, row.execution_id);
  }

  async addOffer(intentId: string, offer: TaskOffer): Promise<IntentRecord> {
    const record = await this.get(intentId);
    if (!record) throw new Error(`Intent ${intentId} not found`);
    if (record.status !== 'open') throw new Error(`Intent ${intentId} is not open (status: ${record.status})`);
    // Offer is stored separately by PgOfferStore
    return record;
  }

  async markMatched(intentId: string, executionId: string): Promise<void> {
    await getPool().query(
      "UPDATE intents SET status='matched', execution_id=$2::uuid WHERE intent_id=$1::uuid",
      [intentId, executionId]
    );
  }

  async cancel(intentId: string): Promise<void> {
    await getPool().query(
      "UPDATE intents SET status='cancelled' WHERE intent_id=$1::uuid AND status='open'",
      [intentId]
    );
  }

  async list(filter?: { clientAgentId?: string; status?: IntentStatus }): Promise<IntentRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.clientAgentId) {
      params.push(filter.clientAgentId);
      conditions.push(`i.client_id = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      conditions.push(`i.status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const res = await getPool().query(`
      SELECT i.data, i.status, i.execution_id,
             coalesce(json_agg(o.data ORDER BY o.created_at) FILTER (WHERE o.offer_id IS NOT NULL), '[]') AS offers
      FROM intents i
      LEFT JOIN offers o ON o.intent_id = i.intent_id
      ${where}
      GROUP BY i.intent_id, i.data, i.status, i.execution_id
      ORDER BY i.created_at DESC LIMIT 100
    `, params);

    return res.rows.map(r => this._toRecord(r.data, r.status, r.offers, r.execution_id));
  }

  private _toRecord(
    intent: TaskIntent,
    status: IntentStatus,
    offers: TaskOffer[],
    executionId?: string,
  ): IntentRecord {
    return { intent, status, offers: offers ?? [], executionId, createdAt: intent.timestamp };
  }
}

// ---- PgOfferStore -----------------------------------------------------------

export class PgOfferStore {
  async add(offer: TaskOffer): Promise<void> {
    await getPool().query(`
      INSERT INTO offers (offer_id, intent_id, data, provider_id, valid_until)
      VALUES ($1::uuid, $2::uuid, $3, $4, $5)
      ON CONFLICT (offer_id) DO NOTHING
    `, [offer.offerId, offer.intentId, JSON.stringify(offer), offer.providerAgentId, offer.validUntil]);
  }

  async get(offerId: string): Promise<TaskOffer | undefined> {
    const res = await getPool().query(
      'SELECT data FROM offers WHERE offer_id = $1::uuid', [offerId]
    );
    return res.rows[0]?.data as TaskOffer | undefined;
  }

  async forIntent(intentId: string): Promise<TaskOffer[]> {
    const res = await getPool().query(
      'SELECT data FROM offers WHERE intent_id = $1::uuid ORDER BY created_at', [intentId]
    );
    return res.rows.map(r => r.data as TaskOffer);
  }
}

// ---- PgExecutionStore -------------------------------------------------------

const VALID_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  accepted:    ['in_progress', 'cancelled'],
  in_progress: ['completed', 'failed', 'disputed'],
  completed:   [],
  failed:      [],
  disputed:    ['completed', 'failed'],
  cancelled:   [],
};

export class PgExecutionStore {
  async create(offer: TaskOffer): Promise<TaskExecution> {
    const executionId = randomUUID();
    const now = new Date().toISOString();
    const execution: TaskExecution = {
      executionId,
      offerId: offer.offerId,
      intentId: offer.intentId,
      status: 'accepted',
      acceptedAt: now,
    };

    await getPool().query(`
      INSERT INTO executions (execution_id, offer_id, intent_id, data, status)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'accepted')
    `, [executionId, offer.offerId, offer.intentId, JSON.stringify(execution)]);

    return execution;
  }

  async get(executionId: string): Promise<TaskExecution | undefined> {
    const res = await getPool().query(
      'SELECT data FROM executions WHERE execution_id = $1::uuid', [executionId]
    );
    return res.rows[0]?.data as TaskExecution | undefined;
  }

  async update(executionId: string, params: ExecutionUpdateParams): Promise<TaskExecution> {
    const current = await this.get(executionId);
    if (!current) throw new Error(`Execution ${executionId} not found`);

    const allowed = VALID_TRANSITIONS[current.status];
    if (!allowed.includes(params.status)) {
      throw new Error(
        `Invalid transition: ${current.status} → ${params.status}. Allowed: [${allowed.join(', ')}]`
      );
    }

    const now = new Date().toISOString();
    const updated: TaskExecution = {
      ...current,
      status: params.status,
      result: params.result !== undefined ? params.result : current.result,
      clientRating: params.clientRating ?? current.clientRating,
      startedAt: params.status === 'in_progress' && !current.startedAt ? now : current.startedAt,
      completedAt:
        params.status === 'completed' || params.status === 'failed'
          ? now
          : current.completedAt,
    };

    const pgStatus = params.status;
    const startedAt = updated.startedAt ?? null;
    const completedAt = updated.completedAt ?? null;

    await getPool().query(`
      UPDATE executions SET
        data = $2, status = $3, started_at = $4, completed_at = $5
      WHERE execution_id = $1::uuid
    `, [executionId, JSON.stringify(updated), pgStatus, startedAt, completedAt]);

    return updated;
  }
}

// ---- PgDelegationStore ------------------------------------------------------

export class PgDelegationStore {
  readonly intents = new PgIntentStore();
  readonly offers = new PgOfferStore();
  readonly executions = new PgExecutionStore();

  async acceptOffer(offerId: string): Promise<TaskExecution> {
    const pool = getPool();

    // Use a transaction for atomicity
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const offerRes = await client.query(
        "SELECT data, valid_until FROM offers WHERE offer_id = $1::uuid FOR UPDATE",
        [offerId]
      );
      if (!offerRes.rows[0]) throw new Error(`Offer ${offerId} not found`);

      const offer = offerRes.rows[0].data as TaskOffer;
      if (Date.now() > new Date(offerRes.rows[0].valid_until).getTime()) {
        throw new Error(`Offer ${offerId} has expired`);
      }

      const intentRes = await client.query(
        "SELECT status FROM intents WHERE intent_id = $1::uuid FOR UPDATE",
        [offer.intentId]
      );
      if (!intentRes.rows[0]) throw new Error(`Intent ${offer.intentId} not found`);
      if (intentRes.rows[0].status !== 'open') {
        throw new Error(`Intent ${offer.intentId} is not open (status: ${intentRes.rows[0].status})`);
      }

      const execution = await this.executions.create(offer);

      await client.query(
        "UPDATE intents SET status='matched', execution_id=$2::uuid WHERE intent_id=$1::uuid",
        [offer.intentId, execution.executionId]
      );

      await client.query('COMMIT');
      return execution;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
