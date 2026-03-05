/**
 * Content Hashing Utility
 *
 * Creates SHA-256 hashes of PII values for audit logging.
 * Never stores original content, only irreversible hashes.
 */

import { createHash } from "crypto";

/**
 * Hash content using SHA-256
 * @param content - The content to hash
 * @returns The SHA-256 hash as a hex string with 'sha256:' prefix
 */
export function hashContent(content: string): string {
  const hash = createHash("sha256").update(content, "utf-8").digest("hex");
  return `sha256:${hash}`;
}

/**
 * Hash content with a pepper (additional secret)
 * Use this for extra security on highly sensitive data
 * @param content - The content to hash
 * @param pepper - Additional secret value (e.g., from env var)
 * @returns The SHA-256 hash with pepper
 */
export function hashContentWithPepper(content: string, pepper: string): string {
  const hash = createHash("sha256").update(content, "utf-8").update(pepper, "utf-8").digest("hex");
  return `sha256:${hash}`;
}
