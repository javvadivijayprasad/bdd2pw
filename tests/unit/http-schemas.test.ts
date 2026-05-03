import { describe, it, expect } from "vitest";
import {
  ScaffoldRequestSchema,
  AnalyzeRequestSchema,
  UpdatePomRequestSchema,
} from "../../src/http/schemas";

describe("HTTP request schemas", () => {
  describe("ScaffoldRequestSchema", () => {
    it("accepts a minimal valid request", () => {
      const result = ScaffoldRequestSchema.safeParse({
        feature: "/abs/login.feature",
        url: "https://example.com/login",
        page: "LoginPage",
        repo: "/abs/repo",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing url", () => {
      const result = ScaffoldRequestSchema.safeParse({
        feature: "x",
        page: "LoginPage",
        repo: "/abs",
      });
      expect(result.success).toBe(false);
    });

    it("rejects malformed url", () => {
      const result = ScaffoldRequestSchema.safeParse({
        feature: "x",
        url: "not-a-url",
        page: "LoginPage",
        repo: "/abs",
      });
      expect(result.success).toBe(false);
    });

    it("accepts full options block", () => {
      const result = ScaffoldRequestSchema.safeParse({
        feature: "/abs/login.feature",
        url: "https://example.com/login",
        page: "LoginPage",
        repo: "/abs/repo",
        options: {
          pages: ["LoginPage", "DashboardPage"],
          headed: true,
          llm: "anthropic",
          telemetry: true,
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects unknown llm provider", () => {
      const result = ScaffoldRequestSchema.safeParse({
        feature: "x",
        url: "https://example.com",
        page: "LoginPage",
        repo: "/abs",
        options: { llm: "made-up" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("AnalyzeRequestSchema", () => {
    it("accepts a minimal valid request", () => {
      const result = AnalyzeRequestSchema.safeParse({
        feature: "/abs/login.feature",
        url: "https://example.com/login",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("UpdatePomRequestSchema", () => {
    it("accepts a minimal valid request", () => {
      const result = UpdatePomRequestSchema.safeParse({
        page: "LoginPage",
        url: "https://example.com/login",
        repo: "/abs/repo",
      });
      expect(result.success).toBe(true);
    });
  });
});
