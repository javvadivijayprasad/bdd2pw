import { test, expect, type APIResponse } from "@playwright/test";

test.describe("Feature: Status code accepted from a list", () => {
  let apiResponse: APIResponse | null = null;
  let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";
  let _lastApiReq: { method: string; path: string; data?: unknown; headers?: Record<string, string> } = { method: "", path: "" };

  // @api
  test("Health endpoint may return 200 or 204", async ({ page }, testInfo) => {
    apiResponse = null;
    await test.step("When I send a GET request to \"/api/health\"", async () => {
      _lastApiReq = { method: "get", path: "/api/health" };
      apiResponse = await page.request.get(baseUrl + "/api/health");
    });

    await test.step("Then the response status is in [200, 204]", async () => {
      expect([200, 204]).toContain(apiResponse!.status());
    });

    await test.step("And the response status is less than 300", async () => {
      expect(apiResponse!.status()).toBeLessThan(300);
    });
  });
});
