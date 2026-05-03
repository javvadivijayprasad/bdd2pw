/**
 * Structured logger. JSON to stdout. Pretty-print only when TTY + DEBUG set.
 */

import pino from "pino";

const isTty = process.stdout.isTTY === true;
const debug = process.env.DEBUG === "1" || process.env.DEBUG === "true";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (debug ? "debug" : "info"),
  base: { app: "bdd2pw" },
  ...(isTty && debug
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l" },
        },
      }
    : {}),
});

export type Logger = typeof logger;
