/**
 * Wrapper for the ai-governance sidecar's `/sanitize` endpoint.
 *
 * Per `E:\EB1A_Research\ai-governance\service\app.py`:
 *
 *   POST /sanitize
 *     body: { kind: "code", content: string }
 *     200:  { kind: "code", sanitised: string, findings: [] }
 *
 * v2.0 (this file): we send the LLM PROMPT (the user-message content
 * built in `prompt.ts`) as kind="code" — `code` re-uses the log-rule
 * scrubber to redact secrets that might leak via test data in the
 * .feature file.
 *
 * v1.x note: the original Phase 4 stub here imagined a unified
 * "callViaGovernance" RPC that the sidecar would proxy to providers.
 * That's NOT the actual sidecar API — the sidecar is a sanitiser, not
 * an LLM proxy. bdd2pw owns the provider call; the sidecar just scrubs
 * the payload first.
 *
 * Fail-closed: if the sidecar is unreachable or returns a non-2xx, we
 * REFUSE to call the LLM. Better to degrade to TODO than leak unsanitised
 * payloads. The caller can pass `skipGovernance: true` for unit tests
 * (NOT for production).
 */

import { request } from "undici";

export interface SanitiseResult {
  sanitised: string;
  findings: Array<Record<string, unknown>>;
}

export class GovernanceUnreachableError extends Error {
  constructor(url: string, cause?: unknown) {
    super(
      `ai-governance sidecar unreachable at ${url}. Start it with: ` +
        `'uvicorn service.app:app --port 4900' from the ai-governance repo, ` +
        `or pass --skip-governance for non-production runs (NOT recommended). ` +
        (cause instanceof Error ? `Underlying error: ${cause.message}` : ""),
    );
    this.name = "GovernanceUnreachableError";
  }
}

/** Legacy alias kept for backwards-compat with any external imports. */
export class GovernanceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GovernanceError";
  }
}

export class GovernanceClient {
  private baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async sanitiseCode(content: string): Promise<SanitiseResult> {
    const url = `${this.baseUrl}/sanitize`;
    let res;
    try {
      res = await request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "code", content }),
      });
    } catch (err) {
      throw new GovernanceUnreachableError(url, err);
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const body = await res.body.text().catch(() => "(no body)");
      throw new Error(
        `ai-governance /sanitize returned ${res.statusCode}: ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.body.json()) as {
      sanitised?: string;
      findings?: Array<Record<string, unknown>>;
    };
    return {
      sanitised: json.sanitised ?? content,
      findings: json.findings ?? [],
    };
  }

  /** Probe `/health` — used at startup to fail-fast before the first scaffold. */
  async health(): Promise<boolean> {
    try {
      const res = await request(`${this.baseUrl}/health`);
      return res.statusCode === 200;
    } catch {
      return false;
    }
  }
}
