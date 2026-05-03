/**
 * Zip + stream a job's artefact directory to the client via `archiver`.
 * Excludes `node_modules`, `.git`, `test-results`, `playwright-report`.
 *
 * Headers set:
 *   Content-Type: application/zip
 *   Content-Disposition: attachment; filename="bdd2pw-<jobId>.zip"
 *
 * Streamed (not buffered), so very large outputs don't blow worker memory.
 * Caller is responsible for catching errors and falling back gracefully
 * if headers haven't been sent yet.
 */

import type { Response } from "express";
import archiver from "archiver";

export async function streamArtifactZip(
  res: Response,
  artifactDir: string,
  jobId: string,
): Promise<void> {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="bdd2pw-${jobId}.zip"`,
  );

  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => reject(err));
    archive.on("end", () => resolve());
    archive.pipe(res);
    archive.glob("**/*", {
      cwd: artifactDir,
      dot: true,
      ignore: ["node_modules/**", ".git/**", "test-results/**", "playwright-report/**"],
    });
    void archive.finalize();
  });
}
