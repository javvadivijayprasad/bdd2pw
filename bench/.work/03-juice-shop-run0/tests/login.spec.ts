import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/login.page";

test.describe("OWASP Juice Shop authentication", () => {

  test("Register a new account", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the Juice Shop login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I click the Not yet a customer link", async () => {
      await loginPage.notYetACustomerLink.click();
    });

    await test.step("And I enter \"bench@example.com\" as my email", async () => {
      await loginPage.email.fill("bench@example.com");
    });

    await test.step("And I enter \"ValidPass1!\" as my password", async () => {
      await loginPage.password.fill("ValidPass1!");
    });

    await test.step("And I enter \"ValidPass1!\" as my password confirmation", async () => {
      await page.getByLabel('Password Confirmation *').first().fill('ValidPass1!');
    });

    await test.step("And I select \"Your eldest siblings middle name?\" as my security question", async () => {
      await page.getByLabel('Security Question').first().selectOption('Your eldest siblings middle name?');
    });

    await test.step("And I enter \"Alex\" as my security answer", async () => {
      await page.getByLabel('Answer *').first().fill('Alex');
    });

    await test.step("And I click the Register button", async () => {
      await page.getByRole('button', { name: 'Register' }).first().click();
    });

    await test.step("Then I should see the success message \"Registration completed successfully\"", async () => {
      await expect(loginPage.page.getByText("Registration completed successfully")).toHaveText("Registration completed successfully");
    });
  });

  test("Login with existing credentials", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the Juice Shop login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I enter \"bench@example.com\" as my email", async () => {
      await loginPage.email.fill("bench@example.com");
    });

    await test.step("And I enter \"ValidPass1!\" as my password", async () => {
      await loginPage.password.fill("ValidPass1!");
    });

    await test.step("And I click the Log in button", async () => {
      await loginPage.loginButton.click();
    });

    await test.step("Then I should be on the search page", async () => {
      await expect(page).toHaveURL(new RegExp('/search'));
    });
  });

  test("Login with invalid credentials", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the Juice Shop login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I enter \"invalid@example.com\" as my email", async () => {
      await loginPage.email.fill("invalid@example.com");
    });

    await test.step("And I enter \"wrong\" as my password", async () => {
      await loginPage.password.fill("wrong");
    });

    await test.step("And I click the Log in button", async () => {
      await loginPage.loginButton.click();
    });

    await test.step("Then I should see the error message \"Invalid email or password\"", async () => {
      await expect(loginPage.page.getByText("Invalid email or password")).toContainText("Invalid email or password");
    });
  });
});
