/**
 * PostgreSQL-backed Agent Registry
 *
 * Drop-in replacement for the in-memory AgentRegistry.
 * Requires agents table + pgvector extension (see schema.sql).
 *
 * Semantic search:
 *   - When embedding is stored (via DMXAPI), uses pgvector cosine similarity
 *   - Falls back to full-text search when no embeddings exist
 */

import type { UniversalAgentCard, SearchQuery, SearchResult } from '../../../sdk/src/core/types.js';
import { getEmbedding, cardToText, cosine } from '../../../sdk/src/discovery/embeddings.js';
import { getPool } from './client.js';

export class PgAgentRegistry {
  /**
   * Register (upsert) an agent card.
   * Triggers async embedding computation if DMXAPI_KEY is set.
   */
  async register(card: UniversalAgentCard): Promise<void> {
    const pool = getPool();
    const protocols = card.protocols.map(p => p.protocol);
    const tags = card.tags ?? [];

    await pool.query(`
      INSERT INTO agents (id, data, domain, name, description, protocols, tags, trust_score, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      ON CONFLICT (id) DO UPDATE SET
        data        = EXCLUDED.data,
        domain      = EXCLUDED.domain,
        name        = EXCLUDED.name,
        description = EXCLUDED.description,
        protocols   = EXCLUDED.protocols,
        tags        = EXCLUDED.tags,
        trust_score = EXCLUDED.trust_score,
        updated_at  = now()
    `, [
      card.id,
      JSON.stringify(card),
      card.domain,
      card.name,
      card.description,
      protocols,
      tags,
      card.trust?.score ?? 0,
    ]);

    // Fire-and-forget embedding
    this._computeAndStoreEmbedding(card).catch(() => {});
  }

  private async _computeAndStoreEmbedding(card: UniversalAgentCard): Promise<void> {
    const vec = await getEmbedding(cardToText(card));
    if (!vec) return;

    await getPool().query(
      'UPDATE agents SET embedding = $1 WHERE id = $2',
      [`[${vec.join(',')}]`, card.id]
    );
  }

  async get(id: string): Promise<UniversalAgentCard | undefined> {
    const pool = getPool();
    const res = await pool.query('SELECT data FROM agents WHERE id = $1', [id]);
    return res.rows[0]?.data as UniversalAgentCard | undefined;
  }

  async delete(id: string): Promise<boolean> {
    const pool = getPool();
    const res = await pool.query('DELETE FROM agents WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async list(limit = 100, offset = 0): Promise<UniversalAgentCard[]> {
    const pool = getPool();
    const res = await pool.query(
      'SELECT data FROM agents ORDER BY registered_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return res.rows.map(r => r.data as UniversalAgentCard);
  }

  async count(): Promise<number> {
    const pool = getPool();
    const res = await pool.query('SELECT COUNT(*)::int AS n FROM agents');
    return res.rows[0].n as number;
  }

  /**
   * Semantic + keyword search.
   * Uses pgvector cosine similarity when query embedding is available,
   * falls back to PostgreSQL full-text search otherwise.
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    const pool = getPool();
    const filters = query.filters ?? {};
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    // Try semantic search
    const queryEmbedding = await getEmbedding(query.query);
    if (queryEmbedding) {
      return this._semanticSearch(queryEmbedding, query, limit, offset);
    }

    // Keyword fallback: use PostgreSQL ILIKE
    const terms = query.query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const likeClause = terms.map((_, i) =>
      `(name ILIKE $${i + 1} OR description ILIKE $${i + 1})`
    ).join(' OR ');

    const params: unknown[] = terms.map(t => `%${t}%`);
    params.push(limit, offset);

    const res = await pool.query(
      `SELECT data, trust_score FROM agents WHERE ${likeClause}
       ORDER BY trust_score DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.rows.map(row => {
      const agent = row.data as UniversalAgentCard;
      const relevanceScore = 0.5;
      const trustScore = row.trust_score as number;
      return {
        agent,
        relevanceScore,
        trustScore,
        capabilityMatch: relevanceScore,
        overallScore: relevanceScore * 0.7 + trustScore * 0.3,
      } satisfies SearchResult;
    });
  }

  private async _semanticSearch(
    queryEmbedding: number[],
    query: SearchQuery,
    limit: number,
    offset: number,
  ): Promise<SearchResult[]> {
    const pool = getPool();
    const filters = query.filters ?? {};
    const minSim = filters.minSimilarity ?? 0.1;
    const vec = `[${queryEmbedding.join(',')}]`;

    // Build optional WHERE clauses
    const conditions: string[] = ['embedding IS NOT NULL'];
    const params: unknown[] = [vec, limit, offset];

    if (filters.minTrustScore) {
      params.push(filters.minTrustScore);
      conditions.push(`trust_score >= $${params.length}`);
    }
    if (filters.protocols?.length) {
      params.push(filters.protocols);
      conditions.push(`protocols && $${params.length}::text[]`);
    }
    if (filters.tags?.length) {
      params.push(filters.tags);
      conditions.push(`tags && $${params.length}::text[]`);
    }

    const where = conditions.join(' AND ');

    const res = await pool.query(`
      SELECT data, trust_score,
             1 - (embedding <=> $1::vector) AS similarity
      FROM agents
      WHERE ${where}
        AND 1 - (embedding <=> $1::vector) >= ${minSim}
      ORDER BY similarity DESC
      LIMIT $2 OFFSET $3
    `, params);

    return res.rows.map(row => {
      const agent = row.data as UniversalAgentCard;
      const relevanceScore = row.similarity as number;
      const trustScore = row.trust_score as number;
      return {
        agent,
        relevanceScore,
        trustScore,
        capabilityMatch: relevanceScore,
        overallScore: relevanceScore * 0.7 + trustScore * 0.3,
      } satisfies SearchResult;
    });
  }
}
