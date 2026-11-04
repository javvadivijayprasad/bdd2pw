import { test, expect, type APIResponse } from "@playwright/test";

test.describe("Feature: Simple GET request", () => {
  let apiResponse: APIResponse | null = null;
  let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";
  let _lastApiReq: { method: string; path: string; data?: unknown; headers?: Record<string, string> } = { method: "", path: "" };

  // @api
  // @smoke
  test("Fetch the root health endpoint", async ({ page }, testInfo) => {
    apiResponse = null;
    await test.step("When I send a GET request to \"/api/health\"", async () => {
      _lastApiReq = { method: "get", path: "/api/health" };
      apiResponse = await page.request.get(baseUrl + "/api/health");
    });

    await test.step("Then the response status is 200", async () => {
      expect(apiResponse!.status()).toBe(200);
    });
  });
});
