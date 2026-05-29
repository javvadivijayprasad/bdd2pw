import { test, expect, type APIResponse } from "@playwright/test";

test.describe("Feature: POST with JSON body", () => {
  let apiResponse: APIResponse | null = null;
  let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";
  let _lastApiReq: { method: string; path: string; data?: unknown; headers?: Record<string, string> } = { method: "", path: "" };

  // @api
  test("Successful login via API returns a token", async ({ page }, testInfo) => {
    apiResponse = null;
    await test.step("When I send a POST request to \"/api/auth/login\" with body:", async () => {
      _lastApiReq = { method: "post", path: "/api/auth/login", data: {
          "username": "student",
          "password": "Password123"
        }, headers: { "content-type": "application/json" } };
      apiResponse = await page.request.post(baseUrl + "/api/auth/login", {
        data: {
          "username": "student",
          "password": "Password123"
        },
        headers: { "content-type": "application/json" },
      });
    });

    await test.step("Then the response status is 200", async () => {
      expect(apiResponse!.status()).toBe(200);
    });

    await test.step("And the response body has a non-empty \"token\" field", async () => {
      const body = await apiResponse!.json();
      expect(body["token"]).toBeTruthy();
    });
  });
});
