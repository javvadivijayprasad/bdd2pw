/**
 * Express route registrations for the HTTP API.
 * See docs/SCOPE.md §8b and docs/ARCHITECTURE.md §3 + §6.
 *
 * Phase 3: workers are wired. Each `POST` accepts → 202 + jobId, then a
 * Promise worker calls the real `scaffold()` / `analyze()` / `updatePom()`
 * and updates the job state. `GET /jobs/:id/artifact` streams a zip of
 * the output dir for `scaffold` jobs.
 */

import type { Application, Request, Response } from "express";
import * as os from "os";
import * as path from "path";
import * as fs from "fs-extra";
import {
  ScaffoldRequestSchema,
  AnalyzeRequestSchema,
  UpdatePomRequestSchema,
} from "./schemas";
import { createJob, getJob, updateJob } from "./jobs";
import { streamArtifactZip } from "./artifacts";
import { scaffold, analyze, updatePom } from "../index";
import { logger } from "../utils/logger";

export function mountRoutes(app: Application): void {
  app.get("/readyz", (_req, res) => {
    res.json({ ok: true, mcp: "unknown", governance: "unknown" });
  });

  app.post("/scaffold", (req: Request, res: Response) => {
    const parsed = ScaffoldRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "ValidationError", details: parsed.error.errors });
    }
    const job = createJob();
    logger.info({ jobId: job.id, kind: "scaffold" }, "job accepted");

    // Per-job artifact directory under tmpdir.
    const artifactDir = path.join(os.tmpdir(), "bdd2pw-jobs", job.id);
    updateJob(job.id, { status: "running", stage: "queued", artifactDir });

    void runScaffoldWorker(job.id, parsed.data, artifactDir);

    return res.status(202).json({
      jobId: job.id,
      links: {
        self: `/jobs/${job.id}`,
        artifact: `/jobs/${job.id}/artifact`,
      },
    });
  });

  app.post("/analyze", (req: Request, res: Response) => {
    const parsed = AnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "ValidationError", details: parsed.error.errors });
    }
    const job = createJob();
    logger.info({ jobId: job.id, kind: "analyze" }, "job accepted");
    updateJob(job.id, { status: "running", stage: "parsing" });

    void runAnalyzeWorker(job.id, parsed.data);

    return res.status(202).json({
      jobId: job.id,
      links: { self: `/jobs/${job.id}`, artifact: `/jobs/${job.id}/artifact` },
    });
  });

  app.post("/update-pom", (req: Request, res: Response) => {
    const parsed = UpdatePomRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "ValidationError", details: parsed.error.errors });
    }
    const job = createJob();
    logger.info({ jobId: job.id, kind: "update-pom" }, "job accepted");
    updateJob(job.id, { status: "running", stage: "scanning_repo" });

    void runUpdatePomWorker(job.id, parsed.data);

    return res.status(202).json({
      jobId: job.id,
      links: { self: `/jobs/${job.id}`, artifact: `/jobs/${job.id}/artifact` },
    });
  });

  app.get("/jobs/:id", (req: Request, res: Response) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "JobNotFound" });
    return res.json(job);
  });

  app.get("/jobs/:id/artifact", async (req: Request, res: Response) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "JobNotFound" });
    if (job.status !== "completed" || !job.artifactDir) {
      return res
        .status(409)
        .json({ error: "ArtifactNotReady", status: job.status });
    }
    if (!(await fs.pathExists(job.artifactDir))) {
      return res
        .status(410)
        .json({ error: "ArtifactExpired", message: "Artifact directory no longer exists." });
    }
    try {
      await streamArtifactZip(res, job.artifactDir, job.id);
    } catch (err) {
      logger.error({ jobId: job.id, err }, "artifact stream failed");
      // Headers may already be flushed; best we can do is end the response.
      if (!res.headersSent) {
        res.status(500).json({ error: "StreamFailed", message: (err as Error).message });
      } else {
        res.end();
      }
    }
  });

  app.get("/jobs/:id/log", (req: Request, res: Response) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "JobNotFound" });
    // v1.0 returns the in-memory job record's warnings + errors as a flat
    // text dump. Real per-job log file tailing is a v1.1 enhancement once
    // pino multi-stream routing is wired.
    res.type("text/plain");
    const lines: string[] = [];
    lines.push(`# Job ${job.id} — status=${job.status} stage=${job.stage}`);
    lines.push(`# created=${job.createdAt} updated=${job.updatedAt}`);
    lines.push("");
    for (const w of job.warnings) lines.push(`[warn] ${w.message}`);
    for (const e of job.errors) lines.push(`[error] ${e.message}`);
    res.send(lines.join("\n"));
  });
}

