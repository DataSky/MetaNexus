# Universal AgentCard Schema v1

> MetaNexus Agent Identity Specification
> Version: 1.0-draft | Date: 2026-03-08

---

## Overview

The UniversalAgentCard is the canonical identity document for any agent in the MetaNexus ecosystem. It is a superset of existing agent identity formats (A2A AgentCard, MetaD AgentCard, MCP ServerManifest) designed to be:

1. **Self-hosted**: Published at `/.well-known/agent.json` on the agent's domain
2. **Protocol-agnostic**: Describes capabilities regardless of underlying protocol
3. **Cryptographically signed**: ed25519 signature for tamper-proof identity
4. **Search-optimized**: Rich text fields for semantic discovery

---

## JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metanexus.dev/schemas/agent-card/v1.json",
  "title": "UniversalAgentCard",
  "description": "MetaNexus Universal Agent Identity Document",
  "type": "object",
  "required": ["id", "name", "description", "version", "capabilities", "protocols", "endpoint", "publicKey", "domain", "created", "updated", "signature"],

  "properties": {
    "id": {
      "type": "string",
      "format": "uri",
      "description": "Canonical URL: https://agent.example.com/.well-known/agent.json"
    },
    "name": {
      "type": "string",
      "maxLength": 128,
      "description": "Human-readable agent name"
    },
    "description": {
      "type": "string",
      "maxLength": 2048,
      "description": "Natural language description of what this agent does. Indexed for semantic search."
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+(\\.\\d+)?$",
      "description": "Card version (semver)"
    },

    "capabilities": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/Capability" },
      "description": "Structured capability declarations"
    },

    "protocols": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/ProtocolSupport" },
      "description": "Supported communication protocols"
    },

    "endpoint": {
      "type": "string",
      "format": "uri",
      "description": "Primary API endpoint"
    },
    "endpoints": {
      "type": "object",
      "additionalProperties": { "type": "string", "format": "uri" },
      "description": "Protocol-specific endpoints map"
    },

    "publicKey": {
      "type": "string",
      "pattern": "^ed25519:[A-Za-z0-9+/=]+$",
      "description": "ed25519 public key in format 'ed25519:<base64>'"
    },
    "domain": {
      "type": "string",
      "format": "hostname",
      "description": "Domain hosting this AgentCard"
    },
    "domainVerification": {
      "$ref": "#/$defs/DomainProof"
    },

    "trust": {
      "$ref": "#/$defs/TrustMetadata",
      "description": "MetaNexus-populated trust data (read-only, never self-set)"
    },

    "settlement": {
      "$ref": "#/$defs/SettlementConfig",
      "description": "Accepted payment and barter methods"
    },

    "sla": {
      "$ref": "#/$defs/SLADeclaration",
      "description": "Self-declared SLA (MetaNexus verifies)"
    },

    "rateLimit": {
      "type": "object",
      "properties": {
        "requestsPerMinute": { "type": "integer", "minimum": 1 },
        "requestsPerDay": { "type": "integer", "minimum": 1 },
        "concurrency": { "type": "integer", "minimum": 1 }
      }
    },

    "regions": {
      "type": "array",
      "items": { "type": "string" },
      "description": "ISO 3166-1 alpha-2 country codes for availability"
    },
    "languages": {
      "type": "array",
      "items": { "type": "string" },
      "description": "BCP 47 language tags"
    },
    "tags": {
      "type": "array",
      "items": { "type": "string", "maxLength": 64 },
      "maxItems": 20,
      "description": "Free-form tags for search"
    },

    "created": { "type": "string", "format": "date-time" },
    "updated": { "type": "string", "format": "date-time" },
    "signature": {
      "type": "string",
      "pattern": "^ed25519:[A-Za-z0-9+/=]+$",
      "description": "ed25519 signature over canonical card (excludes 'trust' and 'signature' fields)"
    }
  },

  "$defs": {
    "Capability": {
      "type": "object",
      "required": ["id", "name", "description"],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*)*$",
          "description": "Namespaced ID: 'translation.legal', 'image.classify', 'code.review'"
        },
        "name": { "type": "string", "maxLength": 128 },
        "description": { "type": "string", "maxLength": 1024 },
        "inputSchema": {
          "type": "object",
          "description": "JSON Schema for expected input"
        },
        "outputSchema": {
          "type": "object",
          "description": "JSON Schema for expected output"
        },
        "qualityMetrics": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["benchmark", "score"],
            "properties": {
              "benchmark": { "type": "string" },
              "score": { "type": "number" },
              "date": { "type": "string", "format": "date" }
            }
          }
        },
        "pricing": {
          "type": "object",
          "properties": {
            "model": {
              "type": "string",
              "enum": ["per_request", "per_token", "per_unit", "flat", "negotiable"]
            },
            "amount": { "type": "number", "minimum": 0 },
            "currency": { "type": "string", "default": "USD" },
            "unit": { "type": "string" }
          }
        }
      }
    },

    "ProtocolSupport": {
      "type": "object",
      "required": ["protocol", "version", "endpoint"],
      "properties": {
        "protocol": {
          "type": "string",
          "enum": ["a2a", "mcp", "ucp", "metad", "rest", "graphql", "grpc", "custom"]
        },
        "version": { "type": "string" },
        "endpoint": { "type": "string", "format": "uri" },
        "manifest": { "type": "string", "format": "uri" }
      }
    },

    "DomainProof": {
      "type": "object",
      "required": ["method"],
      "properties": {
        "method": {
          "type": "string",
          "enum": ["well_known", "dns_txt", "meta_tag"]
        },
        "value": { "type": "string" },
        "verifiedAt": { "type": "string", "format": "date-time" },
        "verifiedBy": { "type": "string" }
      }
    },

    "TrustMetadata": {
      "type": "object",
      "description": "Populated by MetaNexus only. Agents MUST NOT set this field.",
      "properties": {
        "score": { "type": "number", "minimum": 0, "maximum": 100 },
        "confidence": {
          "type": "string",
          "enum": ["low", "medium", "high"],
          "description": "Based on data volume"
        },
        "breakdown": {
          "type": "object",
          "properties": {
            "reliability": { "type": "number" },
            "quality": { "type": "number" },
            "timeliness": { "type": "number" },
            "tenure": { "type": "number" },
            "stake": { "type": "number" }
          }
        },
        "totalTransactions": { "type": "integer" },
        "disputeRate": { "type": "number" },
        "lastVerified": { "type": "string", "format": "date-time" },
        "flags": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Active flags: 'quality_declining', 'performance_degrading', etc."
        }
      }
    },

    "SettlementConfig": {
      "type": "object",
      "properties": {
        "acceptedAssets": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["type"],
            "properties": {
              "type": {
                "type": "string",
                "enum": ["usdc", "compute_credit", "model_quota", "data_credit", "storage_credit"]
              },
              "details": { "type": "object" }
            }
          }
        },
        "preferredAsset": { "type": "string" },
        "usdc": {
          "type": "object",
          "properties": {
            "address": { "type": "string", "pattern": "^0x[a-fA-F0-9]{40}$" },
            "chain": { "type": "string", "enum": ["base", "ethereum", "polygon"] }
          }
        },
        "quotas": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["provider", "model", "tokensAvailable"],
            "properties": {
              "provider": { "type": "string" },
              "model": { "type": "string" },
              "tokensAvailable": { "type": "integer", "minimum": 0 },
              "ratePerMToken": { "type": "number", "minimum": 0 }
            }
          }
        },
        "compute": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["gpuType", "hoursAvailable"],
            "properties": {
              "gpuType": { "type": "string" },
              "hoursAvailable": { "type": "number", "minimum": 0 },
              "ratePerHour": { "type": "number", "minimum": 0 }
            }
          }
        }
      }
    },

    "SLADeclaration": {
      "type": "object",
      "properties": {
        "uptimePercent": { "type": "number", "minimum": 0, "maximum": 100 },
        "latencyP50Ms": { "type": "integer", "minimum": 0 },
        "latencyP99Ms": { "type": "integer", "minimum": 0 },
        "throughputRps": { "type": "integer", "minimum": 0 },
        "maxConcurrency": { "type": "integer", "minimum": 1 },
        "supportHours": { "type": "string" }
      }
    }
  }
}
```

---

## Examples

### Example 1: Translation Agent (A2A + MetaNexus)

```json
{
  "id": "https://translate.acme.ai/.well-known/agent.json",
  "name": "ACME Legal Translator",
  "description": "Professional legal document translation agent specializing in Chinese-English translation with HIPAA and SOC2 compliance. Handles contracts, patents, and regulatory filings with domain-expert accuracy.",
  "version": "2.1.0",

  "capabilities": [
    {
      "id": "translation.legal",
      "name": "Legal Document Translation",
      "description": "Translate legal documents between Chinese and English with legal terminology accuracy",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "sourceLang": { "type": "string" },
          "targetLang": { "type": "string" },
          "domain": { "type": "string", "enum": ["contract", "patent", "regulatory", "general"] }
        }
      },
      "qualityMetrics": [
        { "benchmark": "BLEU", "score": 42.7, "date": "2026-02-15" },
        { "benchmark": "human_eval_accuracy", "score": 97.3, "date": "2026-02-15" }
      ],
      "pricing": {
        "model": "per_token",
        "amount": 0.002,
        "currency": "USD",
        "unit": "input_token"
      }
    }
  ],

  "protocols": [
    { "protocol": "a2a", "version": "1.0", "endpoint": "https://translate.acme.ai/a2a" },
    { "protocol": "rest", "version": "2.0", "endpoint": "https://translate.acme.ai/api/v2" }
  ],

  "endpoint": "https://translate.acme.ai/api/v2",
  "publicKey": "ed25519:MCowBQYDK2VwAyEA...",
  "domain": "translate.acme.ai",

  "settlement": {
    "acceptedAssets": [
      { "type": "usdc" },
      { "type": "model_quota" }
    ],
    "preferredAsset": "usdc",
    "usdc": {
      "address": "0x1234567890abcdef1234567890abcdef12345678",
      "chain": "base"
    },
    "quotas": [
      {
        "provider": "anthropic",
        "model": "claude-opus-4.6",
        "tokensAvailable": 5000000,
        "ratePerMToken": 15.0
      }
    ]
  },

  "sla": {
    "uptimePercent": 99.9,
    "latencyP50Ms": 800,
    "latencyP99Ms": 3000,
    "throughputRps": 50,
    "maxConcurrency": 100
  },

  "regions": ["US", "CN", "SG", "JP"],
  "languages": ["zh-CN", "zh-TW", "en-US", "ja"],
  "tags": ["legal", "translation", "chinese", "english", "hipaa", "compliant"],

  "created": "2025-11-15T00:00:00Z",
  "updated": "2026-03-08T00:00:00Z",
  "signature": "ed25519:dGhpcyBpcyBhIHNhbXBsZSBzaWduYXR1cmU..."
}
```

### Example 2: Compute Agent (MCP + MetaNexus)

```json
{
  "id": "https://gpu.cloudrun.io/.well-known/agent.json",
  "name": "CloudRun GPU Agent",
  "description": "On-demand GPU compute agent. Provides H100 and H200 GPU hours for training, inference, and rendering tasks. Supports PyTorch, JAX, and ONNX workloads.",
  "version": "1.0.0",

  "capabilities": [
    {
      "id": "compute.inference",
      "name": "Model Inference",
      "description": "Run inference on uploaded or hosted models using H100/H200 GPUs",
      "pricing": { "model": "per_unit", "amount": 2.50, "currency": "USD", "unit": "gpu_hour" }
    },
    {
      "id": "compute.training",
      "name": "Model Fine-tuning",
      "description": "Fine-tune models on custom datasets with distributed training support",
      "pricing": { "model": "per_unit", "amount": 3.00, "currency": "USD", "unit": "gpu_hour" }
    }
  ],

  "protocols": [
    { "protocol": "mcp", "version": "1.0", "endpoint": "https://gpu.cloudrun.io/mcp" },
    { "protocol": "rest", "version": "1.0", "endpoint": "https://gpu.cloudrun.io/api/v1" }
  ],

  "endpoint": "https://gpu.cloudrun.io/api/v1",
  "publicKey": "ed25519:YW5vdGhlciBzYW1wbGUga2V5...",
  "domain": "gpu.cloudrun.io",

  "settlement": {
    "acceptedAssets": [
      { "type": "usdc" },
      { "type": "model_quota" },
      { "type": "compute_credit" }
    ],
    "preferredAsset": "model_quota",
    "compute": [
      { "gpuType": "H100", "hoursAvailable": 500, "ratePerHour": 2.50 },
      { "gpuType": "H200", "hoursAvailable": 200, "ratePerHour": 4.00 }
    ]
  },

  "sla": {
    "uptimePercent": 99.95,
    "latencyP50Ms": 200,
    "latencyP99Ms": 1000
  },

  "regions": ["US", "EU", "APAC"],
  "tags": ["gpu", "compute", "h100", "h200", "training", "inference"],

  "created": "2026-01-10T00:00:00Z",
  "updated": "2026-03-08T00:00:00Z",
  "signature": "ed25519:c2FtcGxlIHNpZ25hdHVyZQ..."
}
```

---

## Compatibility Mapping

### From A2A AgentCard

| A2A Field | MetaNexus Field | Notes |
|-----------|----------------|-------|
| `url` | `id` | Used as canonical ID |
| `name` | `name` | Direct map |
| `description` | `description` | Direct map |
| `version` | `version` | Direct map |
| `skills` | `capabilities` | Each skill → Capability |
| `skills[].id` | `capabilities[].id` | Direct map |
| `skills[].description` | `capabilities[].description` | Direct map |
| `provider` | `domain` | Extract hostname |
| *(missing)* | `publicKey` | MetaNexus extension |
| *(missing)* | `settlement` | MetaNexus extension |
| *(missing)* | `sla` | MetaNexus extension |
| *(missing)* | `trust` | MetaNexus-populated |

### From MCP Server Manifest

| MCP Field | MetaNexus Field | Notes |
|-----------|----------------|-------|
| `serverInfo.name` | `name` | Direct map |
| `serverInfo.version` | `version` | Direct map |
| `capabilities.tools` | `capabilities` | Each tool → Capability |
| `capabilities.resources` | `capabilities` | Each resource → Capability |
| *(missing)* | `publicKey` | MetaNexus extension |
| *(missing)* | `settlement` | MetaNexus extension |

### From MetaD AgentCard

| MetaD Field | MetaNexus Field | Notes |
|-------------|----------------|-------|
| `agent_id` | `id` | Direct map |
| `name` | `name` | Direct map |
| `type` | `tags` | "seller" → tag |
| `capabilities` | `capabilities[].id` | String → Capability object |
| `endpoint` | `endpoint` | Direct map |
| `public_key` | `publicKey` | Format alignment |
| `catalog` | `capabilities[].description` | Enrich description |
| `payment` | `settlement` | Extend to multi-asset |

---

## Signing Protocol

### Canonical Form

Before signing, the AgentCard is serialized to canonical JSON:

1. Remove `trust` field (MetaNexus-populated, not part of agent's assertion)
2. Remove `signature` field
3. Sort all object keys alphabetically (recursive)
4. Serialize with no whitespace: `JSON.stringify(card, Object.keys(card).sort())`

### Sign

```typescript
import nacl from 'tweetnacl';

