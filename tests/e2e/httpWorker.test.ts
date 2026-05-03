/**
 * End-to-end test for the HTTP worker (Phase 3).
 *
 * Spins up the real Express app on a random port, drives it via fetch,
 * polls for job completion, and verifies the artifact endpoint returns
 * a real zip stream.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "path";
import type { Server } from "http";
import { createApp } from "../../src/server";

const fixtureFeature = path.resolve(
  __dirname,
  "..",
  "..",
  "examples",
  "practice-test-login",
  "login.feature",
);
const fixtureSnapshot = path.resolve(
  __dirname,
  "..",
  "..",
  "examples",
  "practice-test-login",
  "snapshot.json",
);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function pollJob(jobId: string, timeoutMs = 30_000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${baseUrl}/jobs/${jobId}`);
    const body = await res.json();
    if (body.status === "completed" || body.status === "failed") return body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
}

describe("HTTP /healthz + /version + /readyz", () => {
  it("/healthz responds", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("/version returns name and version", async () => {
    const res = await fetch(`${baseUrl}/version`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("@vijaypjavvadi/bdd2pw");
    expect(body.version).toBeTruthy();
  });

  it("/readyz responds", async () => {
    const res = await fetch(`${baseUrl}/readyz`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("POST /scaffold with validation errors", () => {
  it("returns 400 when body is missing required fields", async () => {
    const res = await fetch(`${baseUrl}/scaffold`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "x" }), // missing url, page, repo
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("ValidationError");
    expect(Array.isArray(body.details)).toBe(true);
  });

  it("returns 400 when url is malformed", async () => {
    const res = await fetch(`${baseUrl}/scaffold`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        feature: "x",
        url: "not-a-url",
        page: "P",
        repo: "/r",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /scaffold worker → end-to-end", () => {
  let jobId: string;
  let finalJob: any;

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/scaffold`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        feature: fixtureFeature,
        url: "https://practicetestautomation.com/practice-test-login/",
        page: "LoginPage",
        repo: "/ignored-by-worker", // worker overrides with per-job tmpdir
        options: { snapshotFile: fixtureSnapshot, noValidate: true },
      }),
    });
    expect(res.status).toBe(202);
    const accepted = await res.json();
    jobId = accepted.jobId;
    expect(jobId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
    expect(accepted.links.self).toBe(`/jobs/${jobId}`);
    expect(accepted.links.artifact).toBe(`/jobs/${jobId}/artifact`);

    finalJob = await pollJob(jobId);
  }, 35_000);

  it("job reaches status=completed", () => {
    expect(finalJob.status).toBe("completed");
    expect(finalJob.stage).toBe("completed");
    expect(finalJob.progress).toBe(1);
  });

  it("job result contains the scaffolded file paths", () => {
    expect(Array.isArray(finalJob.result.filesWritten)).toBe(true);
    expect(finalJob.result.filesWritten.length).toBeGreaterThanOrEqual(7);
    // at least pages/login.page.ts and tests/login.spec.ts should be there
    const joined = finalJob.result.filesWritten.join("|");
    expect(joined).toMatch(/login\.page\.ts/);
    expect(joined).toMatch(/login\.spec\.ts/);
  });

  it("zero warnings (regression: practice-test-login is fully clean)", () => {
    expect(finalJob.warnings).toEqual([]);
  });

  it("GET /jobs/:id/artifact returns a real zip", async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/artifact`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain(`bdd2pw-${jobId}.zip`);

    const buf = Buffer.from(await res.arrayBuffer());
    // ZIP local file header magic bytes: 0x50 0x4B 0x03 0x04 ("PK\x03\x04")
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
    expect(buf.length).toBeGreaterThan(500); // sanity — the scaffold emits ~7 files
  });

  it("GET /jobs/:id/log returns a text dump", async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/log`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    const text = await res.text();
    expect(text).toContain(`Job ${jobId}`);
    expect(text).toContain("status=completed");
  });
});

describe("GET /jobs/:id/artifact failure modes", () => {
  it("404 when job doesn't exist", async () => {
    const res = await fetch(`${baseUrl}/jobs/01HXNONEXISTENT0000000000/artifact`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("JobNotFound");
  });
});
