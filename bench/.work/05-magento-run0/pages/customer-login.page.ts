import { Page, Locator, expect } from "@playwright/test";

export class CustomerLoginPage {
  readonly page: Page;
  readonly cfErrorDetails: Locator;
  readonly invalidSslCertificateErrorCode526Heading: Locator;
  readonly cloudflareComLink: Locator;
  readonly browserHeading: Locator;
  readonly linkElement: Locator;
  readonly cloudflareHeading: Locator;
  readonly cloudflareLink: Locator;
  readonly cfHostStatus: Locator;
  readonly cfIconError: Locator;
  readonly hostHeading: Locator;
  readonly error: Locator;
  readonly whatHappenedHeading: Locator;
  readonly whatCanIDoHeading: Locator;
  readonly ifYouReAVisitorOfThisWebsiteHeading: Locator;
  readonly ifYouReTheOwnerOfThisWebsiteHeading: Locator;
  readonly additionalTroubleshootingInformationHereLink: Locator;
  readonly cfErrorFooter: Locator;
  readonly clickToRevealButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.cfErrorDetails = page.locator("#cf-error-details");
    this.invalidSslCertificateErrorCode526Heading = page.getByRole("heading", { name: "Invalid SSL certificate Error code 526" });
    this.cloudflareComLink = page.getByRole("link", { name: "cloudflare.com" });
    this.browserHeading = page.getByRole("heading", { name: "Browser" });
    this.linkElement = page.locator("a");
    this.cloudflareHeading = page.getByRole("heading", { name: "Cloudflare" });
    this.cloudflareLink = page.getByRole("link", { name: "Cloudflare" });
    this.cfHostStatus = page.locator("#cf-host-status");
    this.cfIconError = page.locator(".cf-icon-error");
    this.hostHeading = page.getByRole("heading", { name: "Host" });
    this.error = page.getByText("Error");
    this.whatHappenedHeading = page.getByRole("heading", { name: "What happened?" });
    this.whatCanIDoHeading = page.getByRole("heading", { name: "What can I do?" });
    this.ifYouReAVisitorOfThisWebsiteHeading = page.getByRole("heading", { name: "If you're a visitor of this website:" });
    this.ifYouReTheOwnerOfThisWebsiteHeading = page.getByRole("heading", { name: "If you're the owner of this website:" });
    this.additionalTroubleshootingInformationHereLink = page.getByRole("link", { name: "Additional troubleshooting information here." });
    this.cfErrorFooter = page.locator(".cf-error-footer");
    this.clickToRevealButton = page.getByRole("button", { name: "Click to reveal" });
  }

  async goto(): Promise<void> {
    await this.page.goto("https://magento.softwaretestingboard.com/customer/account/login");
  }
}
