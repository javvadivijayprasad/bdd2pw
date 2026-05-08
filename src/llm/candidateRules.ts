/**
 * Append every successful LLM-generated binding to
 * `<repo>/artefacts/candidate-rules.jsonl`. The offline review pipeline
 * reads this file to propose new deterministic rules — auto-write back
 * into stepMatcher.ts is deferred to v2.1 (see docs/SCOPE.md §17).
 *
 * Why JSONL not a single JSON array: append-only writes are cheaper and
 * safe under concurrent scaffold runs. Newline-delimited JSON also plays
 * well with `jq`, `wc -l`, etc.
 *
 * Why `artefacts/` not `.bdd2pw/`: candidate rules are CONTENT users may
 * commit to source control (the offline pipeline lives in their repo
 * too). `.bdd2pw/` is for pure runtime cache (gitignored). We already
 * use `artefacts/` for heal-events.jsonl from v1.1's self-healing
 * scaffold, so the convention is established.
 */

import * as fs from "fs-extra";
import * as path from "path";
import type { CandidateRuleEntry } from "./types";

export class CandidateRulesWriter {
  private filePath: string;
  private initialised = false;

  constructor(repoRoot: string, filename = "candidate-rules.jsonl") {
    this.filePath = path.join(repoRoot, "artefacts", filename);
  }

  /**
   * Append one entry. Best-effort: if the directory can't be created or
   * the file can't be written, swallow — generation already succeeded;
   * we don't want to break the build for a logging failure.
   */
  async append(entry: CandidateRuleEntry): Promise<void> {
    try {
      if (!this.initialised) {
        await fs.ensureDir(path.dirname(this.filePath));
        this.initialised = true;
      }
      await fs.appendFile(
        this.filePath,
        JSON.stringify(entry) + "\n",
        "utf8",
      );
    } catch {
      /* best-effort */
    }
  }

  /** For tests: return all entries written so far. */
  async readAll(): Promise<CandidateRuleEntry[]> {
    if (!(await fs.pathExists(this.filePath))) return [];
    const raw = await fs.readFile(this.filePath, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as CandidateRuleEntry);
  }
}
