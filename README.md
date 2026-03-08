# MetaNexus

> **The Search Engine for the Agent Economy** — Universal agent discovery, trust, and task delegation with compute-native settlement

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-RFC%20%2F%20Design-orange)](./docs/RFC.md)

## What Problem Does This Solve?

We're entering an economy where every business, every developer, and eventually every person has AI agents acting on their behalf. These agents need to **find each other**, **trust each other**, and **pay each other** — without human intervention.

Today's landscape:
- **MCP** solves tool discovery (agent → tool)
- **A2A** solves enterprise agent collaboration (agent → agent, within organizations)
- **UCP** solves commerce (agent → merchant, Google + Shopify + Stripe)
- **x402** solves payment (agent → payment, USDC micropayments)

**What's missing**: An open, universal layer for **cross-boundary agent discovery and delegation** — the Google of the agent world. Not just "find an agent," but "find the right agent for this task, verify it can do it, negotiate terms, delegate, and settle — all autonomously."

## Core Thesis

> Agents don't need another protocol. They need **infrastructure that makes existing protocols discoverable, composable, and economically viable** at internet scale.

MetaNexus is not a new protocol competing with A2A or MCP. It sits **above** them — indexing, ranking, and routing agents regardless of which protocol they speak.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        MetaNexus                                  │
│                  "Google for Agents"                               │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐   │
│  │   Discovery   │  │    Trust     │  │     Settlement         │   │
│  │   Engine      │  │    Fabric    │  │     Layer              │   │
│  │              │  │              │  │                        │   │
│  │  Crawl &     │  │  Behavioral  │  │  Compute Credits       │   │
│  │  Index       │  │  Trust Score │  │  Model Quota Swap      │   │
│  │  AgentCards  │  │  SLA Verify  │  │  x402 / USDC           │   │
│  │              │  │  Stake &     │  │  Barter Exchange       │   │
│  │  Semantic    │  │  Slash       │  │  Multi-asset           │   │
│  │  Search      │  │              │  │  Settlement            │   │
│  │              │  │  Reputation  │  │                        │   │
│  │  Intent      │  │  Portable    │  │  Escrow &              │   │
│  │  Routing     │  │  & Auditable │  │  Dispute               │   │
│  └──────────────┘  └──────────────┘  └────────────────────────┘   │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│                    Protocol Adapters                                │
│          A2A  ·  MCP  ·  UCP  ·  Custom  ·  AGENTS.md              │
├────────────────────────────────────────────────────────────────────┤
│                    Infrastructure                                   │
│         x402 · USDC (Base) · Compute Credits · Model Quotas        │
└────────────────────────────────────────────────────────────────────┘
```

## Three Pillars

### 1. Discovery Engine — "Google for Agents"

**The problem**: There's no way for an agent to say "I need an agent that can do X" and get a ranked, verified list of candidates.

**How it works**:

- **Crawl & Index**: MetaNexus crawls `/.well-known/agent.json` endpoints (A2A AgentCards), MCP server manifests, AGENTS.md files, and custom registries. Like Googlebot, but for agents.
- **Semantic Search**: Natural language queries → ranked results. "Find me an agent that can translate legal documents from Chinese to English with HIPAA compliance" → top 10 matches with capability scores.
- **Intent Routing**: Don't just search — express intent. "I need 1000 images classified by next Tuesday, budget $50" → MetaNexus routes to capable agents, solicits bids, returns ranked offers.
- **Protocol-Agnostic**: Indexes agents regardless of whether they speak A2A, MCP, or proprietary APIs. MetaNexus translates at the routing layer.

**What makes this different from A2A's built-in discovery?**
A2A discovery is point-to-point: you need to know the agent's URL to fetch its AgentCard. That's like knowing a website's IP address before you can visit it. MetaNexus is DNS + Google: you describe what you need, and it finds it.

### 2. Trust Fabric — Portable, Behavioral, Verifiable

**The problem**: How does Agent A know Agent B won't take its money and deliver garbage? Today: it can't.

**How it works**:

- **Behavioral Trust Score**: Not self-declared, not review-based. Computed from actual transaction history — task completion rate, latency adherence, output quality (via automated verification), dispute rate.
- **SLA Verification**: Agents declare capabilities in their AgentCard. MetaNexus continuously probes: "You claim 99.9% uptime and <2s response? Let's verify." Trust Score adjusts based on actual vs. declared performance.
- **Stake & Slash**: Agents can optionally stake collateral (USDC or compute credits). If they violate SLA, stake is slashed and redistributed to the harmed party. Skin in the game.
- **Portable Reputation**: Trust Score follows the agent across platforms. Built once, used everywhere. Stored on-chain (or on a verifiable data structure) so no single platform controls it.
- **Drift Detection**: Continuous monitoring for quality degradation. An agent that was great last month but is now returning sloppy results gets flagged before clients notice.

### 3. Settlement Layer — Compute-Native Economy

**The problem**: Agents need to pay each other, but dollars are a poor unit of account for agent-to-agent transactions. An agent that has excess GPT-5 quota but needs Claude Opus time shouldn't have to convert to USD and back.

**This is the key innovation. Agent-native settlement.**

**Multiple settlement assets:**

| Asset | Description | Use Case |
|-------|-------------|----------|
| **USDC** | Stablecoin (via x402) | Universal fallback, human-world bridge |
| **Compute Credits** | Tokenized GPU hours (H100/H200) | Training, inference, rendering |
| **Model Quota** | SOTA model API calls (GPT-5.4, Claude Opus 4.6, Gemini 3.1 Pro) | Agent-to-agent barter |
| **Data Credits** | Access to proprietary datasets | Research, analytics |
| **Storage Credits** | Distributed storage allocation | Persistent memory, caching |

**How Model Quota Swap works:**

```
Agent A has: 10M tokens of Claude Opus 4.6 quota (unused)
Agent A needs: 50M tokens of Gemini 3.1 Flash (for bulk classification)

