import { Page, Locator, expect } from "@playwright/test";

export class LoginPage {
  readonly page: Page;
  readonly cookieconsent: Locator;
  readonly learnMoreAboutCookiesButton: Locator;
  readonly dismissCookieMessageButton: Locator;
  readonly openSidenavButton: Locator;
  readonly menuImage: Locator;
  readonly backToHomepageButton: Locator;
  readonly clickToSearch: Locator;
  readonly searchImage: Locator;
  readonly showHideAccountMenuButton: Locator;
  readonly languageSelectionMenuButton: Locator;
  readonly languageImage: Locator;
  readonly loginHeading: Locator;
  readonly textFieldForTheLoginEmailInput: Locator;
  readonly email: Locator;
  readonly textFieldForTheLoginPasswordInput: Locator;
  readonly password: Locator;
  readonly buttonToDisplayThePasswordButton: Locator;
  readonly eyeImage: Locator;
  readonly forgotYourPasswordLink: Locator;
  readonly loginButton: Locator;
  readonly exitToAppImage: Locator;
  readonly rememberMe: Locator;
  readonly checkboxToStayLoggedInOrNotLoggedInCheckbox: Locator;
  readonly notYetACustomerLink: Locator;
  readonly welcomeToOwaspJuiceShopBeingAWeb: Locator;
  readonly welcomeToOwaspJuiceShopHeading: Locator;
  readonly openWorldwideApplicationSecurityProjectOwaspLink: Locator;
  readonly httpsOwaspJuiceShopHeading: Locator;
  readonly httpsOwaspJuiceShopLink: Locator;
  readonly schoolHelpGettingStartedButton: Locator;
  readonly schoolImage: Locator;
  readonly closeWelcomeBannerButton: Locator;
  readonly visibilityOffImage: Locator;
  readonly forcePageReloadButton: Locator;
  readonly cdkDescribedbyMessageYqi12: Locator;
  readonly cdkDescribedbyMessageYqi13: Locator;
  readonly cdkDescribedbyMessageYqi14: Locator;
  readonly cdkDescribedbyMessageYqi15: Locator;

  constructor(page: Page) {
    this.page = page;
    this.cookieconsent = page.getByRole("dialog", { name: "cookieconsent" });
    this.learnMoreAboutCookiesButton = page.getByRole("button", { name: "learn more about cookies" });
    this.dismissCookieMessageButton = page.getByRole("button", { name: "dismiss cookie message" });
    this.openSidenavButton = page.getByRole("button", { name: "Open Sidenav" });
    this.menuImage = page.getByText("menu");
    this.backToHomepageButton = page.getByRole("button", { name: "Back to homepage" });
    this.clickToSearch = page.getByText("close search");
    this.searchImage = page.getByText("search");
    this.showHideAccountMenuButton = page.getByRole("button", { name: "Show/hide account menu" });
    this.languageSelectionMenuButton = page.getByRole("button", { name: "Language selection menu" });
    this.languageImage = page.getByText("language");
    this.loginHeading = page.getByRole("heading", { name: "Login" });
    this.textFieldForTheLoginEmailInput = page.getByRole("textbox", { name: "Text field for the login email" });
    this.email = page.getByLabel("Email *");
    this.textFieldForTheLoginPasswordInput = page.getByRole("textbox", { name: "Text field for the login password" });
    this.password = page.getByLabel("Password *");
    this.buttonToDisplayThePasswordButton = page.getByRole("button", { name: "Button to display the password" });
    this.eyeImage = page.getByRole("img", { name: "Eye" });
    this.forgotYourPasswordLink = page.getByRole("link", { name: "Forgot your password?" });
    this.loginButton = page.getByRole("button", { name: "Login" });
    this.exitToAppImage = page.getByText("exit_to_app");
    this.rememberMe = page.getByLabel("Remember me");
    this.checkboxToStayLoggedInOrNotLoggedInCheckbox = page.getByRole("checkbox", { name: "Checkbox to stay logged in or not logged in" });
    this.notYetACustomerLink = page.getByRole("link", { name: "Not yet a customer?" });
    this.welcomeToOwaspJuiceShopBeingAWeb = page.locator("#mat-dialog-0");
    this.welcomeToOwaspJuiceShopHeading = page.getByRole("heading", { name: "Welcome to OWASP Juice Shop!" });
    this.openWorldwideApplicationSecurityProjectOwaspLink = page.getByRole("link", { name: "Open Worldwide Application Security Project (OWASP)" });
    this.httpsOwaspJuiceShopHeading = page.getByRole("heading", { name: "https://owasp-juice.shop" });
    this.httpsOwaspJuiceShopLink = page.getByRole("link", { name: "https://owasp-juice.shop" });
    this.schoolHelpGettingStartedButton = page.getByRole("button", { name: "school Help getting started" });
    this.schoolImage = page.getByText("school");
    this.closeWelcomeBannerButton = page.getByRole("button", { name: "Close Welcome Banner" });
    this.visibilityOffImage = page.getByText("visibility_off");
    this.forcePageReloadButton = page.getByRole("button", { name: "Force page reload" });
    this.cdkDescribedbyMessageYqi12 = page.locator("#cdk-describedby-message-yqi-1-2");
    this.cdkDescribedbyMessageYqi13 = page.locator("#cdk-describedby-message-yqi-1-3");
    this.cdkDescribedbyMessageYqi14 = page.locator("#cdk-describedby-message-yqi-1-4");
    this.cdkDescribedbyMessageYqi15 = page.locator("#cdk-describedby-message-yqi-1-5");
  }

  async goto(): Promise<void> {
    await this.page.goto("http://localhost:3030/#/login");
  }
}
