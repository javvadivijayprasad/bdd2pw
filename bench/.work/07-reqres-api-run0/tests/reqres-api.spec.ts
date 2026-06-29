import { test, expect, type APIResponse } from "@playwright/test";
import { ReqresApi } from "../pages/reqres-api.page";

test.describe("Reqres API smoke", () => {
  let apiResponse: APIResponse | null = null;
  let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";
  let _lastApiReq: { method: string; path: string; data?: unknown; headers?: Record<string, string> } = { method: "", path: "" };

  test("List users on page 2", async ({ page }, testInfo) => {
    apiResponse = null;
    const reqresApi = new ReqresApi(page);

    await test.step("Given the base URL is \"https://reqres.in\"", async () => {
      await reqresApi.goto();
    });

    await test.step("When I send a GET request to \"/api/users?page=2\"", async () => {
      _lastApiReq = { method: "get", path: "/api/users?page=2" };
      apiResponse = await page.request.get(baseUrl + "/api/users?page=2");
    });

    await test.step("Then the response status code should be 200", async () => {
      // TODO: capture API response and assert status
      // Example: const response = await page.request.get('https://reqres.in/api/users?page=2');
      // expect(response.status()).toBe(200);
    });

    await test.step("And the response body should have field \"page\" equal to 2", async () => {
      // TODO: parse response body and assert field value
      // Example: const body = await response.json();
      // expect(body['page']).toBe(2);
    });

    await test.step("And the response body should have field \"data\" as an array", async () => {
      // TODO: parse response body and assert field is an array
      // Example: const body = await response.json();
      // expect(Array.isArray(body['data'])).toBe(true);
    });
  });

  test("Create a user", async ({ page }, testInfo) => {
    apiResponse = null;
    const reqresApi = new ReqresApi(page);

    await test.step("Given the base URL is \"https://reqres.in\"", async () => {
      await reqresApi.goto();
    });

    await test.step("When I send a POST request to \"/api/users\" with body:", async () => {
      _lastApiReq = { method: "post", path: "/api/users", data: {
          "name": "bench",
          "job": "qa"
        }, headers: { "content-type": "application/json" } };
      apiResponse = await page.request.post(baseUrl + "/api/users", {
        data: {
          "name": "bench",
          "job": "qa"
        },
        headers: { "content-type": "application/json" },
      });
    });

    await test.step("Then the response status code should be 201", async () => {
      // TODO: capture API response earlier in the scenario and assert its status
      // e.g. expect(response.status()).toBe(201);
    });

    await test.step("And the response body should have field \"name\" equal to \"bench\"", async () => {
      // TODO: capture API response body earlier in the scenario and assert field value
      // e.g. const body = await response.json();
      // expect(body.name).toBe("bench");
    });

    await test.step("And the response body should have field \"id\"", async () => {
      // TODO: capture API response body earlier in the scenario and assert field existence
      // e.g. const body = await response.json();
      // expect(body).toHaveProperty("id");
    });
  });

  test("Delete a user returns 204", async ({ page }, testInfo) => {
    apiResponse = null;
    const reqresApi = new ReqresApi(page);

    await test.step("Given the base URL is \"https://reqres.in\"", async () => {
      await reqresApi.goto();
    });

    await test.step("When I send a DELETE request to \"/api/users/2\"", async () => {
      _lastApiReq = { method: "delete", path: "/api/users/2" };
      apiResponse = await page.request.delete(baseUrl + "/api/users/2");
    });

    await test.step("Then the response status code should be 204", async () => {
      // TODO: capture the API response object earlier in the scenario and assert its status
      // e.g. expect(response.status()).toBe(204);
    });
  });
});
