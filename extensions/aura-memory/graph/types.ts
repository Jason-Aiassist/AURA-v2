/**
 * Graphiti Types
 * Sprint 2 - Story 2: Knowledge Graph Integration
 */

export type Tier = "HOT" | "WARM" | "COLD";

export interface GraphitiConfig {
  url: string;
  username: string;
  password: string;
  database?: string;
}

export interface GraphitiEpisode {
  uuid: string;
  name: string;
  body: string;
  source_description: string;
  reference_time: string;
  metadata: string;
}

export interface GraphitiEntity {
  uuid: string;
  name: string;
  entity_type: string;
  summary: string;
}

export interface GraphitiEdge {
  uuid: string;
  from: string;
  to: string;
  fact: string;
}

export interface GraphitiSearchResult {
  episodes: GraphitiEpisode[];
  entities: GraphitiEntity[];
  edges: GraphitiEdge[];
}

export interface AddEpisodeInput {
  name: string;
  body: string;
  sourceDescription: string;
  referenceTime: Date;
  metadata?: Record<string, unknown>;
}
