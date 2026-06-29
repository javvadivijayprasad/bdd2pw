import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/login.page";

test.describe("Conduit blog flows", () => {

  test("Login with valid credentials", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the Conduit login page", async () => {
      await loginPage.goto();
    });

    await test.step("[SKIPPED] When I enter \"bench@example.com\" as my email", async () => {
      // TODO: no rule matched: "When I enter "bench@example.com" as my email" (LLM fallback also failed: Could not parse binding for step 0 ("I enter "bench@example.com" as my email"); slot was: {"step":{"keyword":"When","text":"I enter \"bench@example.com\" as my email"},"pomCall":{"page":"page","method":"getByLabel(\"Email\").fill","args":["\"bench@example.com\""]}})
    });

    await test.step("[SKIPPED] And I enter \"BenchPass1!\" as my password", async () => {
      // TODO: no rule matched: "And I enter "BenchPass1!" as my password" (LLM fallback also failed: Could not parse binding for step 1 ("I enter "BenchPass1!" as my password"); slot was: {"step":{"keyword":"And","text":"I enter \"BenchPass1!\" as my password"},"pomCall":{"page":"page","method":"getByLabel(\"Password\").fill","args":["\"BenchPass1!\""]}})
    });

    await test.step("[SKIPPED] And I click the Sign in button", async () => {
      // TODO: no rule matched: "And I click the Sign in button" (LLM fallback also failed: Could not parse binding for step 2 ("I click the Sign in button"); slot was: {"step":{"keyword":"And","text":"I click the Sign in button"},"pomCall":{"page":"page","method":"getByRole(\"button\", { name: \"Sign in\" }).click","args":[]}})
    });

    await test.step("Then I should be on the home feed", async () => {
      await expect(page).toHaveURL(new RegExp('/#/$|/#/feed'));
    });
  });

  test("Publish a new article", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am logged in to Conduit", async () => {
      // TODO: Implement login flow — e.g. set auth cookies or navigate to login and fill credentials
      await page.context().clearCookies();
      await page.goto('https://demo.realworld.io/#/login');
      // await page.getByPlaceholder('Email').fill(process.env.TEST_EMAIL ?? '');
      // await page.getByPlaceholder('Password').fill(process.env.TEST_PASSWORD ?? '');
      // await page.getByRole('button', { name: 'Sign in' }).click();
    });

    await test.step("When I navigate to the new article page", async () => {
      await loginPage.goto();
    });

    await test.step("[SKIPPED] And I enter \"Bench harness debut\" as the article title", async () => {
      // TODO: no rule matched: "And I enter "Bench harness debut" as the article title" (LLM fallback also failed: Could not parse binding for step 1 ("I enter "Bench harness debut" as the article title"); slot was: {"step":{"keyword":"And","text":"I enter \"Bench harness debut\" as the article title"},"pomCall":{"page":"page","method":"getByPlaceholder('Article Title').fill","args":["\"Bench harness debut\""]}})
    });

    await test.step("[SKIPPED] And I enter \"How we benchmark scaffolds\" as the article description", async () => {
      // TODO: no rule matched: "And I enter "How we benchmark scaffolds" as the article description" (LLM fallback also failed: Could not parse binding for step 2 ("I enter "How we benchmark scaffolds" as the article description"); slot was: {"step":{"keyword":"And","text":"I enter \"How we benchmark scaffolds\" as the article description"},"pomCall":{"page":"page","method":"getByPlaceholder(\"What's this article about?\").fill","args":[")
    });

    await test.step("[SKIPPED] And I enter \"Lorem ipsum dolor sit amet\" as the article body", async () => {
      // TODO: no rule matched: "And I enter "Lorem ipsum dolor sit amet" as the article body" (LLM fallback also failed: Could not parse binding for step 3 ("I enter "Lorem ipsum dolor sit amet" as the article body"); slot was: {"step":{"keyword":"And","text":"I enter \"Lorem ipsum dolor sit amet\" as the article body"},"pomCall":{"page":"page","method":"getByPlaceholder('Write your article (in markdown)').fill","args":["\"L)
    });

    await test.step("[SKIPPED] And I click the Publish Article button", async () => {
      // TODO: no rule matched: "And I click the Publish Article button" (LLM fallback also failed: Could not parse binding for step 4 ("I click the Publish Article button"); slot was: {"step":{"keyword":"And","text":"I click the Publish Article button"},"pomCall":{"page":"page","method":"getByRole('button', { name: 'Publish Article' }).click","args":[]}})
    });

    await test.step("Then I should be on the article detail page", async () => {
      await expect(page).toHaveURL(new RegExp('/#/article/'));
    });
  });

  test("Comment on an article", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on an article detail page", async () => {
      await loginPage.goto();
    });

    await test.step("[SKIPPED] When I enter \"Great post\" as my comment", async () => {
      // TODO: no rule matched: "When I enter "Great post" as my comment" (LLM fallback also failed: Could not parse binding for step 0 ("I enter "Great post" as my comment"); slot was: {"step":{"keyword":"When","text":"I enter \"Great post\" as my comment"},"pomCall":{"page":"page","method":"locator('textarea[placeholder*=\"comment\"], textarea[name*=\"comment\"], .comment-input tex)
    });

    await test.step("[SKIPPED] And I click the Post Comment button", async () => {
      // TODO: no rule matched: "And I click the Post Comment button" (LLM fallback also failed: Could not parse binding for step 1 ("I click the Post Comment button"); slot was: {"step":{"keyword":"And","text":"I click the Post Comment button"},"pomCall":{"page":"page","method":"getByRole","args":["\"button\"","{ name: \"Post Comment\" }"]}})
    });

    await test.step("Then I should see \"Great post\" in the comments list", async () => {
      await expect(page.locator('.comment-body, .card-block').filter({ hasText: "Great post" }).first()).toBeVisible();
    });
  });
});
