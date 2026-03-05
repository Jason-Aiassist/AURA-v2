/**
 * AURA Memory Configuration
 *
 * Central configuration for user-specific settings.
 * Modify these values to customize AURA for a different user.
 */

export interface AuraUserConfig {
  /** The primary user's name - used for pronoun resolution and relationship queries */
  userName: string;
  /** Aliases that refer to the user (pronouns, etc.) */
  userAliases: string[];
}

/**
 * Default user configuration
 *
 * These values are used throughout AURA for:
 * - Query entity resolution ("me" → userName)
 * - Relationship inference ("my dad" → looks for father relationship to userName)
 * - Context injection personalization
 */
export const DEFAULT_USER_CONFIG: AuraUserConfig = {
  userName: "Steve",
  userAliases: ["i", "me", "my", "myself", "mine", "we", "our", "us"],
};

/**
 * Get the effective user configuration
 * Currently returns default, but can be extended to load from:
 * - Environment variables
 * - Config files
 * - Database settings
 */
export function getUserConfig(): AuraUserConfig {
  // Future: Load from environment or config file
  // const envName = process.env.AURA_USER_NAME;
  // if (envName) return { ...DEFAULT_USER_CONFIG, userName: envName };

  return DEFAULT_USER_CONFIG;
}

/**
 * Get the user's name
 * Convenience function for common use case
 */
export function getUserName(): string {
  return getUserConfig().userName;
}

/**
 * Get user aliases for pronoun resolution
 */
export function getUserAliases(): string[] {
  return getUserConfig().userAliases;
}
