// ============================================================================
// MetaNexus Crypto Utilities
// ed25519 signing and verification for agent identity
// ============================================================================

import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;

// ─── Key Generation ─────────────────────────────────────────────────────────

export interface KeyPair {
  publicKey: string;   // base64 (raw 32 bytes)
  privateKey: string;  // base64 (PKCS8 DER)
}

/**
 * Generate a new ed25519 key pair for agent identity.
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const pair = await subtle.generateKey('Ed25519', true, ['sign', 'verify']);

  const publicKeyRaw = await subtle.exportKey('raw', pair.publicKey);
  const privateKeyPkcs8 = await subtle.exportKey('pkcs8', pair.privateKey);

  return {
    publicKey: Buffer.from(publicKeyRaw).toString('base64'),
    privateKey: Buffer.from(privateKeyPkcs8).toString('base64'),
  };
}

// ─── Signing ────────────────────────────────────────────────────────────────

/**
 * Sign data with an ed25519 private key (PKCS8 base64).
 * Returns "ed25519:<base64url>" format.
 */
export async function sign(data: string | Uint8Array, privateKeyBase64: string): Promise<string> {
  const keyBytes = Buffer.from(privateKeyBase64, 'base64');
  const key = await subtle.importKey(
    'pkcs8',
    keyBytes,
    'Ed25519',
    false,
    ['sign'],
  );

  const message = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const signature = await subtle.sign('Ed25519', key, message);

  return `ed25519:${Buffer.from(signature).toString('base64url')}`;
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
    const keyBytes = Buffer.from(publicKeyBase64, 'base64');
    const key = await subtle.importKey(
      'raw',
      keyBytes,
      'Ed25519',
      false,
      ['verify'],
    );

    const message = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const sigBytes = Buffer.from(sigParts[1], 'base64url');

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
