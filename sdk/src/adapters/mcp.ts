/**
 * MCP Protocol Adapter
 *
 * Fetches and normalizes MCP (Model Context Protocol) tool manifests.
 * Tries /.well-known/mcp.json, then falls back to probing the MCP endpoint.
 * Spec: https://modelcontextprotocol.io/
 */

import type {
  ProtocolAdapter,
  DetectionResult,
  RawAgentData,
  UniversalAgentCard,
  Capability,
  ProtocolSupport,
} from '../core/types.js';

// ---- MCP types ---------------------------------------------------------------

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface MCPPrompt {
  name: string;
  description?: string;
}

interface MCPManifest {
  name: string;
  description?: string;
  version?: string;
  tools?: MCPTool[];
  resources?: MCPResource[];
  prompts?: MCPPrompt[];
  serverInfo?: { name: string; version?: string };
}

// ---- Helpers -----------------------------------------------------------------

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function toolToCapability(tool: MCPTool): Capability {
  return {
    id: tool.name,
    name: tool.name,
    description: tool.description ?? tool.name,
    inputSchema: tool.inputSchema,
  };
}

// ---- Adapter -----------------------------------------------------------------

export class MCPAdapter implements ProtocolAdapter {
  readonly protocol = 'mcp';
  readonly version = '2024-11-05';

  async detect(url: string): Promise<DetectionResult> {
    const manifestUrl = mcpManifestUrl(url);
    try {
      const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { detected: false, confidence: 0 };

      const data = (await res.json()) as Record<string, unknown>;
      // MCP manifests have tools/resources/prompts arrays
      const hasMcpShape =
        Array.isArray(data['tools']) ||
        Array.isArray(data['resources']) ||
        Array.isArray(data['prompts']);

      if (hasMcpShape) return { detected: true, confidence: 0.85, protocol: 'mcp' };
      return { detected: false, confidence: 0.1 };
    } catch {
      return { detected: false, confidence: 0 };
    }
  }

  async fetch(url: string): Promise<RawAgentData> {
    const manifestUrl = mcpManifestUrl(url);
    const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      throw new Error(`MCP fetch failed (${res.status}): ${manifestUrl}`);
    }
    return {
      protocol: 'mcp',
      data: await res.json(),
      sourceUrl: manifestUrl,
      fetchedAt: new Date().toISOString(),
    };
  }

  normalize(raw: RawAgentData): UniversalAgentCard {
    const manifest = raw.data as MCPManifest;
    const domain = extractDomain(raw.sourceUrl);
    const now = new Date().toISOString();

    const capabilities: Capability[] = [
      ...(manifest.tools ?? []).map(toolToCapability),
      ...(manifest.resources ?? []).map(r => ({
        id: `resource:${r.name}`,
        name: r.name,
        description: r.description ?? r.uri,
      })),
      ...(manifest.prompts ?? []).map(p => ({
        id: `prompt:${p.name}`,
        name: p.name,
        description: p.description ?? p.name,
      })),
    ];

    if (capabilities.length === 0) {
      capabilities.push({
        id: 'default',
        name: manifest.name ?? domain,
        description: manifest.description ?? 'MCP server',
      });
    }

    const baseUrl = raw.sourceUrl.replace('/.well-known/mcp.json', '');
    const protocols: ProtocolSupport[] = [
      { protocol: 'mcp', version: this.version, endpoint: baseUrl, manifest: raw.sourceUrl },
    ];

    return {
      id: `mcp:${domain}`,
      name: manifest.name ?? manifest.serverInfo?.name ?? domain,
      description: manifest.description ?? `MCP server at ${domain}`,
      version: manifest.version ?? manifest.serverInfo?.version ?? '1.0.0',
      capabilities,
      protocols,
      endpoint: baseUrl,
      publicKey: '',
      domain,
      created: now,
      updated: now,
      signature: '',
    };
  }
}

function mcpManifestUrl(base: string): string {
  return `${base.replace(/\/$/, '')}/.well-known/mcp.json`;
}
