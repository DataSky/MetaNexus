/**
 * @metanexus/adapters — Protocol adapters for A2A, MCP, AGENTS.md, etc.
 */

export { A2AAdapter } from './a2a.js';
export { MCPAdapter } from './mcp.js';
export { AgentsMdAdapter, parseAgentsMd } from './agentsmd.js';

import { A2AAdapter } from './a2a.js';
import { MCPAdapter } from './mcp.js';
import { AgentsMdAdapter } from './agentsmd.js';
import type { ProtocolAdapter } from '../core/types.js';

/**
 * All built-in adapters in detection-priority order.
 * A2A > MCP > AGENTS.md (higher specificity first).
 */
export const ALL_ADAPTERS: ProtocolAdapter[] = [
  new A2AAdapter(),
  new MCPAdapter(),
  new AgentsMdAdapter(),
];