// ─── Workers ───────────────────────────────────────────────────────────────

async function runScaffoldWorker(
  jobId: string,
  body: { feature: string; url: string; page: string; repo: string; options?: any },
  artifactDir: string,
): Promise<void> {
  try {
    updateJob(jobId, { stage: "parsing", progress: 0.1 });
    // Override the caller-provided repo with our per-job artifact dir so we
    // don't write outside the sandbox. The caller can still download the
    // result via GET /jobs/:id/artifact.
    const opts = {
      feature: body.feature,
      url: body.url,
      page: body.page,
      repo: artifactDir,
      pages: body.options?.pages,
      storageState: body.options?.storageState,
      headed: body.options?.headed,
      llm: body.options?.llm,
      governanceUrl: body.options?.governanceUrl,
      templates: body.options?.templates,
      noValidate: body.options?.noValidate,
      telemetry: body.options?.telemetry,
      force: body.options?.force,
      snapshotFile: body.options?.snapshotFile,
      noDiscovery: body.options?.noDiscovery,
    };
    updateJob(jobId, { stage: "emitting", progress: 0.5 });
    const result = await scaffold(opts);
    updateJob(jobId, {
      status: "completed",
      stage: "completed",
      progress: 1,
      result,
      warnings: result.reviewItems.filter((i) => i.severity === "warn"),
      errors: result.reviewItems.filter((i) => i.severity === "error"),
    });
    logger.info({ jobId, files: result.filesWritten.length }, "scaffold worker complete");
  } catch (err) {
    logger.error({ jobId, err }, "scaffold worker failed");
    updateJob(jobId, {
      status: "failed",
      stage: "failed",
      errors: [{ severity: "error", message: (err as Error).message }],
    });
  }
}

async function runAnalyzeWorker(
  jobId: string,
  body: { feature: string; url: string; options?: any },
): Promise<void> {
  try {
    updateJob(jobId, { stage: "parsing", progress: 0.2 });
    const result = await analyze({
      feature: body.feature,
      url: body.url,
      storageState: body.options?.storageState,
      headed: body.options?.headed,
    });
    updateJob(jobId, {
      status: "completed",
      stage: "completed",
      progress: 1,
      result,
      warnings: result.warnings,
    });
    logger.info({ jobId }, "analyze worker complete");
  } catch (err) {
    logger.error({ jobId, err }, "analyze worker failed");
    updateJob(jobId, {
      status: "failed",
      stage: "failed",
      errors: [{ severity: "error", message: (err as Error).message }],
    });
  }
}

async function runUpdatePomWorker(
  jobId: string,
  body: { page: string; url: string; repo: string; options?: any },
): Promise<void> {
  try {
    updateJob(jobId, { stage: "scanning_repo", progress: 0.2 });
    const result = await updatePom({
      page: body.page,
      url: body.url,
      repo: body.repo,
      storageState: body.options?.storageState,
      headed: body.options?.headed,
      templates: body.options?.templates,
    });
    updateJob(jobId, {
      status: "completed",
      stage: "completed",
      progress: 1,
      result,
      warnings: result.reviewItems.filter((i) => i.severity === "warn"),
      // updatePom modifies the user's repo directly; no artifact dir for download
      artifactDir: undefined,
    });
    logger.info({ jobId, addedFields: result.added.fields }, "update-pom worker complete");
  } catch (err) {
    logger.error({ jobId, err }, "update-pom worker failed");
    updateJob(jobId, {
      status: "failed",
      stage: "failed",
      errors: [{ severity: "error", message: (err as Error).message }],
    });
  }
}
