/**
 * Alejandria memory integration types.
 *
 * Design refs: Decision 4 (MemoryClient API, StoreOpts)
 */

/** Options for storing an observation in Alejandria. */
export interface StoreOpts {
  summary?: string;
  importance?: "critical" | "high" | "medium" | "low";
  topic?: string;
  topic_key?: string;
}

/** Options for recalling memories from Alejandria. */
export interface RecallOpts {
  limit?: number;
  scope?: string;
}

/** A memory observation returned from Alejandria. */
export interface Memory {
  id: string;
  content: string;
  summary?: string;
  topic?: string;
  topic_key?: string;
  created_at: string;
  score?: number;
}
