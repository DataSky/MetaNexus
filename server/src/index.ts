/**
 * MetaNexus Registry API — Node.js entry point
 *
 * Storage selection (automatic based on env):
 *   DATABASE_URL set  →  PostgreSQL + pgvector (persistent, production)
 *   DATABASE_URL unset →  In-memory (dev/test, ephemeral)
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { isDatabaseConfigured, PgAgentRegistry, PgDelegationStore } from './db/index.js';
import { AgentRegistry } from '../../sdk/src/discovery/registry.js';
import { DelegationStore } from '../../sdk/src/delegation/store.js';

const PORT = Number(process.env['PORT'] ?? 3000);

let registry: AgentRegistry | PgAgentRegistry;
let delegation: DelegationStore | PgDelegationStore;

if (isDatabaseConfigured()) {
  console.log('[db] Using PostgreSQL storage (DATABASE_URL is set)');
  registry = new PgAgentRegistry() as unknown as AgentRegistry;
  delegation = new PgDelegationStore() as unknown as DelegationStore;
} else {
  console.log('[db] Using in-memory storage (DATABASE_URL not set)');
  registry = new AgentRegistry();
  delegation = new DelegationStore();
}

const app = createApp(registry, delegation);

serve({ fetch: app.fetch, port: PORT }, info => {
  const storage = isDatabaseConfigured() ? 'PostgreSQL' : 'in-memory';
  console.log(`MetaNexus Registry API [${storage}] running at http://localhost:${info.port}`);
});
