import { Page, Locator, expect } from "@playwright/test";

export class AccountLoginPage {
  readonly page: Page;
  readonly divClassH2SpanIdChallengeErro: Locator;

  constructor(page: Page) {
    this.page = page;
    this.divClassH2SpanIdChallengeErro = page.locator(".main-wrapper");
  }

  async goto(): Promise<void> {
    await this.page.goto("https://demo.opencart.com/index.php?route=account/login");
  }
}
