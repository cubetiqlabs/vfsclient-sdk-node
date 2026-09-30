import canonicalize from 'canonicalize';
import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha2.js';
import type { SoftwareSignature, TrustedSoftwareKeys } from './types';

function encodeBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64url');
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64url'));
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function canonicalSoftwareJSON(payload: unknown): string {
  const value = canonicalize(payload);
  if (value === undefined) throw new Error('Unsupported release metadata');
  return value;
}

export function softwareKeyPairFromSeed(seedBase64Url: string): { publicKey: string; keyId: string } {
  const seed = decodeBase64Url(seedBase64Url);
  if (seed.length !== 32) throw new Error('Signing seed must be 32 bytes in base64url format');
  const pair = nacl.sign.keyPair.fromSeed(seed);
  return { publicKey: encodeBase64Url(pair.publicKey), keyId: toHex(sha256(pair.publicKey)) };
}

export function signSoftwarePayload(payload: unknown, seedBase64Url: string): SoftwareSignature {
  const seed = decodeBase64Url(seedBase64Url);
  if (seed.length !== 32) throw new Error('Signing seed must be 32 bytes in base64url format');
  const pair = nacl.sign.keyPair.fromSeed(seed);
  const message = new TextEncoder().encode(canonicalSoftwareJSON(payload));
  return { key_id: toHex(sha256(pair.publicKey)), value: encodeBase64Url(nacl.sign.detached(message, pair.secretKey)) };
}

export function verifySoftwarePayload(payload: unknown, signature: SoftwareSignature, trustedKeys: TrustedSoftwareKeys): void {
  const publicValue = trustedKeys[signature.key_id];
  if (!publicValue) throw new Error(`Untrusted software signing key: ${signature.key_id}`);
  const publicKey = decodeBase64Url(publicValue);
  if (publicKey.length !== 32 || toHex(sha256(publicKey)) !== signature.key_id) throw new Error('Invalid trusted software public key');
  const signed = decodeBase64Url(signature.value);
  const message = new TextEncoder().encode(canonicalSoftwareJSON(payload));
  if (signed.length !== 64 || !nacl.sign.detached.verify(message, signed, publicKey)) throw new Error('Invalid software signature');
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateSigningSeed(
  seedBase64Url: string,
  expectedKeyId?: string
): { valid: boolean; error?: string; keyId?: string; publicKey?: string; matches?: boolean } {
  try {
    const trimmed = seedBase64Url.trim();
    if (!trimmed) {
      return { valid: false, error: 'Signing key is empty' };
    }
    const seed = decodeBase64Url(trimmed);
    if (seed.length !== 32) {
      return { valid: false, error: `Key must be exactly 32 bytes (got ${seed.length})` };
    }
    const pair = nacl.sign.keyPair.fromSeed(seed);
    const publicKey = encodeBase64Url(pair.publicKey);
    const keyId = toHex(sha256(pair.publicKey));
    const matches = expectedKeyId ? keyId === expectedKeyId : undefined;
    return { valid: true, keyId, publicKey, matches };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Invalid signing key format' };
  }
}

export function createKeyFile(
  seedBase64Url: string,
  app: string,
  bucketId?: string
): import('./types').VFSKeyFile {
  const pair = softwareKeyPairFromSeed(seedBase64Url);
  return {
    vfs_key_version: 1,
    app,
    ...(bucketId ? { bucket_id: bucketId } : {}),
    key_id: pair.keyId,
    public_key: pair.publicKey,
    signing_seed: seedBase64Url.trim(),
    created_at: new Date().toISOString(),
  };
}

export function parseKeyFile(raw: string): { seed: string; app?: string; bucketId?: string; keyId?: string; publicKey?: string } {
  const trimmed = raw.trim();
  // Case 1: JSON Key File (.vfs-key)
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      const seed = parsed.signing_seed || parsed.seed || parsed.private_key;
      if (typeof seed === 'string') {
        const validated = validateSigningSeed(seed);
        if (validated.valid) {
          return {
            seed: seed.trim(),
            app: parsed.app,
            bucketId: parsed.bucket_id,
            keyId: validated.keyId,
            publicKey: validated.publicKey,
          };
        }
      }
    } catch {
      // Fall through to plain text parsing
    }
  }

  // Case 2: .env line (VFS_SIGNING_KEY="...")
  const envMatch = trimmed.match(/(?:VFS_SIGNING_KEY|SIGNING_KEY|PRIVATE_KEY)\s*=\s*["']?([A-Za-z0-9_-]+)["']?/i);
  if (envMatch && envMatch[1]) {
    const validated = validateSigningSeed(envMatch[1]);
    if (validated.valid) {
      return { seed: envMatch[1], keyId: validated.keyId, publicKey: validated.publicKey };
    }
  }

  // Case 3: Raw base64url string
  const rawSeed = trimmed.replace(/\s+/g, '');
  const validated = validateSigningSeed(rawSeed);
  if (validated.valid) {
    return { seed: rawSeed, keyId: validated.keyId, publicKey: validated.publicKey };
  }

  throw new Error('Unable to extract a valid 32-byte Ed25519 signing key from the provided input');
}

