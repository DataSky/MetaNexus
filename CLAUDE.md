# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is MetaNexus?

MetaNexus is the universal discovery, trust, and settlement layer for the agent economy — **"Google for Agents"**.

It is **not** a new protocol (it doesn't compete with A2A/MCP/UCP). It sits **above** them as infrastructure: indexing, ranking, routing, and settlement across all agent protocols.

**Three core innovations**:
1. **Protocol-agnostic discovery** — Adapter pattern unifying A2A/MCP/UCP/AGENTS.md
2. **Behavioral Trust Score** — Computed from actual transaction history, not self-declared
3. **Model Quota Swap** — Agents exchange model API quotas directly; SOTA leaderboard drives dynamic pricing

## Commands

All commands run from the repo root:

```bash
npm test              # Run all tests (vitest run)
npm run test:watch    # Watch mode
npm run build         # Compile TypeScript (tsc -b)
npm run clean         # Remove dist/ artifacts
npx tsc --noEmit      # Type-check without building
```

To run a single test file:
```bash
npx vitest run sdk/src/core/crypto.test.ts
```

## Architecture

```
MetaNexus = Discovery Engine + Trust Fabric + Settlement Layer

┌─────────────────── MetaNexus Gateway (Hono) ───────────────────┐
│  POST /v1/agents   GET /v1/agents/:id   POST /v1/search        │
│  POST /v1/intents  POST /v1/swap        GET /v1/health         │
└──────────────┬──────────────────────────────────────────────────┘
               │
    ┌──────────┴──────────┬──────────────┬──────────────┐
    ▼                     ▼              ▼              ▼
Registry Service    Search Service  Trust Service  Settlement Service
    │                     │              │              │
    └──────────┬──────────┴──────────────┴──────────────┘
               ▼
    PostgreSQL + pgvector + Redis + Base (x402)
```

**Data flow**: Crawler discovers agents → Protocol Adapters normalize to `UniversalAgentCard` → Registry stores → Search Service indexes with pgvector embeddings → Trust Service scores based on behavior → Settlement handles compute-native payments.

## Code Structure

```
sdk/
├── src/                    # Primary SDK (active development)
│   ├── index.ts
│   ├── core/               # ✅ Complete — types, crypto, validation
│   │   ├── types.ts         # UniversalAgentCard & all types (~470 lines)
│   │   ├── crypto.ts        # ed25519 sign/verify (tweetnacl)
│   │   ├── validation.ts    # Zod runtime schemas
│   │   ├── crypto.test.ts   # 15 tests ✅
│   │   └── validation.test.ts # 18 tests ✅
│   ├── adapters/           # ✅ Phase 1 — A2A/MCP/AGENTS.md adapters (23 tests)
│   ├── discovery/          # ✅ Phase 1 — Crawler + semantic search (17 tests)
│   │   └── trust.test.ts   # Trust Score probing (26 tests) ✅
│   └── delegation/         # ✅ Phase 2 — TaskIntent→TaskOffer→TaskExecution (27 tests)
├── core/                   # @metanexus/core package (legacy, mirrors sdk/src/core)
├── discovery/              # stub
├── trust/                  # stub
├── settlement/             # 🔲 Phase 3 — multi-asset settlement (not started)
└── adapters/               # stub
server/                     # ✅ Phase 1 — Hono Registry API (17 routes, 228 lines)
│   └── src/db/             # ✅ PostgreSQL stores — AgentStore + DelegationStore (564 lines)
cli/                        # ✅ Phase 1 — npx metanexus search (159 lines)
docs/                       # Design documents (read before implementing)
```

## Must-Read Documents

| Doc | Path | Read When |
|-----|------|-----------|
| RFC | `docs/RFC.md` | Always — defines all core abstractions |
| Architecture | `docs/architecture.md` | Always — component design, data model, API routes |
| AgentCard Schema | `docs/agent-card-schema.md` | When touching types or adapters |
| Settlement | `docs/settlement.md` | Phase 2–3 work |

## Key Design Decisions

**`UniversalAgentCard` is a superset of A2A AgentCard** — A2A's `skills` maps to MetaNexus `capabilities`; adds `settlement`, `sla`, `trust`, `publicKey` fields. See `docs/agent-card-schema.md` for compatibility mapping.

**ed25519, not JWT** — Uses `tweetnacl`. Before signing, normalize the card (remove `trust` and `signature` fields, sort keys). See `sdk/src/core/crypto.ts`.

**Zod + TypeScript types must stay in sync** — Types defined in `types.ts`, runtime schemas in `validation.ts`. Changing one requires changing the other.

**Hono for API, not Express/NestJS** — Lightweight, edge-compatible.

**pgvector for semantic search, not Pinecone/Weaviate** — Self-hosted with PostgreSQL.

**5 settlement assets**: USDC (x402), Model Quota (core innovation), Compute Credits, Data Credits, Storage Credits.

## Relationship to MetaD

MetaD (`../metad/`) is the e-commerce vertical PoC; MetaNexus is the horizontal generalization. Already ported to MetaNexus: ed25519 crypto, AgentCard format (extended to UniversalAgentCard). x402 payment flow from `../metad/sdk/src/x402/` is reusable in Phase 1. Reference `../metad/tech/architecture-v0.3.md` for patterns.

## Development Phase Status

**Phase 0: Foundation — COMPLETE ✅** (33 tests → 59 tests)
- RFC, Architecture, AgentCard Schema, Settlement design docs ✅
- SDK core types (UniversalAgentCard, TaskIntent/Offer/Execution) ✅
- ed25519 crypto (tweetnacl) ✅
- Zod validation layer ✅

**Phase 1: Discovery MVP — COMPLETE ✅** (126 tests total, 2026-03-08)
- Protocol Adapters (A2A `/.well-known/agent.json`, MCP, AGENTS.md): 23 tests ✅
- Crawler + Semantic Search (pgvector embeddings): 17 tests ✅
- Basic Trust Score (uptime + response time probing): 26 tests ✅
- Registry API (Hono, 17 routes): `/v1/agents`, `/v1/search`, `/v1/crawl`, `/v1/health` ✅
- CLI (`npx metanexus search "..."`): 159 lines ✅
- PostgreSQL stores (AgentStore): 191 lines ✅
- ⚠️ **Blocked**: DMXAPI embedding key 401 — semantic search calls fail in prod; replace key or switch to OpenAI embeddings
- ⚠️ **Not deployed**: PostgreSQL DB not running; needs Railway setup

**Phase 2: Trust & Delegation — CORE LOGIC COMPLETE ✅, Stake/Slash pending**
- TaskIntent → TaskOffer → TaskExecution delegation flow: 27 tests ✅
- PostgreSQL-backed DelegationStore (intents/offers/executions tables): 270 lines ✅
- ❌ SLA Probes: not implemented
- ❌ Stake & Slash (USDC on Base): not implemented

**Phase 3: Compute Settlement — NOT STARTED ❌**
- SOTA Index pipeline
- Model Quota Swap protocol (core innovation)
- Multi-asset Escrow
- Dynamic pricing based on SOTA leaderboard

## Immediate Next Steps (Priority Order)

1. **Fix embeddings** — Replace DMXAPI key or switch to OpenAI `text-embedding-3-small`
2. **Deploy PostgreSQL** — Railway PostgreSQL + run `docs/schema.sql` (or create it if missing)
3. **End-to-end smoke test** — Start server, register an agent, search, crawl a real URL
4. **Phase 2: SLA Probes** — Periodic HTTP probing of registered agents → feed into Trust Score
5. **Phase 2: Stake & Slash** — USDC on Base via x402 (reference `../metad/sdk/src/x402/`)
6. **Phase 3: SOTA Index** — Fetch LMSYS/OpenLLM leaderboard data, map model → score
7. **Phase 3: Model Quota Swap** — Core protocol: swap intents, escrow, settle

## Code Conventions

- TypeScript strict mode — no `any`
- ESM modules (`"type": "module"`)
- Tests colocated with source (`*.test.ts`)
- Functional core, imperative shell — pure functions for computation, Service classes for I/O
- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`

## Constraints

- Do not change `types.ts` without strong justification — it's the protocol spec
- Do not copy MetaD code directly — reference and rewrite to fit MetaNexus abstractions
- Do not introduce Express or NestJS — use Hono
- Do not use hosted vector databases (Pinecone, Weaviate) — use pgvector

## Environment

- Node.js >= 22, TypeScript 5.7+
- Runtime deps: `tweetnacl` (crypto), `zod` (validation)
- Planned: `hono` (server), `pg` + `pgvector` (database)
- GitHub: https://github.com/DataSky/MetaNexus
