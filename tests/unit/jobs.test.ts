import { describe, it, expect, beforeEach } from "vitest";
import {
  createJob,
  getJob,
  updateJob,
  sweepJobs,
  _resetForTests,
} from "../../src/http/jobs";

describe("job store", () => {
  beforeEach(() => _resetForTests());

  it("creates a job in 'queued' state", () => {
    const job = createJob();
    expect(job.status).toBe("queued");
    expect(job.stage).toBe("queued");
    expect(job.progress).toBe(0);
    expect(job.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i); // ULID
  });

  it("retrieves a job by id", () => {
    const created = createJob();
    const fetched = getJob(created.id);
    expect(fetched?.id).toBe(created.id);
  });

  it("returns undefined for unknown id", () => {
    expect(getJob("nonexistent")).toBeUndefined();
  });

  it("updates a job and bumps updatedAt", async () => {
    const created = createJob();
    await new Promise((r) => setTimeout(r, 5));
    const updated = updateJob(created.id, { status: "running", progress: 0.5 });
    expect(updated?.status).toBe("running");
    expect(updated?.progress).toBe(0.5);
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(
      Date.parse(created.updatedAt),
    );
  });

  it("sweeps jobs older than the cutoff", () => {
    const job = createJob();
    // Negative maxAge → cutoff is in the future → every existing job qualifies
    const removed = sweepJobs(-1000);
    expect(removed).toBe(1);
    expect(getJob(job.id)).toBeUndefined();
  });

  it("does NOT sweep jobs that are still fresh", () => {
    createJob();
    const removed = sweepJobs(60_000); // anything younger than 60s is kept
    expect(removed).toBe(0);
  });
});
