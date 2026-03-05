// Encryption Types
// Story 2.2: User Category Encryption

/**
 * Supported encryption algorithms
 */
export type EncryptionAlgorithm = "aes-256-gcm";

/**
 * Supported key derivation algorithms
 */
export type KeyDerivationAlgorithm = "pbkdf2" | "argon2id";

/**
 * Encryption configuration
 */
export interface EncryptionConfig {
  /** Encryption algorithm (default: aes-256-gcm) */
  algorithm: EncryptionAlgorithm;
  /** Key derivation algorithm (default: pbkdf2) */
  keyDerivation: KeyDerivationAlgorithm;
  /** PBKDF2 iterations (default: 100000) */
  pbkdf2Iterations: number;
  /** Salt length in bytes (default: 32) */
  saltLength: number;
  /** IV length in bytes (default: 16) */
  ivLength: number;
  /** Auth tag length in bytes (default: 16) */
  authTagLength: number;
  /** Key length in bytes (default: 32) */
  keyLength: number;
}

/**
 * Encrypted data structure
 */
export interface EncryptedData {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded initialization vector */
  iv: string;
  /** Base64-encoded authentication tag */
  authTag: string;
  /** Base64-encoded salt (for key derivation) */
  salt: string;
  /** Algorithm used */
  algorithm: EncryptionAlgorithm;
  /** Key derivation algorithm used */
  keyDerivation: KeyDerivationAlgorithm;
  /** PBKDF2 iterations (if applicable) */
  pbkdf2Iterations?: number;
  /** Version for future migrations */
  version: number;
}

/**
 * Encryption parameters for a single operation
 */
export interface EncryptParams {
  /** Plaintext to encrypt */
  plaintext: string;
  /** Associated data for authentication (not encrypted, but authenticated) */
  associatedData?: Record<string, unknown>;
  /** Category for context (e.g., 'User') */
  category: string;
  /** Memory ID for context */
  memoryId: string;
}

/**
 * Decryption parameters
 */
export interface DecryptParams {
  /** Encrypted data structure */
  encrypted: EncryptedData;
  /** Associated data for authentication verification */
  associatedData?: Record<string, unknown>;
  /** Category for context */
  category: string;
  /** Memory ID for context */
  memoryId: string;
}

/**
 * Key material interface
 */
export interface KeyMaterial {
  /** The derived key bytes */
  key: Buffer;
  /** Salt used for derivation */
  salt: Buffer;
  /** Clear the key from memory */
  clear: () => void;
}

/**
 * Key provider interface
 */
export interface KeyProvider {
  /** Get or derive key for encryption */
  getKey: (salt?: Buffer) => Promise<KeyMaterial>;
  /** Get key ID for tracking rotations */
  getKeyId: () => string;
}

/**
 * Encryption service dependencies
 */
export interface EncryptionDependencies {
  /** Key provider for key derivation */
  keyProvider: KeyProvider;
  /** Configuration (optional, uses defaults) */
  config?: Partial<EncryptionConfig>;
  /** Timestamp provider */
  now: () => number;
}

/**
 * Encryption operation result
 */
export interface EncryptionResult {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Encrypted data if successful */
  data?: EncryptedData;
}

/**
 * Decryption operation result
 */
export interface DecryptionResult {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Decrypted plaintext if successful */
  plaintext?: string;
}

/**
 * Batch encryption item
 */
export interface BatchEncryptItem extends EncryptParams {
  /** Unique ID for this item */
  id: string;
}

/**
 * Batch encryption result
 */
export interface BatchEncryptionResult {
  /** Successful encryptions */
  successful: Array<{ id: string; data: EncryptedData }>;
  /** Failed encryptions */
  failed: Array<{ id: string; error: string }>;
  /** Total processing time in ms */
  durationMs: number;
}

/**
 * Key rotation parameters
 */
export interface KeyRotationParams {
  /** New key provider for re-encryption */
  newKeyProvider: KeyProvider;
  /** Batch size for processing */
  batchSize: number;
}

/**
 * Encryption audit event
 */
export interface EncryptionAuditEvent {
  /** Operation type */
  operation: "encrypt" | "decrypt" | "batch_encrypt" | "key_rotation";
  /** Success status */
  success: boolean;
  /** Key ID used */
  keyId: string;
  /** Duration in ms */
  durationMs: number;
  /** Metadata */
  metadata: Record<string, unknown>;
  /** Error if any */
  error?: string;
}
