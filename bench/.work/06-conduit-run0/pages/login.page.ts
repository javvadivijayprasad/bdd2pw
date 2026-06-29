import { Page, Locator, expect } from "@playwright/test";

export class LoginPage {
  readonly page: Page;
  readonly _404NotFoundHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    this._404NotFoundHeading = page.getByRole("heading", { name: "404 Not Found" });
  }

  async goto(): Promise<void> {
    await this.page.goto("https://demo.realworld.io/#/login");
  }
}
