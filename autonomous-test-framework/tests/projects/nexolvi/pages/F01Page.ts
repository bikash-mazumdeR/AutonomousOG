// @aria-generated project=nexolvi feature=F-01 source=page-map
// Rendered from the verified page map by ARIA Agent 05. Do not edit by hand; regenerate instead.
import { Page, Locator } from '@playwright/test';
import { BasePage } from '../../../pages/BasePage';

/**
 * Page object for feature F-01. Every locator resolved to exactly one element during discovery.
 */
export class F01Page extends BasePage {
  constructor(page: Page) {
    super(page, 'F01Page');
  }

  /** Navigate to the "start" state. */
  async openStart(): Promise<void> {
    await this.navigate("/login");
  }

  /**
   * Verified action sequence in state "start": fill workEmailInput, fill passwordInput, click signInButton. Performs actions only and asserts nothing (verified by TC-001, TC-006, TC-007, TC-008, TC-009).
   * @param {{ workEmailInput: string, passwordInput: string }} values
   */
  async startClickSignInButtonFlow(values: { workEmailInput: string; passwordInput: string }): Promise<void> {
    await this.workEmailInput.fill(values.workEmailInput);
    await this.passwordInput.fill(values.passwordInput);
    await this.signInButton.click();
  }

  /** img "Nexolvi" (state: start) */
  get nexolviImage(): Locator {
    return this.page.getByRole("img", { name: "Nexolvi", exact: true });
  }

  /** heading "One platform. Every business connection." (state: start) */
  get onePlatformEveryBusinessConnectionHeading(): Locator {
    return this.page.getByRole("heading", { name: "One platform. Every business connection.", exact: true });
  }

  /** heading "Welcome to Nexolvi" (state: start) */
  get welcomeToNexolviHeading(): Locator {
    return this.page.getByRole("heading", { name: "Welcome to Nexolvi", exact: true });
  }

  /** textbox "WORK EMAIL" (state: start) */
  get workEmailInput(): Locator {
    return this.page.getByPlaceholder("you@company.com", { exact: true });
  }

  /** password input "PASSWORD" (state: start) */
  get passwordInput(): Locator {
    return this.page.getByPlaceholder("Enter your password", { exact: true });
  }

  /** button "Show password" (state: start) */
  get showPasswordButton(): Locator {
    return this.page.getByRole("button", { name: "Show password", exact: true });
  }

  /** checkbox "Remember me for 30 days" (state: start) */
  get rememberMeFor30DaysCheckbox(): Locator {
    return this.page.getByRole("checkbox", { name: "Remember me for 30 days", exact: true });
  }

  /** button "Sign in" (state: start) */
  get signInButton(): Locator {
    return this.page.getByRole("button", { name: "Sign in", exact: true });
  }

  /** link "For macOS" (state: start) */
  get forMacosLink(): Locator {
    return this.page.getByRole("link", { name: "For macOS", exact: true });
  }

  /** link "For Windows" (state: start) */
  get forWindowsLink(): Locator {
    return this.page.getByRole("link", { name: "For Windows", exact: true });
  }

  /** link "Contact your administrator" (state: start) */
  get contactYourAdministratorLink(): Locator {
    return this.page.getByRole("link", { name: "Contact your administrator", exact: true });
  }

  /** button "Signing in…" (state: start) */
  get signingInButton(): Locator {
    return this.page.getByRole("button", { name: "Signing in…", exact: true });
  }

  /** div — banner shown on the login form after a failed sign-in; its text is the failure message (state: start) */
  get loginErrorAlert(): Locator {
    return this.page.locator("div[role=\"alert\"]");
  }

  /** img "Nexolvi Logo" (state: start) */
  get nexolviLogoImage(): Locator {
    return this.page.getByRole("img", { name: "Nexolvi Logo", exact: true });
  }

  /** button "Affiliates" (state: start) */
  get affiliatesButton(): Locator {
    return this.page.getByText("Affiliates", { exact: true });
  }

  /** button "NexoCRM" (state: start) */
  get nexocrmButton(): Locator {
    return this.page.getByText("NexoCRM", { exact: true });
  }

  /** button "Chatbots" (state: start) */
  get chatbotsButton(): Locator {
    return this.page.getByText("Chatbots", { exact: true });
  }

  /** button "Work OS" (state: start) */
  get workOsButton(): Locator {
    return this.page.getByText("Work OS", { exact: true });
  }

  /** button "Social" (state: start) */
  get socialButton(): Locator {
    return this.page.getByText("Social", { exact: true });
  }

  /** button "B" (state: start) */
  get bButton(): Locator {
    return this.page.getByRole("button", { name: "B", exact: true });
  }

  /** heading "Dashboard" (state: start) */
  get dashboardHeading(): Locator {
    return this.page.getByRole("heading", { name: "Dashboard", exact: true });
  }

  /** button — eye icon that toggles password visibility; its accessible name states the next action, so this matches it in both the masked and revealed states (state: start) */
  get passwordVisibilityToggle(): Locator {
    return this.page.locator("button[aria-label=\"Show password\"], button[aria-label=\"Hide password\"]");
  }
}
