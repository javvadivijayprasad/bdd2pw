/**
 * HTTP service entry. Express :4300. See docs/SCOPE.md §8b
 * and docs/ARCHITECTURE.md §3 + §6.
 */

import express, { Application } from "express";
import { logger } from "./utils/logger";
import { mountRoutes } from "./http/routes";

export interface ServerOptions {
  port?: number;
}

export function createApp(): Application {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/version", (_req, res) =>
    res.json({
      name: "@vijaypjavvadi/bdd2pw",
      version: require("../package.json").version,
      commit: process.env.GIT_COMMIT ?? "unknown",
    }),
  );

  mountRoutes(app);

  return app;
}

export async function startServer(opts: ServerOptions = {}): Promise<void> {
  const port = opts.port ?? 4300;
  const app = createApp();
  app.listen(port, () => {
    logger.info({ port }, "bdd2pw HTTP service listening");
  });
}

if (require.main === module) {
  startServer({ port: Number(process.env.PORT ?? 4300) }).catch((err) => {
    logger.error({ err }, "server failed to start");
    process.exit(1);
  });
}
