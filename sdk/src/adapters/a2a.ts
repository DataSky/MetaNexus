/**
 * A2A Protocol Adapter
 *
 * Fetches and normalizes Google A2A AgentCards from /.well-known/agent.json
 * Spec: https://google.github.io/A2A/
 */

import type {
  ProtocolAdapter,
  DetectionResult,
  RawAgentData,
  UniversalAgentCard,
  Capability,
  ProtocolSupport,
} from '../core/types.js';

// ---- A2A types (per A2A spec) ------------------------------------------------

interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version?: string;
  skills?: A2ASkill[];
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  provider?: { organization: string; url?: string };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  authentication?: { schemes: string[] };
  iconUrl?: string;
  documentationUrl?: string;
}

// ---- Helpers -----------------------------------------------------------------

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function skillToCapability(skill: A2ASkill): Capability {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    inputSchema: skill.inputSchema,
    outputSchema: skill.outputSchema,
  };
}

// ---- Adapter -----------------------------------------------------------------

export class A2AAdapter implements ProtocolAdapter {
  readonly protocol = 'a2a';
  readonly version = '0.2';

  async detect(url: string): Promise<DetectionResult> {
    const cardUrl = agentJsonUrl(url);
    try {
      const res = await fetch(cardUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { detected: false, confidence: 0 };

      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data['name'] === 'string' && typeof data['url'] === 'string') {
        return { detected: true, confidence: 0.9, protocol: 'a2a' };
      }
      return { detected: false, confidence: 0.1 };
    } catch {
      return { detected: false, confidence: 0 };
    }
  }

  async fetch(url: string): Promise<RawAgentData> {
    const cardUrl = agentJsonUrl(url);
    const res = await fetch(cardUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      throw new Error(`A2A fetch failed (${res.status}): ${cardUrl}`);
    }
    return {
      protocol: 'a2a',
      data: await res.json(),
      sourceUrl: cardUrl,
      fetchedAt: new Date().toISOString(),
    };
  }

  normalize(raw: RawAgentData): UniversalAgentCard {
    const card = raw.data as A2AAgentCard;
    const domain = extractDomain(card.url ?? raw.sourceUrl);
    const now = new Date().toISOString();

    const capabilities: Capability[] = (card.skills ?? []).map(skillToCapability);
    if (capabilities.length === 0) {
      capabilities.push({ id: 'default', name: card.name, description: card.description });
    }

    const protocols: ProtocolSupport[] = [
      { protocol: 'a2a', version: card.version ?? '0.2', endpoint: card.url, manifest: raw.sourceUrl },
    ];

    const tags = Array.from(new Set((card.skills ?? []).flatMap(s => s.tags ?? [])));

    return {
      id: `a2a:${domain}`,
      name: card.name,
      description: card.description,
      version: card.version ?? '1.0.0',
      capabilities,
      protocols,
      endpoint: card.url,
      publicKey: '',   // A2A cards have no ed25519 key — externally imported
      domain,
      tags: tags.length > 0 ? tags : undefined,
      created: now,
      updated: now,
      signature: '',   // unsigned external import
    };
  }
}

function agentJsonUrl(base: string): string {
  return `${base.replace(/\/$/, '')}/.well-known/agent.json`;
}
