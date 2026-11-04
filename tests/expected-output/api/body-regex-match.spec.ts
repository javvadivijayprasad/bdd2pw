import { test, expect, type APIResponse } from "@playwright/test";

test.describe("Feature: Body field regex match", () => {
  let apiResponse: APIResponse | null = null;
  let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";
  let _lastApiReq: { method: string; path: string; data?: unknown; headers?: Record<string, string> } = { method: "", path: "" };

  // @api
  test("Generated user id is a UUID", async ({ page }, testInfo) => {
    apiResponse = null;
    await test.step("When I send a POST request to \"/api/users\" with body:", async () => {
      _lastApiReq = { method: "post", path: "/api/users", data: {
          "name": "Test User"
        }, headers: { "content-type": "application/json" } };
      apiResponse = await page.request.post(baseUrl + "/api/users", {
        data: {
          "name": "Test User"
        },
        headers: { "content-type": "application/json" },
      });
    });

    await test.step("Then the response status is 201", async () => {
      expect(apiResponse!.status()).toBe(201);
    });

    await test.step("And the response body field \"id\" matches /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/", async () => {
      const body = await apiResponse!.json();
      expect(body["id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });
});
