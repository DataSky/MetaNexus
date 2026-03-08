# MetaNexus Project Guidelines

## What is this?

MetaNexus is the universal discovery, trust, and settlement layer for the agent economy — **"Google for Agents"**。

它不是一个新协议（不与 A2A/MCP/UCP 竞争），而是坐在它们**之上**的基础设施层：索引、排名、路由、结算。

## Project Status

**Phase 0: Foundation — COMPLETE ✅**

已完成：
- 4 份核心设计文档（docs/ 目录，共 ~85KB）
- SDK core 类型 + crypto + validation（33 tests passing）
- GitHub repo: https://github.com/DataSky/MetaNexus

**当前任务：Phase 0 剩余编码 → Phase 1 Discovery MVP**

---

## Architecture Overview

```
MetaNexus = Discovery Engine + Trust Fabric + Settlement Layer

Discovery: 爬取+索引所有 Agent（无论 A2A/MCP/UCP），语义搜索
Trust:     行为信任评分（不是自己声明的），SLA 验证，Stake & Slash
Settlement: 计算原生结算 — USDC + Model Quota Swap + Compute Credits
```

**三个核心创新**：
1. **Protocol-agnostic discovery** — 用 Adapter 模式统一 A2A/MCP/UCP/AGENTS.md
2. **Behavioral Trust Score** — 从实际交易行为计算，不是自己填的
3. **Model Quota Swap** — Agent 之间直接交换模型 API 配额，SOTA 排行榜动态定价

---

## Must-Read Documents (按阅读顺序)

| 文档 | 位置 | 内容 | 阅读优先级 |
|------|------|------|-----------|
| **RFC** | `docs/RFC.md` | 完整设计提案，所有核心抽象的定义 | **必读** |
| **Architecture** | `docs/architecture.md` | 技术架构、组件设计、数据模型、部署方案 | **必读** |
| **AgentCard Schema** | `docs/agent-card-schema.md` | UniversalAgentCard JSON Schema + 示例 | 开发时参考 |
| **Settlement** | `docs/settlement.md` | SOTA Index、MQS 协议、Escrow 设计 | Phase 2-3 参考 |

---

## Code Structure

```
metanexus/
├── docs/                          # 设计文档（已完成）
│   ├── RFC.md                     # 核心设计提案
│   ├── architecture.md            # 技术架构
│   ├── agent-card-schema.md       # AgentCard 规范
│   └── settlement.md              # 结算层设计
├── sdk/                           # TypeScript SDK（主要开发区域）
│   ├── package.json               # 依赖: tweetnacl, zod, vitest
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts               # 入口
│       ├── core/                  # ✅ 已完成 - 核心类型+crypto+validation
│       │   ├── types.ts           # 全量类型定义（~470行）
│       │   ├── crypto.ts          # ed25519 签名/验签/规范化
│       │   ├── validation.ts      # Zod schemas
│       │   ├── index.ts           # 导出
│       │   ├── crypto.test.ts     # 15 tests ✅
│       │   └── validation.test.ts # 18 tests ✅
│       ├── discovery/             # 🔲 待开发 - 搜索和爬取
│       │   └── index.ts           # stub
│       ├── trust/                 # 🔲 待开发 - Trust Score
│       │   └── index.ts           # stub
│       ├── settlement/            # 🔲 待开发 - 多资产结算
│       │   └── index.ts           # stub
│       └── adapters/              # 🔲 待开发 - 协议适配器
│           └── index.ts           # stub
├── server/                        # 🔲 待开发 - Registry API 服务
├── crawler/                       # 🔲 待开发 - Agent 爬虫
├── cli/                           # 🔲 待开发 - CLI 工具
├── README.md
├── LICENSE                        # MIT
└── CLAUDE.md                      # ← 你正在读的文件
```

---

## Development Roadmap

### Phase 0 剩余（当前）
- [ ] SDK `tsc` 编译通过（当前 src 可 vitest 但未做 build pipeline）
- [ ] AgentCard builder 工具类（创建、签名、验证 AgentCard 的便捷 API）
- [ ] Intent/Offer builder 工具类

### Phase 1: Discovery MVP（重点）
- [ ] **Protocol Adapters**: A2A adapter（爬取 `/.well-known/agent.json`）、MCP adapter、AGENTS.md adapter
- [ ] **Crawler**: 给定 URL 列表，爬取并归一化为 UniversalAgentCard
- [ ] **Registry API** (Hono):
  - `POST /v1/agents` — 注册 Agent
  - `GET /v1/agents/:id` — 获取 AgentCard
  - `POST /v1/search` — 语义搜索
  - `GET /v1/health` — 健康检查
