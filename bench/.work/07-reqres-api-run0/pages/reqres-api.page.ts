import { Page, Locator, expect } from "@playwright/test";

export class ReqresApi {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto("https://reqres.in");
  }
}
