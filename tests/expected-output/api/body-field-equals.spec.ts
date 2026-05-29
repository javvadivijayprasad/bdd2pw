import { test, expect, type APIResponse } from "@playwright/test";

test.describe("Feature: Body field equality (string and numeric)", () => {
  let apiResponse: APIResponse | null = null;
  let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";
  let _lastApiReq: { method: string; path: string; data?: unknown; headers?: Record<string, string> } = { method: "", path: "" };

  // @api
  test("Fetch a user and verify fields", async ({ page }, testInfo) => {
    apiResponse = null;
    await test.step("When I send a GET request to \"/api/users/42\"", async () => {
      _lastApiReq = { method: "get", path: "/api/users/42" };
      apiResponse = await page.request.get(baseUrl + "/api/users/42");
    });

    await test.step("Then the response status is 200", async () => {
      expect(apiResponse!.status()).toBe(200);
    });

    await test.step("And the response body field \"username\" equals \"alice\"", async () => {
      const body = await apiResponse!.json();
      expect(body["username"]).toBe("alice");
    });

    await test.step("And the response body field \"id\" equals 42", async () => {
      const body = await apiResponse!.json();
      expect(body["id"]).toBe(42);
    });
  });
});
