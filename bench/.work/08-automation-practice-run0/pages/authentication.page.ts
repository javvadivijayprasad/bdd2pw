import { Page, Locator, expect } from "@playwright/test";

export class AuthenticationPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto("http://automationpractice.pl/index.php?controller=authentication");
  }
}