Agent B has: 100M tokens of Gemini 3.1 Flash quota (unused)
Agent B needs: 2M tokens of Claude Opus 4.6 (for complex reasoning)

MetaNexus Swap:
  A gives B: 2M Claude Opus tokens
  B gives A: 50M Gemini Flash tokens
  Exchange rate: market-determined, based on current SOTA rankings + demand

No USD touches the transaction. Pure agent-native barter.
```

**Why this matters**:
- Companies buy model API quotas in bulk but don't use them evenly
- Agents have heterogeneous needs (some need reasoning, some need speed)
- A liquid market for compute/quota creates **agent-native capital markets**
- This is how an agent economy develops its own monetary system, not by importing human monetary systems

**SOTA Leaderboard Integration:**

Model Quota values are dynamically priced based on:
1. **Benchmark rankings** (LMSYS Chatbot Arena, MMLU, HumanEval)
2. **Real demand** (actual swap volume on MetaNexus)
3. **Scarcity** (provider rate limits, waitlist status)

A model that jumps from #5 to #1 on the leaderboard sees its quota value increase in real-time. This creates a **prediction market for model quality** as a side effect.

## What MetaNexus Inherits from MetaD

MetaNexus is a spiritual successor to [MetaD](https://github.com/user/metad), which proved the concept in e-commerce:

| MetaD (E-commerce) | MetaNexus (Universal) |
|---------------------|----------------------|
| AgentCard for sellers | AgentCard for any agent |
| Intent = purchase request | Intent = any task delegation |
| Offer = price quote | Offer = capability bid (price + time + quality) |
| x402 USDC payment | Multi-asset settlement (USDC + compute + quota) |
| Shopify adapter | Protocol adapters (A2A, MCP, UCP, custom) |
| Product search | Universal capability search |
| Trust Score (tx history) | Trust Fabric (behavioral + SLA + stake) |

## Competitive Landscape

| Project | What It Does | Gap MetaNexus Fills |
|---------|-------------|---------------------|
| **Google A2A** | Agent-to-agent protocol | No universal discovery / ranking / settlement |
| **Anthropic MCP** | Tool discovery for agents | Tool-level, not agent-level; no trust or payment |
| **Google UCP** | Commerce protocol (Shopify + Stripe) | Commerce-only; not general task delegation |
| **x402 / Coinbase** | Payment protocol | Payment only; no discovery or trust |
| **AGENTS.md** | Static agent description file | No dynamic discovery, ranking, or verification |
| **OpenServ** | Agent marketplace | Centralized, not protocol-level |
| **Fetch.ai** | Decentralized agent framework | Crypto-native, high friction for web2 agents |
| **ERC-8004** | On-chain agent registry | Ethereum-only, no off-chain agent support |

**MetaNexus's unique position**: Protocol-agnostic discovery + behavioral trust + compute-native settlement. The three together don't exist anywhere.

## Roadmap

### Phase 0: Foundation (Month 1-2) — NOW
- [ ] RFC / Architecture doc
- [ ] AgentCard schema v1 (superset of A2A + MetaD)
- [ ] Crawler prototype (index /.well-known/agent.json from public agents)
- [ ] Semantic search MVP (embed + cosine, reuse MetaD's approach)
- [ ] GitHub open-source + community

### Phase 1: Discovery MVP (Month 3-4)
- [ ] Agent Registry API (register / search / get)
- [ ] Protocol adapters: A2A, MCP manifest, AGENTS.md
- [ ] Basic Trust Score (uptime + response time probing)
- [ ] CLI tool: `npx metanexus search "translate Chinese legal docs"`
- [ ] Web dashboard: search and browse agents

### Phase 2: Trust & Delegation (Month 5-8)
- [ ] Intent → Offer → Accept delegation flow
- [ ] SLA declaration and automated verification
- [ ] Behavioral Trust Score v2 (task completion + quality metrics)
- [ ] Stake & slash (optional, USDC collateral)
- [ ] Dispute resolution protocol

### Phase 3: Compute-Native Settlement (Month 9-12)
- [ ] Model Quota tokenization and swap protocol
- [ ] Compute credit marketplace
- [ ] Multi-asset escrow
- [ ] Dynamic pricing engine (SOTA leaderboard integration)
- [ ] Settlement API for third-party platforms

### Phase 4: Scale (Month 12+)
- [ ] Federated index (multiple MetaNexus nodes, no single point of control)
- [ ] Agent reputation portability standard
- [ ] SDK for major agent frameworks (LangChain, CrewAI, AutoGen, OpenClaw)
- [ ] Enterprise features (private registries, compliance)

## Tech Stack (Planned)

- **Language**: TypeScript (SDK + Server), Rust (Crawler + Search)
- **Database**: PostgreSQL + pgvector (semantic search)
- **Cache**: Redis (real-time rankings, quota pricing)
- **Blockchain**: Base (USDC settlement, on-chain trust attestations)
- **Search**: Custom embedding pipeline (reuse MetaD's DMXAPI approach, upgrade to dedicated model)
- **Deployment**: Railway → self-hostable Docker
- **Testing**: Vitest (inherit MetaD's test discipline)

## Project Structure

```
metanexus/
├── README.md                 # This file
├── LICENSE                   # MIT
├── docs/
│   ├── RFC.md                # Formal design proposal
│   ├── architecture.md       # Technical architecture
│   ├── agent-card-schema.md  # Universal AgentCard spec
│   └── settlement.md         # Compute-native settlement design
├── sdk/                      # TypeScript SDK
│   ├── core/                 # Core types and protocols
│   ├── discovery/            # Search and crawl
│   ├── trust/                # Trust Score computation
│   ├── settlement/           # Multi-asset settlement
│   └── adapters/             # A2A, MCP, UCP adapters
├── server/                   # Registry + API server
├── crawler/                  # Agent discovery crawler
└── cli/                      # Command-line tools
```

## Relationship to MetaD

MetaD continues as a production-ready **vertical implementation** for e-commerce. MetaNexus is the **horizontal generalization**. They share:

- AgentCard schema (MetaNexus is a superset)
- Trust Score algorithms (MetaNexus extends with SLA verification)
- x402 payment integration (MetaNexus adds multi-asset)
- TypeScript + Vitest toolchain

MetaD serves as proof-of-concept and reference implementation. MetaNexus is the vision.

## Name

**MetaNexus** = Meta (beyond, transcending) + Nexus (connection point, hub)

The nexus where all agents meet, discover, trust, and transact — regardless of protocol, platform, or purpose.

## Contributing

This project is in early RFC/design phase. Contributions welcome:

1. **Architecture feedback**: Open an issue with your thoughts
2. **Use case proposals**: What agent interactions should MetaNexus enable?
3. **Protocol expertise**: Help design adapters for A2A, MCP, UCP
4. **Settlement design**: Ideas for compute-native settlement mechanisms

## License

MIT

---

*Built by the MetaD team. Powered by the belief that agents deserve their own economy.*
