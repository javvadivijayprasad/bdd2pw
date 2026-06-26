import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/login.page";

test.describe("Login data-driven", () => {

  test("Login as <username> [password=sZdp522RJCLk3QY, url_fragment=inventory.html, username=Garnet.Reynolds-Miller15]", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I login with username \"Garnet.Reynolds-Miller15\" and password \"sZdp522RJCLk3QY\"", async () => {
      await page.getByPlaceholder('Username').fill('Garnet.Reynolds-Miller15');
      await page.getByPlaceholder('Password').fill('sZdp522RJCLk3QY');
      await page.getByRole('button', { name: 'Login' }).click();
    });

    await test.step("Then the URL should contain \"inventory.html\"", async () => {
      await expect(loginPage.page).toHaveURL(new RegExp("inventory\\.html"));
    });
  });

  test("Login as <username> [password=mbJPw9_RT2jzvYx, url_fragment=inventory.html, username=Alyce94]", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I login with username \"Alyce94\" and password \"mbJPw9_RT2jzvYx\"", async () => {
      await page.getByPlaceholder('Username').fill('Alyce94');
      await page.getByPlaceholder('Password').fill('mbJPw9_RT2jzvYx');
      await page.getByRole('button', { name: 'Login' }).click();
    });

    await test.step("Then the URL should contain \"inventory.html\"", async () => {
      await expect(loginPage.page).toHaveURL(new RegExp("inventory\\.html"));
    });
  });

  test("Login as <username> [password=oBTmj3ndfjCrfuM, url_fragment=inventory.html, username=Ashlynn.Bayer38]", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I login with username \"Ashlynn.Bayer38\" and password \"oBTmj3ndfjCrfuM\"", async () => {
      await page.getByPlaceholder('Username').fill('Ashlynn.Bayer38');
      await page.getByPlaceholder('Password').fill('oBTmj3ndfjCrfuM');
      await page.getByRole('button', { name: 'Login' }).click();
    });

    await test.step("Then the URL should contain \"inventory.html\"", async () => {
      await expect(loginPage.page).toHaveURL(new RegExp("inventory\\.html"));
    });
  });

  test("Login as <username> [password=RIQw8Gh60ymsm2u, url_fragment=inventory.html, username=Blake_Rowe]", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I login with username \"Blake_Rowe\" and password \"RIQw8Gh60ymsm2u\"", async () => {
      await page.getByPlaceholder('Username').fill('Blake_Rowe');
      await page.getByPlaceholder('Password').fill('RIQw8Gh60ymsm2u');
      await page.getByRole('button', { name: 'Login' }).click();
    });

    await test.step("Then the URL should contain \"inventory.html\"", async () => {
      await expect(loginPage.page).toHaveURL(new RegExp("inventory\\.html"));
    });
  });

  test("Login as <username> [password=InrQH6AzRcC8PZP, url_fragment=inventory.html, username=Kameron.Tremblay11]", async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step("Given I am on the login page", async () => {
      await loginPage.goto();
    });

    await test.step("When I login with username \"Kameron.Tremblay11\" and password \"InrQH6AzRcC8PZP\"", async () => {
      await loginPage.page.getByPlaceholder('Username').fill('Kameron.Tremblay11');
      await loginPage.page.getByPlaceholder('Password').fill('InrQH6AzRcC8PZP');
      await loginPage.page.getByRole('button', { name: 'Login' }).click();
    });

    await test.step("Then the URL should contain \"inventory.html\"", async () => {
      await expect(loginPage.page).toHaveURL(new RegExp("inventory\\.html"));
    });
  });
});
