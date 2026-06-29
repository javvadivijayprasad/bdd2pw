import { Page, Locator, expect } from "@playwright/test";

export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly errorMessageContainer: Locator;
  readonly loginButton: Locator;
  readonly acceptedUsernamesAreHeading: Locator;
  readonly passwordForAllUsersHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.getByPlaceholder("Username");
    this.passwordInput = page.getByPlaceholder("Password");
    this.errorMessageContainer = page.locator(".error-message-container");
    this.loginButton = page.getByRole("button", { name: "Login" });
    this.acceptedUsernamesAreHeading = page.getByRole("heading", { name: "Accepted usernames are:" });
    this.passwordForAllUsersHeading = page.getByRole("heading", { name: "Password for all users:" });
  }

  async goto(): Promise<void> {
    await this.page.goto("https://www.saucedemo.com");
  }
}
