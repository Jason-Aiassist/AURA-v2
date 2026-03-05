// Graph Module Index

export { Neo4jGraphitiClient, createGraphitiClient } from "./Neo4jClient.js";
export type {
  GraphitiConfig,
  GraphitiEpisode,
  GraphitiEntity,
  GraphitiEdge,
  GraphitiSearchResult,
  AddEpisodeInput,
} from "./types.js";

export {
  EntityMergeService,
  createEntityMergeService,
  type EntityMergeConfig,
  type MergeResult,
} from "./EntityMergeService.js";
