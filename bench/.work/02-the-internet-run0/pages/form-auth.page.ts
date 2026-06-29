import { Page, Locator, expect } from "@playwright/test";

export class FormAuthPage {
  readonly page: Page;
  readonly flashMessages: Locator;
  readonly loginPageHeading: Locator;
  readonly thisIsWhereYouCanLogIntoTheSecureAreaEnterTomsmithForTheUsernameAndSuperSecretPasswordForThePasswordIfTheInformationIsWrongYouShouldSeeErrorMessagesHeading: Locator;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly elementalSeleniumLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.flashMessages = page.locator("#flash-messages");
    this.loginPageHeading = page.getByRole("heading", { name: "Login Page" });
    this.thisIsWhereYouCanLogIntoTheSecureAreaEnterTomsmithForTheUsernameAndSuperSecretPasswordForThePasswordIfTheInformationIsWrongYouShouldSeeErrorMessagesHeading = page.getByRole("heading", { name: "This is where you can log into the secure area. Enter tomsmith for the username and SuperSecretPassword! for the password. If the information is wrong you should see error messages." });
    this.usernameInput = page.getByLabel("Username");
    this.passwordInput = page.getByLabel("Password");
    this.loginButton = page.getByRole("button", { name: "Login" });
    this.elementalSeleniumLink = page.getByRole("link", { name: "Elemental Selenium" });
  }

  async goto(): Promise<void> {
    await this.page.goto("https://the-internet.herokuapp.com/login");
  }
}
