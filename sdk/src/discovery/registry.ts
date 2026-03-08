/**
 * In-memory Agent Registry
 *
 * Phase 1 storage: Map<agentId, UniversalAgentCard>
 * Phase 2+: replace with PostgreSQL + pgvector
 */

import type { UniversalAgentCard, SearchQuery, SearchResult } from '../core/types.js';

export class AgentRegistry {
  private readonly agents = new Map<string, UniversalAgentCard>();

  register(card: UniversalAgentCard): void {
    this.agents.set(card.id, card);
  }

  get(id: string): UniversalAgentCard | undefined {
    return this.agents.get(id);
  }

  delete(id: string): boolean {
    return this.agents.delete(id);
  }

  list(): UniversalAgentCard[] {
    return Array.from(this.agents.values());
  }

  get size(): number {
    return this.agents.size;
  }

  /**
   * Text-based search (Phase 1 fallback before pgvector).
   * Scores by keyword overlap in name + description + capability names + tags.
   */
  search(query: SearchQuery): SearchResult[] {
    const terms = query.query.toLowerCase().split(/\s+/).filter(Boolean);
    const filters = query.filters ?? {};

    return Array.from(this.agents.values())
      .map(agent => {
        // Collect searchable text tokens
        const haystack = [
          agent.name,
          agent.description,
          ...agent.capabilities.map(c => `${c.name} ${c.description}`),
          ...(agent.tags ?? []),
        ]
          .join(' ')
          .toLowerCase();

        const matchCount = terms.filter(t => haystack.includes(t)).length;
        const relevanceScore = terms.length > 0 ? matchCount / terms.length : 0;
        const trustScore = agent.trust?.score ?? 0;

        return {
          agent,
          relevanceScore,
          trustScore,
          capabilityMatch: relevanceScore,
          overallScore: relevanceScore * 0.7 + trustScore * 0.3,
        } satisfies SearchResult;
      })
      .filter(r => {
        if (r.relevanceScore === 0) return false;
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
}
