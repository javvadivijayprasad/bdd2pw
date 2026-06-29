import { test, expect } from "@playwright/test";
import { FormAuthPage } from "../pages/form-auth.page";

test.describe("the-internet form authentication", () => {

  test("Successful login", async ({ page }, testInfo) => {
    const formAuthPage = new FormAuthPage(page);

    await test.step("Given I am on the form auth page", async () => {
      await formAuthPage.goto();
    });

    await test.step("When I enter \"tomsmith\" as my username", async () => {
      await formAuthPage.usernameInput.fill("tomsmith");
    });

    await test.step("And I enter \"SuperSecretPassword!\" as my password", async () => {
      await formAuthPage.passwordInput.fill("SuperSecretPassword!");
    });

    await test.step("And I click the Login button", async () => {
      await formAuthPage.loginButton.click();
    });

    await test.step("Then I should see the success message \"You logged into a secure area!\"", async () => {
      await expect(formAuthPage.page.getByText("You logged into a secure area!")).toHaveText("You logged into a secure area!");
    });
  });

  test("Invalid username rejected", async ({ page }, testInfo) => {
    const formAuthPage = new FormAuthPage(page);

    await test.step("Given I am on the form auth page", async () => {
      await formAuthPage.goto();
    });

    await test.step("When I enter \"invalid_user\" as my username", async () => {
      await formAuthPage.usernameInput.fill("invalid_user");
    });

    await test.step("And I enter \"wrong_pw\" as my password", async () => {
      await formAuthPage.passwordInput.fill("wrong_pw");
    });

    await test.step("And I click the Login button", async () => {
      await formAuthPage.loginButton.click();
    });

    await test.step("Then I should see the error message \"Your username is invalid!\"", async () => {
      await expect(formAuthPage.thisIsWhereYouCanLogIntoTheSecureAreaEnterTomsmithForTheUsernameAndSuperSecretPasswordForThePasswordIfTheInformationIsWrongYouShouldSeeErrorMessagesHeading).toContainText("Your username is invalid!");
    });
  });

  test("Logout from secure area", async ({ page }, testInfo) => {
    const formAuthPage = new FormAuthPage(page);

    await test.step("Given I am logged in to the secure area", async () => {
      await formAuthPage.goto();
      await formAuthPage.usernameInput.fill("tomsmith");
      await formAuthPage.passwordInput.fill("SuperSecretPassword!");
      await formAuthPage.loginButton.click();
    });

    await test.step("When I click the Logout button", async () => {
      await formAuthPage.loginButton.click();
    });

    await test.step("Then I should see the success message \"You logged out of the secure area!\"", async () => {
      await expect(formAuthPage.page.getByText("You logged out of the secure area!")).toHaveText("You logged out of the secure area!");
    });
  });

  test("Visit dynamic loading page", async ({ page }, testInfo) => {
    const formAuthPage = new FormAuthPage(page);

    await test.step("Given I am on the dynamic loading page", async () => {
      await formAuthPage.goto();
    });

    await test.step("When I click the Start button", async () => {
      await formAuthPage.loginButton.click();
    });

    await test.step("Then I should see the text \"Hello World!\"", async () => {
      await expect(formAuthPage.page.getByText("Hello World!")).toHaveText("Hello World!");
    });
  });
});
