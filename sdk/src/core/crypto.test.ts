import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  publicKeyFromSecret,
  canonicalize,
  sign,
  verify,
  generateNonce,
} from './crypto.js';

describe('crypto', () => {
  describe('generateKeyPair', () => {
    it('should generate valid key pair', () => {
      const kp = generateKeyPair();
      expect(kp.publicKey).toMatch(/^ed25519:[A-Za-z0-9+/=]+$/);
      expect(kp.secretKey).toBeInstanceOf(Uint8Array);
      expect(kp.secretKey.length).toBe(64);
    });

    it('should generate unique key pairs', () => {
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      expect(kp1.publicKey).not.toBe(kp2.publicKey);
    });
  });

  describe('publicKeyFromSecret', () => {
    it('should derive same public key from secret key', () => {
      const kp = generateKeyPair();
      const derived = publicKeyFromSecret(kp.secretKey);
      expect(derived).toBe(kp.publicKey);
    });
  });

  describe('canonicalize', () => {
    it('should sort keys alphabetically', () => {
      const result = canonicalize({ z: 1, a: 2, m: 3 });
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it('should strip trust and signature fields', () => {
      const result = canonicalize({
        name: 'test',
        trust: { score: 50 },
        signature: 'ed25519:abc',
      });
      expect(result).toBe('{"name":"test"}');
    });

    it('should sort nested objects recursively', () => {
      const result = canonicalize({
        b: { z: 1, a: 2 },
        a: 'hello',
      });
      expect(result).toBe('{"a":"hello","b":{"a":2,"z":1}}');
    });

    it('should handle arrays without sorting', () => {
      const result = canonicalize({ items: [3, 1, 2] });
      expect(result).toBe('{"items":[3,1,2]}');
    });

    it('should handle null values', () => {
      const result = canonicalize({ a: null, b: 'test' });
      expect(result).toBe('{"a":null,"b":"test"}');
    });
  });

  describe('sign and verify', () => {
    it('should sign and verify a message', () => {
      const kp = generateKeyPair();
      const message = {
        name: 'Test Agent',
        description: 'A test agent',
        version: '1.0.0',
      };

      const signature = sign(message, kp.secretKey);
      expect(signature).toMatch(/^ed25519:[A-Za-z0-9+/=]+$/);

      const signed = { ...message, signature };
      expect(verify(signed, kp.publicKey)).toBe(true);
    });

    it('should fail verification with wrong key', () => {
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      const message = { name: 'Test' };

      const signature = sign(message, kp1.secretKey);
      const signed = { ...message, signature };

      expect(verify(signed, kp2.publicKey)).toBe(false);
    });

    it('should fail verification with tampered message', () => {
      const kp = generateKeyPair();
      const message = { name: 'Test', value: 42 };

      const signature = sign(message, kp.secretKey);
      const tampered = { name: 'Tampered', value: 42, signature };

      expect(verify(tampered, kp.publicKey)).toBe(false);
    });

    it('should fail verification with no signature', () => {
      const kp = generateKeyPair();
      const message = { name: 'Test' };
      expect(verify(message, kp.publicKey)).toBe(false);
    });

    it('should ignore trust field when signing', () => {
      const kp = generateKeyPair();
      const message = { name: 'Agent', version: '1.0' };

      const signature = sign(message, kp.secretKey);

      // Adding trust field after signing should not break verification
      const withTrust = { ...message, trust: { score: 95 }, signature };
      expect(verify(withTrust, kp.publicKey)).toBe(true);
    });
  });

  describe('generateNonce', () => {
    it('should generate 32-char hex string', () => {
      const nonce = generateNonce();
      expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should generate unique nonces', () => {
      const nonces = new Set(Array.from({ length: 100 }, () => generateNonce()));
      expect(nonces.size).toBe(100);
    });
  });
});
