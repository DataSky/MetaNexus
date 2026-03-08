/**
 * Embedding service for semantic agent discovery.
 *
 * Uses DMXAPI (OpenAI-compatible) to generate text embeddings,
 * then ranks agents by cosine similarity to the query.
 *
 * Env vars:
 *   DMXAPI_KEY         — API key (required for semantic search)
 *   DMXAPI_BASE_URL    — base URL (default: https://www.dmxapi.cn)
 *   EMBEDDING_MODEL    — model name (default: qwen3-embedding-8b)
 */

import type { UniversalAgentCard } from '../core/types.js';

const BASE_URL = () => process.env['DMXAPI_BASE_URL'] ?? 'https://www.dmxapi.cn';
const MODEL    = () => process.env['EMBEDDING_MODEL']  ?? 'qwen3-embedding-8b';

// ---- API client --------------------------------------------------------------

/**
 * Generate an embedding vector via DMXAPI (OpenAI-compatible /v1/embeddings).
 * Returns null if DMXAPI_KEY is not set or the request fails.
 * Failures are logged but never thrown — embedding is always best-effort.
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  const key = process.env['DMXAPI_KEY'];
  if (!key) return null;

  try {
    const resp = await fetch(`${BASE_URL()}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL(), input: text }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`DMXAPI ${resp.status}: ${body.slice(0, 200)}`);
    }

    const data = await resp.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  } catch (err) {
    console.warn('[embeddings] Failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ---- Text representation ----------------------------------------------------

/**
 * Build searchable text for an agent card.
 * Combines name, description, capability names, and tags.
 */
export function cardToText(card: UniversalAgentCard): string {
  const parts: string[] = [card.name];
  if (card.description) parts.push(card.description);
  const capNames = card.capabilities.map(c => c.name).join(', ');
  if (capNames) parts.push(`Capabilities: ${capNames}`);
  const capDescs = card.capabilities.map(c => c.description).filter(Boolean).join('. ');
  if (capDescs) parts.push(capDescs);
  if (card.tags?.length) parts.push(`Tags: ${card.tags.join(', ')}`);
  return parts.join('. ');
}

// ---- Math -------------------------------------------------------------------

/**
 * Cosine similarity between two vectors. Returns value in [-1, 1].
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
