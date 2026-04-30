/**
 * In-memory Agent Registry
 *
 * Phase 1: Map<agentId, card> + keyword search + optional semantic search
 * Phase 2+: replace with PostgreSQL + pgvector
 *
 * Semantic search is best-effort: when DMXAPI_KEY is set, register()
 * computes an embedding async and stores it. search() uses cosine
 * similarity when embeddings are available, falls back to keyword otherwise.
 */

import type { UniversalAgentCard, SearchQuery, SearchResult } from '../core/types.js';
import { getEmbedding, cardToText, cosine } from './embeddings.js';

interface AgentEntry {
  card: UniversalAgentCard;
  embedding: number[] | null;  // null = not yet computed / DMXAPI unavailable
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentEntry>();

  /**
   * Register (or update) an agent.
   * Triggers async embedding generation in the background — never blocks.
   */
  register(card: UniversalAgentCard): void {
    const existing = this.agents.get(card.id);
    // Preserve existing embedding on re-registration (avoid wiping while computing)
    const entry: AgentEntry = { card, embedding: existing?.embedding ?? null };
    this.agents.set(card.id, entry);

    // Fire-and-forget embedding computation
    this._computeEmbedding(card.id, card).catch(() => { /* best-effort */ });
  }

  private async _computeEmbedding(id: string, card: UniversalAgentCard): Promise<void> {
    const text = cardToText(card);
    const vec = await getEmbedding(text);
    if (!vec) return;

    const entry = this.agents.get(id);
    if (entry) entry.embedding = vec;
  }

  get(id: string): UniversalAgentCard | undefined {
    return this.agents.get(id)?.card;
  }

  delete(id: string): boolean {
    return this.agents.delete(id);
  }

  list(limit = 1000, offset = 0): UniversalAgentCard[] {
    return Array.from(this.agents.values()).map(e => e.card).slice(offset, offset + limit);
  }

  count(): number {
    return this.agents.size;
  }

  get size(): number {
    return this.agents.size;
  }

  /**
   * Semantic + keyword search.
   * Auto-computes query embedding when DMXAPI_KEY is set.
   * Falls back to keyword overlap when no embedding available.
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    const queryEmbedding = await getEmbedding(query.query);
    return this._searchSync(query, queryEmbedding);
  }

  /** Synchronous keyword search (used internally + in tests via mock) */
  _searchSync(query: SearchQuery, queryEmbedding?: number[] | null): SearchResult[] {
    const terms = query.query.toLowerCase().split(/\s+/).filter(Boolean);
    const filters = query.filters ?? {};
    // Semantic mode needs a higher minimum to filter noise from embedding space.
    // Normalized cosine 0.55 ≈ raw cosine 0.1 (weakly similar).
    const minSim = filters.minSimilarity ?? (queryEmbedding ? 0.55 : 0);

    const results = Array.from(this.agents.values()).map(({ card: agent, embedding }) => {
      let relevanceScore: number;

      if (queryEmbedding && embedding) {
        // Semantic similarity in [0, 1] (cosine → normalize from [-1,1])
        relevanceScore = (cosine(queryEmbedding, embedding) + 1) / 2;
      } else {
        // Keyword fallback
        const haystack = [
          agent.name,
          agent.description,
          ...agent.capabilities.map(c => `${c.name} ${c.description}`),
          ...(agent.tags ?? []),
        ].join(' ').toLowerCase();

        const matchCount = terms.filter(t => haystack.includes(t)).length;
        relevanceScore = terms.length > 0 ? matchCount / terms.length : 0;
      }

      const trustScore = agent.trust?.score ?? 0;

      return {
        agent,
        relevanceScore,
        trustScore,
        capabilityMatch: relevanceScore,
        overallScore: relevanceScore * 0.7 + trustScore * 0.3,
      } satisfies SearchResult;
    });

    return results
      .filter(r => {
        if (r.relevanceScore <= minSim) return false;
        if (filters.minTrustScore && r.trustScore < filters.minTrustScore) return false;
        if (filters.protocols?.length) {
          const agentProtocols = r.agent.protocols.map(p => p.protocol);
          if (!filters.protocols.some(p => agentProtocols.includes(p as never))) return false;
        }
        if (filters.tags?.length) {
          const agentTags = r.agent.tags ?? [];
          if (!filters.tags.some(t => agentTags.includes(t))) return false;
        }
        return true;
      })
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 20));
  }

  /**
   * Inject an externally computed embedding (e.g. from /v1/search route
   * after embedding the query server-side).
   */
  setEmbedding(agentId: string, embedding: number[]): void {
    const entry = this.agents.get(agentId);
    if (entry) entry.embedding = embedding;
  }
}
