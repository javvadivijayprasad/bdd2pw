import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/login.page";

test.describe("SauceDemo authentication", () => {

  test("Standard user logs in successfully", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the SauceDemo login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I enter \"standard_user\" as my username", async () => {
      await loginPage.usernameInput.fill("standard_user");
    });

    await test.step("And I enter \"secret_sauce\" as my password", async () => {
      await loginPage.passwordInput.fill("secret_sauce");
    });

    await test.step("And I click the Login button", async () => {
      await loginPage.loginButton.click();
    });

    await test.step("Then the URL should contain \"inventory.html\"", async () => {
      await expect(loginPage.page).toHaveURL(new RegExp("inventory\\.html"));
    });
  });

  test("Locked-out user is rejected", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the SauceDemo login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I enter \"locked_out_user\" as my username", async () => {
      await loginPage.usernameInput.fill("locked_out_user");
    });

    await test.step("And I enter \"secret_sauce\" as my password", async () => {
      await loginPage.passwordInput.fill("secret_sauce");
    });

    await test.step("And I click the Login button", async () => {
      await loginPage.loginButton.click();
    });

    await test.step("Then I should see the error message \"Sorry, this user has been locked out\"", async () => {
      await expect(loginPage.errorMessageContainer).toContainText("Sorry, this user has been locked out");
    });
  });

  test("Empty credentials are rejected", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the SauceDemo login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I click the Login button", async () => {
      await loginPage.loginButton.click();
    });

    await test.step("Then I should see the error message \"Username is required\"", async () => {
      await expect(loginPage.errorMessageContainer).toContainText("Username is required");
    });
  });
});
