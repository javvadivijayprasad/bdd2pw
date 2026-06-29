import { test, expect } from "@playwright/test";
import { AuthenticationPage } from "../pages/authentication.page";

test.describe("PrestaShop AutomationPractice journey", () => {

  test("Create an account", async ({ page }, testInfo) => {
    const authenticationPage = new AuthenticationPage(page);

    await test.step("Given I am on the authentication page", async () => {
      await authenticationPage.goto();
    });

    await test.step("[SKIPPED] When I enter \"bench@example.com\" as my account email", async () => {
      // TODO: no rule matched: "When I enter "bench@example.com" as my account email" (LLM fallback also failed: Could not parse binding for step 0 ("I enter "bench@example.com" as my account email"); slot was: {"step":{"keyword":"When","text":"I enter \"bench@example.com\" as my account email"},"pomCall":{"page":"authenticationPage","method":"fill","args":["page.getByLabel('Email').first()","\"bench@example)
    });

    await test.step("[SKIPPED] And I click the Create an account button", async () => {
      // TODO: no rule matched: "And I click the Create an account button" (LLM fallback also failed: Could not parse binding for step 1 ("I click the Create an account button"); slot was: {"step":{"keyword":"And","text":"I click the Create an account button"},"pomCall":{"page":"authenticationPage","method":"click","args":["page.getByRole('button', { name: 'Create an account' }).first())
    });

    await test.step("Then I should see the account registration form", async () => {
      await expect(authenticationPage.page.getByText("account registration form")).toBeVisible();
    });
  });

  test("Sign in with existing account", async ({ page }, testInfo) => {
    const authenticationPage = new AuthenticationPage(page);

    await test.step("Given I am on the authentication page", async () => {
      await authenticationPage.goto();
    });

    await test.step("[SKIPPED] When I enter \"bench@example.com\" as my email", async () => {
      // TODO: no rule matched: "When I enter "bench@example.com" as my email" (LLM fallback also failed: Could not parse binding for step 0 ("I enter "bench@example.com" as my email"); slot was: {"step":{"keyword":"When","text":"I enter \"bench@example.com\" as my email"},"pomCall":{"page":"page","method":"getByLabel('Email address').fill","args":["\"bench@example.com\""]}})
    });

    await test.step("[SKIPPED] And I enter \"BenchPass1!\" as my password", async () => {
      // TODO: no rule matched: "And I enter "BenchPass1!" as my password" (LLM fallback also failed: Could not parse binding for step 1 ("I enter "BenchPass1!" as my password"); slot was: {"step":{"keyword":"And","text":"I enter \"BenchPass1!\" as my password"},"pomCall":{"page":"page","method":"getByLabel('Password').fill","args":["\"BenchPass1!\""]}})
    });

    await test.step("[SKIPPED] And I click the Sign in button", async () => {
      // TODO: no rule matched: "And I click the Sign in button" (LLM fallback also failed: Could not parse binding for step 2 ("I click the Sign in button"); slot was: {"step":{"keyword":"And","text":"I click the Sign in button"},"pomCall":{"page":"page","method":"getByRole('button', { name: 'Sign in' }).click","args":[]}})
    });

    await test.step("Then I should be on the My Account page", async () => {
      await expect(page).toHaveURL(new RegExp('my-account'));
    });
  });

  test("Search and add to cart", async ({ page }, testInfo) => {
    const authenticationPage = new AuthenticationPage(page);

    await test.step("Given I am on the home page", async () => {
      await authenticationPage.goto();
    });

    await test.step("When I search for \"shirt\"", async () => {
      await page.getByRole('searchbox').first().fill("shirt");
      await page.getByRole('button', { name: /search/i }).first().click();
    });

    await test.step("And I click the first product result", async () => {
      await page.locator('.product_list .product-name').first().click();
    });

    await test.step("And I click the Add to Cart button", async () => {
      await page.getByRole('button', { name: /add to cart/i }).first().click();
    });

    await test.step("Then I should see the cart summary", async () => {
      await expect(authenticationPage.page.getByText("cart summary")).toBeVisible();
    });
  });
});
