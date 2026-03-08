/**
 * MetaNexus Crypto — ed25519 signing and verification
 *
 * Used for AgentCard signatures, TaskIntent/TaskOffer signing,
 * and QuotaCertificate authentication.
 */

import nacl from 'tweetnacl';
import { Buffer } from 'node:buffer';

// ============================================================================
// Key Management
// ============================================================================

export interface KeyPair {
  publicKey: string;   // "ed25519:<base64>"
  secretKey: Uint8Array; // Raw 64-byte secret key (keep private!)
}

/**
 * Generate a new ed25519 key pair.
 */
export function generateKeyPair(): KeyPair {
  const pair = nacl.sign.keyPair();
  return {
    publicKey: `ed25519:${Buffer.from(pair.publicKey).toString('base64')}`,
    secretKey: pair.secretKey,
  };
}

/**
 * Derive the public key string from a secret key.
 */
export function publicKeyFromSecret(secretKey: Uint8Array): string {
  const pair = nacl.sign.keyPair.fromSecretKey(secretKey);
  return `ed25519:${Buffer.from(pair.publicKey).toString('base64')}`;
}

// ============================================================================
// Canonicalization
// ============================================================================

/**
 * Produce a canonical JSON string for signing.
 *
 * Rules:
 * 1. Remove 'trust' field (MetaNexus-populated)
 * 2. Remove 'signature' field
 * 3. Sort all object keys alphabetically (recursive)
 * 4. No whitespace
 */
export function canonicalize(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(stripFields(obj, ['trust', 'signature'])));
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function stripFields(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!fields.includes(key)) {
      result[key] = value;
    }
  }
  return result;
}

// ============================================================================
// Signing
// ============================================================================

/**
 * Sign a message object with an ed25519 secret key.
 * Returns the signature string in format "ed25519:<base64>".
 */
export function sign(obj: Record<string, unknown>, secretKey: Uint8Array): string {
  const canonical = canonicalize(obj);
  const message = new TextEncoder().encode(canonical);
  const signature = nacl.sign.detached(message, secretKey);
  return `ed25519:${Buffer.from(signature).toString('base64')}`;
}

/**
 * Sign raw bytes with an ed25519 secret key.
 */
export function signBytes(data: Uint8Array, secretKey: Uint8Array): string {
  const signature = nacl.sign.detached(data, secretKey);
  return `ed25519:${Buffer.from(signature).toString('base64')}`;
}

// ============================================================================
// Verification
// ============================================================================

/**
 * Verify a signed message object against a public key.
 */
export function verify(obj: Record<string, unknown>, publicKey: string): boolean {
  const signature = (obj as { signature?: string }).signature;
  if (!signature || !signature.startsWith('ed25519:')) return false;

  const publicKeyBytes = parsePublicKey(publicKey);
  const signatureBytes = Buffer.from(signature.replace('ed25519:', ''), 'base64');
  const canonical = canonicalize(obj);
  const message = new TextEncoder().encode(canonical);

  return nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);
}

/**
 * Verify raw bytes against a signature and public key.
 */
export function verifyBytes(data: Uint8Array, signature: string, publicKey: string): boolean {
  if (!signature.startsWith('ed25519:')) return false;

  const publicKeyBytes = parsePublicKey(publicKey);
  const signatureBytes = Buffer.from(signature.replace('ed25519:', ''), 'base64');

  return nacl.sign.detached.verify(data, signatureBytes, publicKeyBytes);
}

// ============================================================================
// Helpers
// ============================================================================

function parsePublicKey(publicKey: string): Uint8Array {
  const raw = publicKey.replace('ed25519:', '');
  return new Uint8Array(Buffer.from(raw, 'base64'));
}

/**
 * Generate a random nonce for replay protection.
 */
export function generateNonce(): string {
  const bytes = nacl.randomBytes(16);
  return Buffer.from(bytes).toString('hex');
}
