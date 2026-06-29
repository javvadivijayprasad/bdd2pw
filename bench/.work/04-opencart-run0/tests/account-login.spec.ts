import { test, expect } from "@playwright/test";
import { AccountLoginPage } from "../pages/account-login.page";

test.describe("OpenCart returning customer login and browse", () => {

  test("Returning customer logs in", async ({ page }, testInfo) => {
    const accountLoginPage = new AccountLoginPage(page);

    await test.step("Given I am on the account login page", async () => {
      await accountLoginPage.goto();
    });

    await test.step("[SKIPPED] When I enter \"demo@opencart.com\" as my email", async () => {
      // TODO: no rule matched: "When I enter "demo@opencart.com" as my email" (LLM fallback also failed: Could not parse binding for step 0 ("I enter "demo@opencart.com" as my email"); slot was: {"step":{"keyword":"When","text":"I enter \"demo@opencart.com\" as my email"},"pomCall":{"page":"page","method":"getByLabel('E-Mail Address').fill","args":["\"demo@opencart.com\""]}})
    });

    await test.step("[SKIPPED] And I enter \"demo123\" as my password", async () => {
      // TODO: no rule matched: "And I enter "demo123" as my password" (LLM fallback also failed: Could not parse binding for step 1 ("I enter "demo123" as my password"); slot was: {"step":{"keyword":"And","text":"I enter \"demo123\" as my password"},"pomCall":{"page":"page","method":"getByLabel('Password').fill","args":["\"demo123\""]}})
    });

    await test.step("[SKIPPED] And I click the Login button", async () => {
      // TODO: no rule matched: "And I click the Login button" (LLM fallback also failed: Could not parse binding for step 2 ("I click the Login button"); slot was: {"step":{"keyword":"And","text":"I click the Login button"},"pomCall":{"page":"page","method":"getByRole('button', { name: 'Login' }).click","args":[]}})
    });

    await test.step("Then I should be on the My Account page", async () => {
      await expect(page).toHaveURL(new RegExp('route=account/account'));
    });
  });

  test("Add a product to the cart", async ({ page }, testInfo) => {
    const accountLoginPage = new AccountLoginPage(page);

    await test.step("Given I am on the home page", async () => {
      await accountLoginPage.goto();
    });

    await test.step("When I search for \"iPhone\"", async () => {
      await page.getByPlaceholder('Search').fill('iPhone');
      await page.getByRole('button', { name: 'Search' }).click();
    });

    await test.step("[SKIPPED] And I click the first product result", async () => {
      // TODO: no rule matched: "And I click the first product result" (LLM fallback also failed: Could not parse binding for step 1 ("I click the first product result"); slot was: {"step":{"keyword":"And","text":"I click the first product result"},"pomCall":{"page":"page","method":"locator('.product-thumb').first().click","args":[]}})
    });

    await test.step("[SKIPPED] And I click the Add to Cart button", async () => {
      // TODO: no rule matched: "And I click the Add to Cart button" (LLM fallback also failed: Could not parse binding for step 2 ("I click the Add to Cart button"); slot was: {"step":{"keyword":"And","text":"I click the Add to Cart button"},"pomCall":{"page":"page","method":"getByRole","args":["button","{ name: 'Add to Cart' }"]}})
    });

    await test.step("Then the cart count should be 1", async () => {
      await expect(page.locator('#cart-total').first()).toContainText("1");
    });
  });

  test("View checkout page", async ({ page }, testInfo) => {
    const accountLoginPage = new AccountLoginPage(page);

    await test.step("Given I have 1 item in the cart", async () => {
      // TODO: Navigate to a product page and add 1 item to the cart
      await page.goto('https://demo.opencart.com/index.php?route=product/product&product_id=40');
      await page.getByRole('button', { name: 'Add to Cart' }).first().click();
      await page.waitForTimeout(1000);
    });

    await test.step("When I navigate to the checkout page", async () => {
      await accountLoginPage.goto();
    });

    await test.step("Then I should see the order summary", async () => {
      await expect(accountLoginPage.page.getByText("order summary")).toBeVisible();
    });
  });
});
