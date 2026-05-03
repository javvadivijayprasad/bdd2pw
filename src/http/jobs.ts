/**
 * In-memory job store. v1.0 only. v1.1 promotes to SQLite-backed.
 * See docs/ARCHITECTURE.md §8.
 */

import { ulid } from "ulid";
import type { ReviewItem } from "../types";

export type JobStage =
  | "queued"
  | "parsing"
  | "scanning_repo"
  | "discovering_page"
  | "picking_locators"
  | "matching_steps"
  | "emitting"
  | "validating"
  | "completed"
  | "failed";

export interface JobRecord {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: JobStage;
  progress: number;
  warnings: ReviewItem[];
  errors: ReviewItem[];
  createdAt: string;
  updatedAt: string;
  /** Path to the on-disk artefact directory once available. */
  artifactDir?: string;
  /** Final result payload after `completed`. */
  result?: unknown;
}

const store = new Map<string, JobRecord>();

export function createJob(): JobRecord {
  const now = new Date().toISOString();
  const job: JobRecord = {
    id: ulid(),
    status: "queued",
    stage: "queued",
    progress: 0,
    warnings: [],
    errors: [],
    createdAt: now,
    updatedAt: now,
  };
  store.set(job.id, job);
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  return store.get(id);
}

export function updateJob(id: string, patch: Partial<JobRecord>): JobRecord | undefined {
  const current = store.get(id);
  if (!current) return undefined;
  const updated: JobRecord = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  store.set(id, updated);
  return updated;
}

/** Sweep jobs older than `maxAgeMs`. Default: 24h. */
export function sweepJobs(maxAgeMs = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [id, job] of store) {
    if (Date.parse(job.updatedAt) < cutoff) {
      store.delete(id);
      removed++;
    }
  }
  return removed;
}

export function _resetForTests(): void {
  store.clear();
}
