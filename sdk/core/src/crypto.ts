// ============================================================================
// MetaNexus Crypto Utilities
// ed25519 signing and verification for agent identity
// ============================================================================

import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;

// ─── Key Generation ─────────────────────────────────────────────────────────

export interface KeyPair {
  publicKey: string;   // base64
  privateKey: string;  // base64
}

/**
 * Generate a new ed25519 key pair for agent identity.
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const pair = await subtle.generateKey('Ed25519', true, ['sign', 'verify']);

  const publicKeyRaw = await subtle.exportKey('raw', pair.publicKey);
  const privateKeyRaw = await subtle.exportKey('pkcs8', pair.privateKey);

  return {
    publicKey: bufferToBase64(publicKeyRaw),
    privateKey: bufferToBase64(privateKeyRaw),
  };
}

// ─── Signing ────────────────────────────────────────────────────────────────

/**
 * Sign data with an ed25519 private key.
 * Returns "ed25519:<base64url>" format.
 */
export async function sign(data: string | Uint8Array, privateKeyBase64: string): Promise<string> {
  const keyData = base64ToBuffer(privateKeyBase64);
  const key = await subtle.importKey('pkcs8', keyData, 'Ed25519', false, ['sign']);

  const message = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const signature = await subtle.sign('Ed25519', key, message);

  return `ed25519:${bufferToBase64url(signature)}`;
}

/**
 * Verify an ed25519 signature.
 */
export async function verify(
  data: string | Uint8Array,
  signature: string,
  publicKeyBase64: string,
): Promise<boolean> {
  const sigParts = signature.split(':');
  if (sigParts[0] !== 'ed25519' || !sigParts[1]) {
    return false;
  }

  try {
    const keyData = base64ToBuffer(publicKeyBase64);
    const key = await subtle.importKey('raw', keyData, 'Ed25519', false, ['verify']);

    const message = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const sigBytes = base64urlToBuffer(sigParts[1]);

    return subtle.verify('Ed25519', key, sigBytes, message);
  } catch {
    return false;
  }
}

// ─── Canonical JSON ─────────────────────────────────────────────────────────

/**
 * Produce canonical JSON for signing.
 * Rules:
 * - Sort all object keys alphabetically (deep)
 * - No whitespace
 * - Remove 'signature' and 'trust' fields
 */
export function canonicalize(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(stripFields(obj, ['signature', 'trust'])));
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

function stripFields(
  obj: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!fields.includes(key)) {
      result[key] = value;
    }
  }
  return result;
}

// ─── Sign/Verify AgentCard ──────────────────────────────────────────────────

import type { UniversalAgentCard } from './types.js';

/**
 * Sign an AgentCard. Returns the card with signature field set.
 */
export async function signCard(
  card: Omit<UniversalAgentCard, 'signature'>,
  privateKeyBase64: string,
): Promise<UniversalAgentCard> {
  const canonical = canonicalize(card as Record<string, unknown>);
  const sig = await sign(canonical, privateKeyBase64);
  return { ...card, signature: sig };
}

/**
 * Verify an AgentCard's signature against its publicKey.
 */
export async function verifyCard(card: UniversalAgentCard): Promise<boolean> {
  if (!card.signature || !card.publicKey) return false;
  const canonical = canonicalize(card as unknown as Record<string, unknown>);
  return verify(canonical, card.signature, card.publicKey);
}

// ─── Encoding Utilities ─────────────────────────────────────────────────────

function bufferToBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64');
}

function bufferToBase64url(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64url');
}

function base64ToBuffer(b64: string): ArrayBuffer {
  return Buffer.from(b64, 'base64').buffer as ArrayBuffer;
}

function base64urlToBuffer(b64url: string): ArrayBuffer {
  return Buffer.from(b64url, 'base64url').buffer as ArrayBuffer;
}
