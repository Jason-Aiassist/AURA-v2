/**
 * Migrations Module
 * Database migration scripts for AURA Memory system
 */

export { runMigration001, rollbackMigration001 } from "./001-add-semantic-relationships.js";
export { runMigration002, findPotentialDuplicates } from "./002-dedupe-entities.js";
export { runMigration003, checkMigration003Status } from "./003-backfill-relationships.js";

// Re-export types
export type { Migration001Config, Migration001Result } from "./001-add-semantic-relationships.js";
export type {
  Migration002Config,
  Migration002Result,
  DuplicateGroup,
} from "./002-dedupe-entities.js";
export type { Migration003Config, Migration003Result } from "./003-backfill-relationships.js";
