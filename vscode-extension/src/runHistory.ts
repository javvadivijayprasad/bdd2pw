/**
 * Persistent run-history store.
 *
 * Backed by the extension's globalState so records survive VS Code
 * restarts. Capped at 50 entries — older runs roll off the bottom of
 * the sidebar's "Recent runs" section.
 */

import type { Memento } from "vscode";

const KEY = "bdd2pw.runHistory.v1";
const MAX_ENTRIES = 50;

export interface RunRecord {
  featurePath: string;
  repoPath: string;
  reviewPath: string;
  ranAt: number; // ms since epoch
  filesWritten: number;
  tscErrorCount: number;
}

export class RunHistory {
  constructor(private readonly storage: Memento) {}

  list(): RunRecord[] {
    const raw = this.storage.get<RunRecord[]>(KEY);
    return Array.isArray(raw) ? raw : [];
  }

  getMostRecent(): RunRecord | undefined {
    return this.list()[0];
  }

  add(record: RunRecord): void {
    const next = [record, ...this.list()].slice(0, MAX_ENTRIES);
    void this.storage.update(KEY, next);
  }

  clear(): void {
    void this.storage.update(KEY, []);
  }
}
