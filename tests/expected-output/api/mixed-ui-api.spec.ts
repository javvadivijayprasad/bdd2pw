import { test, expect, type APIResponse } from "@playwright/test";

test.describe("Feature: Mixed UI and API in one scenario", () => {
  let apiResponse: APIResponse | null = null;
  let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";
  let _lastApiReq: { method: string; path: string; data?: unknown; headers?: Record<string, string> } = { method: "", path: "" };

  // @ui
  // @api
  test("Submit the contact form via UI and verify via API", async ({ page }, testInfo) => {
    apiResponse = null;
    await test.step("Given I am on the contact page", async () => {
      await contactPage.goto();
    });

    await test.step("When I enter \"alice@example.com\" into the email field", async () => {
      await contactPage.emailInput.fill("alice@example.com");
    });

    await test.step("And I click the submit button", async () => {
      await contactPage.submitButton.click();
    });

    await test.step("Then I should see \"Thanks!\"", async () => {
      await expect(contactPage.thanksBanner).toBeVisible();
    });

    await test.step("When I send a GET request to \"/api/contacts/latest\"", async () => {
      _lastApiReq = { method: "get", path: "/api/contacts/latest" };
      apiResponse = await page.request.get(baseUrl + "/api/contacts/latest");
    });

    await test.step("Then the response status is 200", async () => {
      expect(apiResponse!.status()).toBe(200);
    });

    await test.step("And the response body field \"email\" equals \"alice@example.com\"", async () => {
      const body = await apiResponse!.json();
      expect(body["email"]).toBe("alice@example.com");
    });
  });
});
