// Encryption Module - Public API
// Story 2.2: User Category Encryption

export { EncryptionService, createEncryptionService } from "./EncryptionService.js";
export {
  deriveKeyPBKDF2,
  createPasswordKeyProvider,
  createSystemKeyProvider,
  validateEncryptionConfig,
  generateIV,
  generateSalt,
  compareAuthTag,
  DEFAULT_ENCRYPTION_CONFIG,
} from "./keyDerivation.js";

export type {
  EncryptionAlgorithm,
  KeyDerivationAlgorithm,
  EncryptionConfig,
  EncryptedData,
  EncryptParams,
  DecryptParams,
  KeyMaterial,
  KeyProvider,
  EncryptionDependencies,
  EncryptionResult,
  DecryptionResult,
  BatchEncryptItem,
  BatchEncryptionResult,
} from "./types.js";