- [ ] **Semantic Search**: pgvector embedding + cosine similarity
- [ ] **CLI**: `npx metanexus search "translate Chinese legal docs"`
- [ ] **基础 Trust Score**: uptime + response time probing

### Phase 2: Trust & Delegation
- [ ] TaskIntent → TaskOffer → TaskExecution 完整流程
- [ ] SLA 验证探针
- [ ] Behavioral Trust Score v2
- [ ] Stake & Slash (USDC on Base)

### Phase 3: Compute Settlement
- [ ] SOTA Index 数据管道
- [ ] Model Quota Swap 协议
- [ ] 多资产 Escrow
- [ ] 动态定价引擎

---

## Key Design Decisions

1. **UniversalAgentCard 是 A2A AgentCard 的超集**
   - A2A 的 `skills` → MetaNexus 的 `capabilities`
   - 新增 `settlement`, `sla`, `trust`, `publicKey` 字段
   - 详见 `docs/agent-card-schema.md` 的兼容性映射表

2. **ed25519 签名，不用 JWT**
   - 继承自 MetaD，使用 `tweetnacl`
   - 签名前先规范化（去除 `trust` 和 `signature` 字段，排序 keys）
   - 详见 `sdk/src/core/crypto.ts`

3. **Zod 做运行时校验**
   - 类型定义在 `types.ts`，Zod schema 在 `validation.ts`
   - 两者必须保持同步

4. **Hono 做 API 框架**
   - 轻量、快速、edge-compatible
   - 详见 `docs/architecture.md` 第 2.1 节

5. **PostgreSQL + pgvector 做语义搜索**
   - 不用 Pinecone/Weaviate 等托管服务
   - 嵌入模型先用通用的，后续可换

6. **Settlement 支持 5 种资产**
   - USDC（x402，继承 MetaD）
   - Model Quota（核心创新）
   - Compute Credits
   - Data Credits
   - Storage Credits

---

## Relationship to MetaD

MetaD (`../metad/`) 是电商垂直 PoC，MetaNexus 是水平泛化。可以复用的：

| MetaD 组件 | 复用方式 |
|-----------|---------|
| ed25519 签名逻辑 | 已移植到 `sdk/src/core/crypto.ts` |
| AgentCard 格式 | 已扩展为 UniversalAgentCard |
| x402 支付流程 | Phase 1 直接复用（`../metad/sdk/src/x402/`）|
| Registry API 结构 | 参考但重写（SQLite → PostgreSQL + pgvector）|
| Trust Score 算法 | 参考但扩展（加 SLA 验证、Stake/Slash）|

**MetaD 架构文档**: `../metad/tech/architecture-v0.3.md`（329行，详细参考）

---

## Code Style & Conventions

- **TypeScript strict mode** — 不允许 any
- **ESM modules** — `"type": "module"` in package.json
- **Vitest** — 测试文件放在源码旁边 (`*.test.ts`)
- **Functional core, imperative shell** — 纯函数做计算，Service 类做 IO
- **测试命名**: `describe('模块名')` > `it('should 行为描述')`
- **Git commit**: conventional commits (`feat:`, `fix:`, `docs:`, `test:`)

---

## Commands

```bash
cd sdk/

# Install dependencies
npm install

# Run tests
npx vitest run

# Watch mode
npx vitest

# Type check (需要先配好 build)
npx tsc --noEmit
```

---

## Environment & Dependencies

- Node.js >= 22
- TypeScript 5.7+
- Runtime dependencies: `tweetnacl` (crypto), `zod` (validation)
- Dev dependencies: `vitest` (testing)
- 未来: `hono` (API server), `pg` + `pgvector` (database)

---

## Important: What NOT to Do

1. **不要改变核心类型定义**（除非有充分理由）— `types.ts` 是协议规范
2. **不要删除已通过的测试** — 33 个测试是回归基线
3. **不要引入重量级框架**（Express, NestJS）— 用 Hono
4. **不要用集中式向量数据库**（Pinecone 等）— 用 pgvector
5. **不要把 MetaD 代码直接 copy** — 参考后重写，适配 MetaNexus 的抽象层

---

*Last updated: 2026-03-08 by Kiro*
