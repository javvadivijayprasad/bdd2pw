import { test, expect, type APIResponse } from "@playwright/test";

test.describe("Feature: POST with custom header", () => {
  let apiResponse: APIResponse | null = null;
  let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";
  let _lastApiReq: { method: string; path: string; data?: unknown; headers?: Record<string, string> } = { method: "", path: "" };

  // @api
  test("Submit a comment with an idempotency key", async ({ page }, testInfo) => {
    apiResponse = null;
    await test.step("When I send a POST request to \"/api/comments\" with header \"Idempotency-Key\" set to \"abc-123\"", async () => {
      _lastApiReq = { method: "post", path: "/api/comments", headers: { "Idempotency-Key": "abc-123" } };
      apiResponse = await page.request.post(baseUrl + "/api/comments", {
        headers: { "Idempotency-Key": "abc-123" },
      });
    });

    await test.step("Then the response status is 201", async () => {
      expect(apiResponse!.status()).toBe(201);
    });

    await test.step("And the response header \"Content-Type\" contains \"application/json\"", async () => {
      expect(apiResponse!.headers()["content-type"]).toContain("application/json");
    });
  });
});
