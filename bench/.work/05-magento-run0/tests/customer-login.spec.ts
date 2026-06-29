import { test, expect } from "@playwright/test";
import { CustomerLoginPage } from "../pages/customer-login.page";

test.describe("Magento customer journey", () => {

  test("Customer logs in", async ({ page }, testInfo) => {
    const customerLoginPage = new CustomerLoginPage(page);

    await test.step("Given I am on the customer login page", async () => {
      await customerLoginPage.goto();
    });

    await test.step("[SKIPPED] When I enter \"bench@example.com\" as my email", async () => {
      // TODO: no rule matched: "When I enter "bench@example.com" as my email" (LLM fallback also failed: Could not parse binding for step 0 ("I enter "bench@example.com" as my email"); slot was: {"step":{"keyword":"When","text":"I enter \"bench@example.com\" as my email"},"pomCall":{"page":"page","method":"getByLabel","args":["\"Email\""]},"customBody":"await page.getByLabel(\"Email\").fill(\)
    });

    await test.step("And I enter \"BenchPass1!\" as my password", async () => {
      await page.getByLabel("Password").fill("BenchPass1!");
      await page.getByRole("button", { name: "Sign In" }).click();
    });

    await test.step("And I click the Sign In button", async () => {
      await customerLoginPage.clickToRevealButton.click();
    });

    await test.step("Then I should be on the My Account page", async () => {
      await expect(page).toHaveURL(new RegExp('/customer/account'));
    });
  });

  test("Browse the Men category", async ({ page }, testInfo) => {
    const customerLoginPage = new CustomerLoginPage(page);

    await test.step("Given I am on the home page", async () => {
      await customerLoginPage.goto();
    });

    await test.step("When I hover over the Men menu", async () => {
      await page.getByRole('menuitem', { name: 'Men' }).first().hover();
    });

    await test.step("And I click the Tops menu item", async () => {
      await page.getByRole('menuitem', { name: 'Tops' }).first().click();
    });

    await test.step("Then I should see at least 12 product tiles", async () => {
      await expect(customerLoginPage.page.getByText("at least 12 product tiles")).toBeVisible();
    });
  });

  test("Add a configurable product to the cart", async ({ page }, testInfo) => {
    const customerLoginPage = new CustomerLoginPage(page);

    await test.step("Given I am on a product detail page", async () => {
      await customerLoginPage.goto();
    });

    await test.step("When I select size \"M\"", async () => {
      await page.getByRole('option', { name: 'M' }).first().click();
    });

    await test.step("And I select color \"Blue\"", async () => {
      await page.getByRole('option', { name: 'Blue' }).first().click();
    });

    await test.step("And I click the Add to Cart button", async () => {
      await customerLoginPage.clickToRevealButton.click();
    });

    await test.step("Then the cart count should be 1", async () => {
      await expect(page.getByRole('link', { name: /My Cart.*1/ }).first()).toBeVisible();
    });
  });
});
