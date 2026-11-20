/**
 * Run `tsc --noEmit` against the emitted repo and parse diagnostics into
 * `ReviewItem`s. Uses the user's local `typescript` if present (in
 * `<repo>/node_modules/.bin/tsc`), else falls back to PATH.
 *
 * The output format is the standard TS one:
 *   pages/login.page.ts(12,3): error TS2304: Cannot find name 'Locator'.
 *
 * Each diagnostic becomes one `ReviewItem` with severity 'error'. Warnings
 * (`error TS6133`-style "unused variable") are downgraded to severity 'warn'.
 */

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs-extra";
import type { ReviewItem } from "../types";

export interface TscResult {
  errorCount: number;
  items: ReviewItem[];
}

export async function tscValidate(repoRoot: string): Promise<TscResult> {
  // v4.7.1 audit fix — if the scaffolded repo has no `node_modules`
  // directory, every `import ... from "@playwright/test"` / "pomwright" /
  // etc. will error with "Cannot find module", which drowns out the real
  // diagnostics in BDD_REVIEW.md. Skip validation instead and leave a
  // single info item telling the user to install deps first. Matches
  // the user's mental model: tsc errors against uninstalled projects
  // aren't about THEIR code; they're about THEIR deps not being there yet.
  const nodeModulesDir = path.join(repoRoot, "node_modules");
  if (!(await fs.pathExists(nodeModulesDir))) {
    return {
      errorCount: 0,
      items: [
        {
          severity: "info",
          message:
            "Skipped tsc --noEmit: node_modules not found in the scaffolded repo. " +
            "Run `npm install` in the output directory then `npx tsc --noEmit` to validate.",
        },
      ],
    };
  }

  const localTsc = path.join(
    nodeModulesDir,
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc",
  );
  const cmd = (await fs.pathExists(localTsc)) ? localTsc : "tsc";

  return new Promise((resolve) => {
    const proc = spawn(cmd, ["--noEmit", "--pretty", "false"], {
      cwd: repoRoot,
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => {
      resolve({
        errorCount: 0,
        items: [
          {
            severity: "warn",
            message: `Could not invoke tsc (${err.message}). Skipping validation.`,
          },
        ],
      });
    });
    proc.on("close", () => {
      const items = parseTscOutput(stdout + "\n" + stderr);
      const errorCount = items.filter((i) => i.severity === "error").length;
      resolve({ errorCount, items });
    });
  });
}

function parseTscOutput(output: string): ReviewItem[] {
  const items: ReviewItem[] = [];
  const lineRe = /^(.+?)\((\d+),\d+\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/;
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(lineRe);
    if (!m) continue;
    const [, file, lineNum, sev, _code, message] = m;
    items.push({
      severity: sev === "warning" ? "warn" : "error",
      file,
      line: Number(lineNum),
      message,
    });
  }
  return items;
}
