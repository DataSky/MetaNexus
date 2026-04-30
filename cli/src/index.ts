#!/usr/bin/env node
/**
 * MetaNexus CLI
 *
 * Usage:
 *   metanexus search "translate Chinese legal docs"
 *   metanexus crawl https://agent.example.com
 *   metanexus crawl --file urls.txt
 *   metanexus serve [--port 3000]
 */

import { Crawler } from '../../sdk/src/discovery/crawler.js';
import { AgentRegistry } from '../../sdk/src/discovery/registry.js';
import { createApp } from '../../server/src/app.js';
import { serve } from '@hono/node-server';
import { readFileSync } from 'node:fs';
import { createSOTAIndex, formatSwapQuote, quoteSwap } from '../../sdk/src/settlement/index.js';

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'search':
      await cmdSearch(args);
      break;
    case 'crawl':
      await cmdCrawl(args);
      break;
    case 'serve':
      await cmdServe(args);
      break;
    case 'swap':
      await cmdSwap(args);
      break;
    default:
      printHelp();
      process.exit(command ? 1 : 0);
  }
}

// ---- search ------------------------------------------------------------------

async function cmdSearch(args: string[]) {
  const apiUrl = env('METANEXUS_API', 'http://localhost:3000');
  const query = args.join(' ');
  if (!query) {
    console.error('Usage: metanexus search <query>');
    process.exit(1);
  }

  const res = await fetch(`${apiUrl}/v1/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    console.error(`Search failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const { results } = (await res.json()) as { results: Array<{ agent: { id: string; name: string; description: string; endpoint: string }; overallScore: number }> };

  if (results.length === 0) {
    console.log('No agents found.');
    return;
  }

  console.log(`\nFound ${results.length} agent(s) for "${query}":\n`);
  for (const r of results) {
    const score = (r.overallScore * 100).toFixed(0);
    console.log(`  [${score}%] ${r.agent.name}`);
    console.log(`         ${r.agent.description}`);
    console.log(`         ${r.agent.endpoint}\n`);
  }
}

// ---- crawl -------------------------------------------------------------------

async function cmdCrawl(args: string[]) {
  let urls: string[] = [];

  if (args[0] === '--file' && args[1]) {
    urls = readFileSync(args[1], 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } else {
    urls = args;
  }

  if (urls.length === 0) {
    console.error('Usage: metanexus crawl <url> [url ...]\n       metanexus crawl --file urls.txt');
    process.exit(1);
  }

  const apiUrl = env('METANEXUS_API', '');

  if (apiUrl) {
    // Submit to running server
    const res = await fetch(`${apiUrl}/v1/crawl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    const body = await res.json() as { crawled: number; registered: number; results: Array<{ url: string; status: string; agentId?: string; error?: string }> };
    console.log(`\nCrawled ${body.crawled} URLs, registered ${body.registered} agents.\n`);
    for (const r of body.results) {
      const icon = r.status === 'success' ? '✓' : '✗';
      const detail = r.status === 'success' ? r.agentId ?? '' : r.error ?? r.status;
      console.log(`  ${icon}  ${r.url}  →  ${detail}`);
    }
  } else {
    // Standalone mode (no server)
    const crawler = new Crawler();
    console.log(`\nCrawling ${urls.length} URL(s)...\n`);
    const results = await crawler.crawl(urls);
    for (const r of results) {
      const icon = r.status === 'success' ? '✓' : '✗';
      const detail = r.status === 'success' ? `${r.protocol}  ${r.card?.name}` : r.error ?? r.status;
      console.log(`  ${icon}  ${r.url}  →  ${detail}`);
    }
  }
}

// ---- serve -------------------------------------------------------------------

async function cmdServe(args: string[]) {
  const port = Number(args.find(a => /^\d+$/.test(a)) ?? process.env['PORT'] ?? 3000);
  const registry = new AgentRegistry();
  const app = createApp(registry);

  serve({ fetch: app.fetch, port }, info => {
    console.log(`MetaNexus Registry API listening on http://localhost:${info.port}`);
  });
}


// ---- swap --------------------------------------------------------------------

async function cmdSwap(args: string[]) {
  const subcommand = args[0] ?? 'demo';
  const index = createSOTAIndex();

  if (subcommand === 'index') {
    console.log('\nMetaNexus SOTA Index (MVP)\n');
    for (const model of index.models.sort((a, b) => b.indexPrice - a.indexPrice)) {
      console.log(`${model.model.padEnd(22)} ${model.tier.padEnd(8)} $${model.indexPrice.toFixed(4)}/M tokens  utilization=${(model.utilizationRate * 100).toFixed(0)}%`);
    }
    return;
  }

  if (subcommand === 'quote') {
    const from = parseRequiredAssetArg(args[1], 'from');
    const to = parseOptionalAssetArg(args[2], 'to');
    const quote = quoteSwap(index, { from, to });
    console.log('\n' + formatSwapQuote(quote) + '\n');
    return;
  }

  if (subcommand === 'demo') {
    const quote = quoteSwap(index, {
      from: { model: 'claude-sonnet-4.6', tokens: 2_000_000 },
      to: { model: 'gemini-flash' },
    });
    console.log('\nModel Quota Swap Demo\n');
    console.log('Agent A has: 2,000,000 Claude Sonnet 4.6 tokens');
    console.log('Agent A needs: Gemini Flash bulk-classification quota');
    console.log('MetaNexus quote:\n');
    console.log(formatSwapQuote(quote));
    console.log('');
    return;
  }

  console.error('Usage: metanexus swap [demo|index|quote <model:tokens> <model[:tokens]>]');
  process.exit(1);
}

function parseRequiredAssetArg(raw: string | undefined, label: string): { model: string; tokens: number } {
  const parsed = parseOptionalAssetArg(raw, label);
  if (parsed.tokens === undefined) {
    console.error(`Missing token amount for ${label}. Expected model:tokens, e.g. claude-sonnet-4.6:2M`);
    process.exit(1);
  }
  return { model: parsed.model, tokens: parsed.tokens };
}

function parseOptionalAssetArg(raw: string | undefined, label: string): { model: string; tokens?: number } {
  if (!raw) {
    console.error(`Missing ${label} asset. Expected model:tokens, e.g. claude-sonnet-4.6:2M`);
    process.exit(1);
  }
  const [model, tokenText] = raw.split(':');
  if (!model) {
    console.error(`Invalid ${label} asset: ${raw}`);
    process.exit(1);
  }
  if (!tokenText) return { model };
  return { model, tokens: parseTokenAmount(tokenText) };
}

function parseTokenAmount(raw: string): number {
  const text = raw.trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)([mk])?$/);
  if (!match) {
    console.error(`Invalid token amount: ${raw}. Use forms like 2M, 500K, 1000000.`);
    process.exit(1);
  }
  const value = Number(match[1]);
  const suffix = match[2];
  if (suffix === 'm') return Math.floor(value * 1_000_000);
  if (suffix === 'k') return Math.floor(value * 1_000);
  return Math.floor(value);
}

// ---- helpers -----------------------------------------------------------------

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function printHelp() {
  console.log(`
MetaNexus CLI v0.1.0

Commands:
  search <query>          Search for agents (requires running server)
  crawl <url> [url ...]   Crawl one or more agent URLs
  crawl --file urls.txt   Crawl URLs from a file
  serve [port]            Start the Registry API server
  swap demo               Show Model Quota Swap demo
  swap index              Print SOTA Index MVP prices
  swap quote A:2M B       Quote a model quota swap

Environment:
  METANEXUS_API           API base URL (default: http://localhost:3000)
  PORT                    Server port for \`serve\` command (default: 3000)
`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
