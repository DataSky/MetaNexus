/**
 * AGENTS.md Adapter
 *
 * Parses AGENTS.md / /.well-known/agents.md — a Markdown file describing
 * an agent's capabilities in human-readable form.
 *
 * Parsing strategy:
 *  - H1 = agent name
 *  - First paragraph after H1 = description
 *  - H2 sections = capabilities (each H2 becomes a Capability)
 *  - Bullet/numbered items under H2 = capability description details
 */

import type {
  ProtocolAdapter,
  DetectionResult,
  RawAgentData,
  UniversalAgentCard,
  Capability,
  ProtocolSupport,
} from '../core/types.js';

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ---- Markdown parser ---------------------------------------------------------

interface ParsedAgentsMd {
  name: string;
  description: string;
  version: string;
  capabilities: Array<{ id: string; name: string; description: string }>;
  tags: string[];
}

export function parseAgentsMd(markdown: string): ParsedAgentsMd {
  const lines = markdown.split('\n');
  let name = '';
  let description = '';
  let version = '1.0.0';
  const capabilities: Array<{ id: string; name: string; description: string }> = [];
  const tags: string[] = [];

  let i = 0;
  let currentSection = '';
  let sectionLines: string[] = [];

  function flushSection() {
    if (!currentSection) return;
    const capDescription = sectionLines
      .filter(l => l.trim())
      .map(l => l.replace(/^[-*\d.]+\s*/, '').trim())
      .filter(Boolean)
      .join(' ');
    const id = currentSection.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    capabilities.push({ id, name: currentSection, description: capDescription || currentSection });
    sectionLines = [];
    currentSection = '';
  }

  for (i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // H1 = agent name
    if (line.startsWith('# ') && !name) {
      name = line.slice(2).trim();
      continue;
    }

    // Version hint (e.g. "version: 1.2.0" or "**version**: 1.2.0")
    const versionMatch = line.match(/version[:\s]+([0-9]+\.[0-9]+\.[0-9]+)/i);
    if (versionMatch) {
      version = versionMatch[1] ?? version;
    }

    // Tags hint (e.g. "tags: foo, bar, baz")
    const tagsMatch = line.match(/^tags?[:\s]+(.+)/i);
    if (tagsMatch) {
      const tagList = tagsMatch[1] ?? '';
      tags.push(...tagList.split(',').map(t => t.trim()).filter(Boolean));
    }

    // First non-empty paragraph after H1 = description
    if (name && !description && !line.startsWith('#') && line.trim()) {
      description = line.trim();
      continue;
    }

    // H2 = new capability section
    if (line.startsWith('## ')) {
      flushSection();
      currentSection = line.slice(3).trim();
      continue;
    }

    // H3 sub-section or lower — ignore heading markers, add as body
    if (line.startsWith('### ') || line.startsWith('#### ')) {
      sectionLines.push(line.replace(/^#+\s*/, ''));
      continue;
    }

    if (currentSection) {
      sectionLines.push(line);
    }
  }

  flushSection();

  // Fallback defaults
  if (!name) name = 'Unknown Agent';
  if (!description) description = 'Agent described via AGENTS.md';

  return { name, description, version, capabilities, tags };
}

// ---- Adapter -----------------------------------------------------------------

export class AgentsMdAdapter implements ProtocolAdapter {
  readonly protocol = 'agentsmd';
  readonly version = '1.0';

  async detect(url: string): Promise<DetectionResult> {
    for (const path of CANDIDATE_PATHS) {
      const mdUrl = `${url.replace(/\/$/, '')}${path}`;
      try {
        const res = await fetch(mdUrl, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;

        const text = await res.text();
        if (text.includes('# ') && text.length > 50) {
          return { detected: true, confidence: 0.7, protocol: 'agentsmd' };
        }
      } catch {
        continue;
      }
    }
    return { detected: false, confidence: 0 };
  }

  async fetch(url: string): Promise<RawAgentData> {
    const base = url.replace(/\/$/, '');
    for (const path of CANDIDATE_PATHS) {
      const mdUrl = `${base}${path}`;
      try {
        const res = await fetch(mdUrl, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) continue;
        const text = await res.text();
        return {
          protocol: 'agentsmd',
          data: { markdown: text, sourceUrl: mdUrl },
          sourceUrl: mdUrl,
          fetchedAt: new Date().toISOString(),
        };
      } catch {
        continue;
      }
    }
    throw new Error(`AGENTS.md not found at any known path under: ${url}`);
  }

  normalize(raw: RawAgentData): UniversalAgentCard {
    const { markdown } = raw.data as { markdown: string; sourceUrl: string };
    const parsed = parseAgentsMd(markdown);
    const domain = extractDomain(raw.sourceUrl);
    const now = new Date().toISOString();

    const capabilities: Capability[] = parsed.capabilities.length > 0
      ? parsed.capabilities
      : [{ id: 'default', name: parsed.name, description: parsed.description }];

    const protocols: ProtocolSupport[] = [
      { protocol: 'custom', version: '1.0', endpoint: raw.sourceUrl.replace(/\/[^/]+$/, ''), manifest: raw.sourceUrl },
    ];

    return {
      id: `agentsmd:${domain}`,
      name: parsed.name,
      description: parsed.description,
      version: parsed.version,
      capabilities,
      protocols,
      endpoint: raw.sourceUrl.replace(/\/[^/]+$/, ''),
      publicKey: '',
      domain,
      tags: parsed.tags.length > 0 ? parsed.tags : undefined,
      created: now,
      updated: now,
      signature: '',
    };
  }
}

const CANDIDATE_PATHS = ['/.well-known/agents.md', '/AGENTS.md', '/agents.md'];
