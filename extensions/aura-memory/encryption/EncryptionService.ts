// Encryption Service
// Story 2.2: User Category Encryption

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { validateEncryptionConfig, generateIV, compareAuthTag } from "./keyDerivation.js";
import type {
  EncryptionConfig,
  EncryptParams,
  DecryptParams,
  EncryptedData,
  EncryptionResult,
  DecryptionResult,
  BatchEncryptItem,
  BatchEncryptionResult,
  EncryptionDependencies,
} from "./types.js";

/**
 * Encryption Service - AES-256-GCM with PBKDF2 key derivation
 *
 * Security Features:
 * - AES-256-GCM for authenticated encryption
 * - PBKDF2 for key derivation (100k iterations default)
 * - Random IV for each encryption
 * - Associated data authentication
 * - Key material zeroing after use
 */
export class EncryptionService {
  private config: EncryptionConfig;
  private deps: EncryptionDependencies;

  constructor(deps: EncryptionDependencies) {
    this.config = validateEncryptionConfig(deps.config);
    this.deps = deps;
  }

  /**
   * Encrypt plaintext using AES-256-GCM
   *
   * @param params - Encryption parameters
   * @returns Encryption result
   */
  async encrypt(params: EncryptParams): Promise<EncryptionResult> {
    const startTime = this.deps.now();
    let keyMaterial: { key: Buffer; salt: Buffer; clear: () => void } | undefined;

    try {
      keyMaterial = await this.deps.keyProvider.getKey();
      // Generate random IV
      const iv = generateIV(this.config.ivLength);

      // Prepare associated data
      const aad = this.prepareAssociatedData(params);

      // Create cipher
      const cipher = createCipheriv("aes-256-gcm", keyMaterial.key, iv);

      // Set associated data
      cipher.setAAD(Buffer.from(aad, "utf8"));

      // Encrypt
      const ciphertext = Buffer.concat([cipher.update(params.plaintext, "utf8"), cipher.final()]);

      // Get auth tag
      const authTag = cipher.getAuthTag();

      // Build encrypted data structure
      const encryptedData: EncryptedData = {
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        salt: keyMaterial.salt.toString("base64"),
        algorithm: this.config.algorithm,
        keyDerivation: this.config.keyDerivation,
        pbkdf2Iterations: this.config.pbkdf2Iterations,
        version: 1,
      };

      return {
        success: true,
        data: encryptedData,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Encryption failed",
      };
    } finally {
      // Clear key material if it was created
      keyMaterial?.clear();
    }
  }

  /**
   * Decrypt ciphertext using AES-256-GCM
   *
   * @param params - Decryption parameters
   * @returns Decryption result
   */
  async decrypt(params: DecryptParams): Promise<DecryptionResult> {
    const startTime = this.deps.now();
    const { encrypted } = params;
    let keyMaterial: { key: Buffer; salt: Buffer; clear: () => void } | undefined;

    try {
      // Reconstruct key from stored salt
      const salt = Buffer.from(encrypted.salt, "base64");
      keyMaterial = await this.deps.keyProvider.getKey(salt);
      // Decode components
      const iv = Buffer.from(encrypted.iv, "base64");
      const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
      const authTag = Buffer.from(encrypted.authTag, "base64");

      // Prepare associated data
      const aad = this.prepareAssociatedData(params);

      // Create decipher
      const decipher = createDecipheriv("aes-256-gcm", keyMaterial.key, iv);

      // Set auth tag
      decipher.setAuthTag(authTag);

      // Set associated data
      decipher.setAAD(Buffer.from(aad, "utf8"));

      // Decrypt
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      return {
        success: true,
        plaintext: plaintext.toString("utf8"),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Decryption failed",
      };
    } finally {
      // Clear key material if it was created
      keyMaterial?.clear();
    }
  }

  /**
   * Batch encrypt multiple items
   *
   * @param items - Items to encrypt
   * @returns Batch result
   */
  async batchEncrypt(items: BatchEncryptItem[]): Promise<BatchEncryptionResult> {
    const startTime = this.deps.now();
    const successful: Array<{ id: string; data: EncryptedData }> = [];
    const failed: Array<{ id: string; error: string }> = [];

    // Process sequentially to avoid memory pressure
    for (const item of items) {
      const result = await this.encrypt({
        plaintext: item.plaintext,
        associatedData: item.associatedData,
        category: item.category,
        memoryId: item.memoryId,
      });

      if (result.success && result.data) {
        successful.push({ id: item.id, data: result.data });
      } else {
        failed.push({ id: item.id, error: result.error ?? "Unknown error" });
      }
    }

    return {
      successful,
      failed,
      durationMs: this.deps.now() - startTime,
    };
  }

  /**
   * Get current key ID
   */
  getKeyId(): string {
    return this.deps.keyProvider.getKeyId();
  }

  /**
   * Get encryption configuration
   */
  getConfig(): EncryptionConfig {
    return { ...this.config };
  }

  /**
   * Prepare associated data for authentication
   * Includes category and memoryId to prevent context confusion attacks
   */
  private prepareAssociatedData(params: {
    category: string;
    memoryId: string;
    associatedData?: Record<string, unknown>;
  }): string {
    const data = {
      category: params.category,
      memoryId: params.memoryId,
      ...params.associatedData,
    };
    return JSON.stringify(data);
  }
}

/**
 * Factory function to create encryption service
 */
export function createEncryptionService(deps: EncryptionDependencies): EncryptionService {
  return new EncryptionService(deps);
}
