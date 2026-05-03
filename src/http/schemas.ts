/**
 * Zod request/response validators for the HTTP API.
 * See docs/SCOPE.md §8b and docs/ARCHITECTURE.md §6.
 */

import { z } from "zod";

export const ScaffoldRequestSchema = z.object({
  feature: z.string().min(1),
  url: z.string().url(),
  page: z.string().min(1),
  repo: z.string().min(1),
  options: z
    .object({
      pages: z.array(z.string()).optional(),
      storageState: z.string().optional(),
      headed: z.boolean().optional(),
      llm: z.enum(["anthropic", "openai", "gemini"]).optional(),
      governanceUrl: z.string().url().optional(),
      templates: z.string().optional(),
      telemetry: z.boolean().optional(),
      noValidate: z.boolean().optional(),
      force: z.boolean().optional(),
    })
    .optional(),
});

export type ScaffoldRequest = z.infer<typeof ScaffoldRequestSchema>;

export const AnalyzeRequestSchema = z.object({
  feature: z.string().min(1),
  url: z.string().url(),
  options: z
    .object({
      storageState: z.string().optional(),
      headed: z.boolean().optional(),
    })
    .optional(),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const UpdatePomRequestSchema = z.object({
  page: z.string().min(1),
  url: z.string().url(),
  repo: z.string().min(1),
  options: z
    .object({
      storageState: z.string().optional(),
      headed: z.boolean().optional(),
      templates: z.string().optional(),
    })
    .optional(),
});

export type UpdatePomRequest = z.infer<typeof UpdatePomRequestSchema>;

export const JobAcceptedSchema = z.object({
  jobId: z.string(),
  links: z.object({
    self: z.string(),
    artifact: z.string(),
  }),
});

export type JobAccepted = z.infer<typeof JobAcceptedSchema>;
