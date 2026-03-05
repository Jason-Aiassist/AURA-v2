// Key Derivation
// Story 2.2: User Category Encryption

import { randomBytes, pbkdf2, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { KeyMaterial, KeyProvider, EncryptionConfig } from "./types.js";

const pbkdf2Async = promisify(pbkdf2);

/**
 * Default encryption configuration
 */
export const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  algorithm: "aes-256-gcm",
  keyDerivation: "pbkdf2",
  pbkdf2Iterations: 100000,
  saltLength: 32,
  ivLength: 16,
  authTagLength: 16,
  keyLength: 32,
};

/**
 * Validate and merge encryption configuration
 */
export function validateEncryptionConfig(config: Partial<EncryptionConfig> = {}): EncryptionConfig {
  return {
    ...DEFAULT_ENCRYPTION_CONFIG,
    ...config,
  };
}

/**
 * Derive key using PBKDF2
 *
 * @param password - Master password or key material
 * @param salt - Salt for derivation (generated if not provided)
 * @param iterations - PBKDF2 iterations
 * @param keyLength - Desired key length in bytes
 * @returns Key material
 */
export async function deriveKeyPBKDF2(
  password: string,
  salt: Buffer | null,
  iterations: number,
  keyLength: number,
): Promise<KeyMaterial> {
  const useSalt = salt ?? randomBytes(32);

  const key = await pbkdf2Async(password, useSalt, iterations, keyLength, "sha256");

  return {
    key,
    salt: useSalt,
    clear: () => {
      // Zero out the key buffer
      key.fill(0);
    },
  };
}

/**
 * Create a key provider from a master password
 *
 * @param masterPassword - The master password
 * @param config - Encryption configuration
 * @returns Key provider
 */
export function createPasswordKeyProvider(
  masterPassword: string,
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG,
): KeyProvider {
  // Key ID based on password hash prefix (for tracking, not security)
  const keyId = `pwd-${hashKeyIdentifier(masterPassword)}`;

  return {
    getKey: async (salt?: Buffer) => {
      return deriveKeyPBKDF2(
        masterPassword,
        salt ?? null,
        config.pbkdf2Iterations,
        config.keyLength,
      );
    },
    getKeyId: () => keyId,
  };
}

/**
 * Create a key provider from environment/system key
 *
 * @param config - Encryption configuration
 * @returns Key provider
 */
export function createSystemKeyProvider(
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG,
): KeyProvider {
  // In production, this would read from secure environment/HSM
  // For now, generate a random key (only suitable for testing)
  const systemKey = randomBytes(config.keyLength);
  const keyId = `sys-${systemKey.slice(0, 8).toString("hex")}`;

  return {
    getKey: async (salt?: Buffer) => {
      // System keys don't use salt, but we return consistent interface
      return {
        key: Buffer.from(systemKey),
        salt: salt ?? randomBytes(config.saltLength),
        clear: () => {
          // Can't zero out system key as it's reused
        },
      };
    },
    getKeyId: () => keyId,
  };
}

/**
 * Hash a key identifier (not for security, just for tracking)
 */
function hashKeyIdentifier(password: string): string {
  // Simple hash for identifier purposes only
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

/**
 * Generate a random initialization vector
 */
export function generateIV(length: number = 16): Buffer {
  return randomBytes(length);
}

/**
 * Generate a random salt
 */
export function generateSalt(length: number = 32): Buffer {
  return randomBytes(length);
}

/**
 * Constant-time comparison for auth tags
 */
export function compareAuthTag(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