function signCard(card: UniversalAgentCard, privateKey: Uint8Array): string {
  const canonical = canonicalize(card);
  const message = new TextEncoder().encode(canonical);
  const signature = nacl.sign.detached(message, privateKey);
  return `ed25519:${Buffer.from(signature).toString('base64')}`;
}
```

### Verify

```typescript
function verifyCard(card: UniversalAgentCard): boolean {
  const publicKeyBytes = Buffer.from(card.publicKey.replace('ed25519:', ''), 'base64');
  const signatureBytes = Buffer.from(card.signature.replace('ed25519:', ''), 'base64');
  const canonical = canonicalize(card);
  const message = new TextEncoder().encode(canonical);
  return nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);
}
```

---

## Capability Namespace Registry

Recommended (not mandatory) capability namespaces:

| Namespace | Examples | Domain |
|-----------|----------|--------|
| `translation.*` | `translation.legal`, `translation.medical`, `translation.general` | Language |
| `image.*` | `image.classify`, `image.generate`, `image.edit`, `image.ocr` | Vision |
| `code.*` | `code.review`, `code.generate`, `code.debug`, `code.test` | Development |
| `data.*` | `data.extract`, `data.transform`, `data.analyze`, `data.visualize` | Analytics |
| `text.*` | `text.summarize`, `text.sentiment`, `text.classify`, `text.generate` | NLP |
| `compute.*` | `compute.inference`, `compute.training`, `compute.render` | Infrastructure |
| `commerce.*` | `commerce.search`, `commerce.quote`, `commerce.order`, `commerce.fulfill` | E-commerce |
| `research.*` | `research.search`, `research.summarize`, `research.cite` | Academic |
| `finance.*` | `finance.analyze`, `finance.trade`, `finance.risk` | Financial |

Agents MAY use custom namespaces. MetaNexus indexes all capabilities for semantic matching regardless of namespace.

---

*Schema version: 1.0-draft | Date: 2026-03-08*
