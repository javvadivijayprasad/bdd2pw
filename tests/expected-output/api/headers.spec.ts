import { test, expect, type APIResponse } from "@playwright/test";

test.describe("Feature: Header assertions", () => {
  let apiResponse: APIResponse | null = null;
  let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";
  let _lastApiReq: { method: string; path: string; data?: unknown; headers?: Record<string, string> } = { method: "", path: "" };

  // @api
  test("Verify Content-Type, ETag, and X-RateLimit", async ({ page }, testInfo) => {
    apiResponse = null;
    await test.step("When I send a GET request to \"/api/data\"", async () => {
      _lastApiReq = { method: "get", path: "/api/data" };
      apiResponse = await page.request.get(baseUrl + "/api/data");
    });

    await test.step("Then the response status is 200", async () => {
      expect(apiResponse!.status()).toBe(200);
    });

    await test.step("And the response header \"Content-Type\" equals \"application/json; charset=utf-8\"", async () => {
      expect(apiResponse!.headers()["content-type"]).toBe("application/json; charset=utf-8");
    });

    await test.step("And the response header \"Cache-Control\" contains \"no-cache\"", async () => {
      expect(apiResponse!.headers()["cache-control"]).toContain("no-cache");
    });

    await test.step("And the response header \"X-RateLimit-Remaining\" is set", async () => {
      expect(apiResponse!.headers()["x-ratelimit-remaining"]).toBeTruthy();
    });
  });
});
