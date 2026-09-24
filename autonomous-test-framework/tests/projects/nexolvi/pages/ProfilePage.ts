// @aria-generated project=nexolvi feature=F-01 source=page-map
// Rendered from the verified page map by ARIA Agent 05. Do not edit by hand; regenerate instead.
import { Page, Locator } from '@playwright/test';
import { BasePage } from '../../../pages/BasePage';
import { requireEnv } from '../../../helpers/env';

/**
 * Page object for feature F-01. Every locator resolved to exactly one element during discovery.
 */
export class ProfilePage extends BasePage {
  constructor(page: Page) {
    super(page, 'ProfilePage');
  }

  /** Navigate to the "login" state (/login). */
  async openLogin(): Promise<void> {
    await this.navigate("/login");
  }

  /** Navigate to the "start" state (/) by signing in — it sits behind the login form (see signIn). */
  async openStart(): Promise<void> {
    await this.signIn();
  }

  /** Requests the address of the "start" state (/) directly — no sign-in, no action. What the application shows for that request (the state itself, or a redirect to the login page) is what the step then asserts. Use it only for a step that says the user opens or navigates to that address. */
  async visitStart(): Promise<void> {
    await this.navigate("/");
  }

  /**
   * Signs in on the "login" state with the account the environment provides (NEXOLVI_EMAIL, NEXOLVI_PASSWORD) and lands on the "start" state (/), returning once dashboardHeading is visible. Verified by discovery; performs actions only and asserts nothing. Call it before any step that needs an authenticated session — never fill the sign-in form with credentials yourself.
   */
  async signIn(): Promise<void> {
    if (await this.resumeSession()) return;
    await this.navigate("/login");
    await this.workEmailInput.fill(requireEnv("NEXOLVI_EMAIL"));
    await this.passwordInput.fill(requireEnv("NEXOLVI_PASSWORD"));
    await this.signInButton.click();
    await this.waitForVisible(this.dashboardHeading);
  }

  /**
   * Returns to the "start" state (/) when this page is still signed in, and
   * reports whether it was. Lets tests that share one page sign in once: after a test ends the session, signIn()
   * fills the form again. Performs actions only and asserts nothing.
   */
  async resumeSession(): Promise<boolean> {
    if (this.page.url() === 'about:blank') return false;
    await this.navigate("/");
    await this.waitForVisible(this.dashboardHeading.or(this.signInButton));
    return this.dashboardHeading.isVisible();
  }

  /**
   * Verified action sequence in state "startMyProfileDialog": fill newPasswordInput, fill confirmPasswordInput, click saveChangesButton. Performs actions only and asserts nothing (verified by TC-005, TC-006).
   * @param {{ newPasswordInput: string, confirmPasswordInput: string }} values
   */
  async startMyProfileDialogClickSaveChangesButtonFlow(values: { newPasswordInput: string; confirmPasswordInput: string }): Promise<void> {
    await this.newPasswordInput.fill(values.newPasswordInput);
    await this.confirmPasswordInput.fill(values.confirmPasswordInput);
    await this.saveChangesButton.click();
  }

  /** img "Nexolvi" (state: login) */
  get nexolviImage(): Locator {
    return this.page.getByRole("img", { name: "Nexolvi", exact: true });
  }

  /** heading "One platform. Every business connection." (state: login) */
  get onePlatformEveryBusinessConnectionHeading(): Locator {
    return this.page.getByRole("heading", { name: "One platform. Every business connection.", exact: true });
  }

  /** heading "Welcome to Nexolvi" (state: login) */
  get welcomeToNexolviHeading(): Locator {
    return this.page.getByRole("heading", { name: "Welcome to Nexolvi", exact: true });
  }

  /** textbox "Work email" (state: login) */
  get workEmailInput(): Locator {
    return this.page.getByRole("textbox", { name: "Work email", exact: true });
  }

  /** password input "PASSWORD" (state: login) */
  get passwordInput(): Locator {
    return this.page.getByPlaceholder("Enter your password", { exact: true });
  }

  /** button "Show password" (state: login) */
  get showPasswordButton(): Locator {
    return this.page.getByRole("button", { name: "Show password", exact: true });
  }

  /** checkbox "Remember me for 30 days" (state: login) */
  get rememberMeFor30DaysCheckbox(): Locator {
    return this.page.getByRole("checkbox", { name: "Remember me for 30 days", exact: true });
  }

  /** button "Sign in" (state: login) */
  get signInButton(): Locator {
    return this.page.getByRole("button", { name: "Sign in", exact: true });
  }

  /** link "For macOS" (state: login) */
  get forMacosLink(): Locator {
    return this.page.getByRole("link", { name: "For macOS", exact: true });
  }

  /** link "For Windows" (state: login) */
  get forWindowsLink(): Locator {
    return this.page.getByRole("link", { name: "For Windows", exact: true });
  }

  /** link "Contact your administrator" (state: login) */
  get contactYourAdministratorLink(): Locator {
    return this.page.getByRole("link", { name: "Contact your administrator", exact: true });
  }

  /** button — eye icon that toggles password visibility; its accessible name states the next action, so this matches it in both the masked and revealed states (state: login) */
  get passwordVisibilityToggle(): Locator {
    return this.page.locator("button[aria-label=\"Show password\"], button[aria-label=\"Hide password\"]");
  }

  /** img "Nexolvi Logo" (state: start) */
  get nexolviLogoImage(): Locator {
    return this.page.getByRole("img", { name: "Nexolvi Logo", exact: true });
  }

  /** button "Engage Flow" (state: start) */
  get engageFlowButton(): Locator {
    return this.page.getByText("Engage Flow", { exact: true });
  }

  /** button "GPT" (state: start) */
  get gptButton(): Locator {
    return this.page.getByText("GPT", { exact: true });
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

  /** combobox (state: start) */
  get combobox(): Locator {
    return this.page.getByRole("combobox");
  }

  /** button "B" (state: start) */
  get bButton(): Locator {
    return this.page.getByRole("button", { name: "B", exact: true });
  }

  /** button "Dashboard" (state: start) */
  get dashboardButton(): Locator {
    return this.page.getByRole("button", { name: "Dashboard", exact: true });
  }

  /** button "Blogs" (state: start) */
  get blogsButton(): Locator {
    return this.page.getByRole("button", { name: "Blogs", exact: true });
  }

  /** button "Authors" (state: start) */
  get authorsButton(): Locator {
    return this.page.getByRole("button", { name: "Authors", exact: true });
  }

  /** button "Pages" (state: start) */
  get pagesButton(): Locator {
    return this.page.getByRole("button", { name: "Pages", exact: true });
  }

  /** button "Media" (state: start) */
  get mediaButton(): Locator {
    return this.page.getByRole("button", { name: "Media", exact: true });
  }

  /** button "Menus" (state: start) */
  get menusButton(): Locator {
    return this.page.getByRole("button", { name: "Menus", exact: true });
  }

  /** button "Contact Requests" (state: start) */
  get contactRequestsButton(): Locator {
    return this.page.getByRole("button", { name: "Contact Requests", exact: true });
  }

  /** button "Testimonials" (state: start) */
  get testimonialsButton(): Locator {
    return this.page.getByRole("button", { name: "Testimonials", exact: true });
  }

  /** button "Releases" (state: start) */
  get releasesButton(): Locator {
    return this.page.getByRole("button", { name: "Releases", exact: true });
  }

  /** button "Media Coverage" (state: start) */
  get mediaCoverageButton(): Locator {
    return this.page.getByRole("button", { name: "Media Coverage", exact: true });
  }

  /** button "Events" (state: start) */
  get eventsButton(): Locator {
    return this.page.getByRole("button", { name: "Events", exact: true });
  }

  /** button "Team" (state: start) */
  get teamButton(): Locator {
    return this.page.getByRole("button", { name: "Team", exact: true });
  }

  /** button "Subscribers" (state: start) */
  get subscribersButton(): Locator {
    return this.page.getByRole("button", { name: "Subscribers", exact: true });
  }

  /** button "FAQs" (state: start) */
  get faqsButton(): Locator {
    return this.page.getByRole("button", { name: "FAQs", exact: true });
  }

  /** button "Services" (state: start) */
  get servicesButton(): Locator {
    return this.page.getByRole("button", { name: "Services", exact: true });
  }

  /** button "Service Categories" (state: start) */
  get serviceCategoriesButton(): Locator {
    return this.page.getByRole("button", { name: "Service Categories", exact: true });
  }

  /** button "Docs Library" (state: start) */
  get docsLibraryButton(): Locator {
    return this.page.getByRole("button", { name: "Docs Library", exact: true });
  }

  /** button "Analytics" (state: start) */
  get analyticsButton(): Locator {
    return this.page.getByRole("button", { name: "Analytics", exact: true });
  }

  /** button "Site Audit" (state: start) */
  get siteAuditButton(): Locator {
    return this.page.getByRole("button", { name: "Site Audit", exact: true });
  }

  /** button "Search Console" (state: start) */
  get searchConsoleButton(): Locator {
    return this.page.getByRole("button", { name: "Search Console", exact: true });
  }

  /** button "SEO" (state: start) */
  get seoButton(): Locator {
    return this.page.getByRole("button", { name: "SEO", exact: true });
  }

  /** button "Backlinks" (state: start) */
  get backlinksButton(): Locator {
    return this.page.getByRole("button", { name: "Backlinks", exact: true });
  }

  /** button "Keywords" (state: start) */
  get keywordsButton(): Locator {
    return this.page.getByRole("button", { name: "Keywords", exact: true });
  }

  /** button "Collapse" (state: start) */
  get collapseButton(): Locator {
    return this.page.getByRole("button", { name: "Collapse", exact: true });
  }

  /** heading "Dashboard" (state: start) */
  get dashboardHeading(): Locator {
    return this.page.getByRole("heading", { name: "Dashboard", exact: true });
  }

  /** status (state: start) */
  get status(): Locator {
    return this.page.getByRole("status");
  }

  /** div — status message (toast / notification) the application shows after the action that triggers it and removes on its own a few seconds later — assert it right after that action (state: start) */
  get successText(): Locator {
    return this.page.getByText("Success", { exact: true });
  }

  /** div — status message (toast / notification) the application shows after the action that triggers it and removes on its own a few seconds later — assert it right after that action (state: start) */
  get profileUpdatedSuccessfullyText(): Locator {
    return this.page.getByText("Profile updated successfully", { exact: true });
  }

  /** menu "B" (state: startMenu) */
  get bMenu(): Locator {
    return this.page.getByRole("menu");
  }

  /** menuitem "Profile" (state: startMenu) */
  get profileMenuItem(): Locator {
    return this.page.getByRole("menuitem", { name: "Profile", exact: true });
  }

  /** menuitem "Logout" (state: startMenu) */
  get logoutMenuItem(): Locator {
    return this.page.getByRole("menuitem", { name: "Logout", exact: true });
  }

  /** span — the account identifier the session signed in with (email or username) as the page shows it, read from NEXOLVI_EMAIL at runtime — assert that it is visible; never assert, type or bind its literal value (state: startMenu) */
  get accountIdentifierText(): Locator {
    return this.page.getByText(requireEnv("NEXOLVI_EMAIL"), { exact: true });
  }

  /** span — static text (state: startMenu) */
  get bikashHtcText(): Locator {
    return this.page.getByText("bikash.htc", { exact: true });
  }

  /** span — static text (state: startMenu) */
  get bikashQaText(): Locator {
    return this.page.getByText("Bikash QA", { exact: true });
  }

  /** dialog "My Profile" (state: startMyProfileDialog) */
  get myProfileDialog(): Locator {
    return this.page.getByRole("dialog");
  }

  /** heading "My Profile" (state: startMyProfileDialog) */
  get myProfileHeading(): Locator {
    return this.page.getByRole("heading", { name: "My Profile", exact: true });
  }

  /** textbox "Name" (state: startMyProfileDialog) */
  get nameInput(): Locator {
    return this.page.getByRole("textbox", { name: "Name", exact: true });
  }

  /** textbox "Email" (state: startMyProfileDialog) */
  get emailInput(): Locator {
    return this.page.getByRole("textbox", { name: "Email", exact: true });
  }

  /** textbox "Phone" (state: startMyProfileDialog) */
  get phoneInput(): Locator {
    return this.page.getByRole("textbox", { name: "Phone", exact: true });
  }

  /** password input "New Password" (state: startMyProfileDialog) */
  get newPasswordInput(): Locator {
    return this.page.getByLabel("New Password", { exact: true });
  }

  /** password input "Confirm Password" (state: startMyProfileDialog) */
  get confirmPasswordInput(): Locator {
    return this.page.getByLabel("Confirm Password", { exact: true });
  }

  /** button "Cancel" (state: startMyProfileDialog) */
  get cancelButton(): Locator {
    return this.page.getByRole("button", { name: "Cancel", exact: true });
  }

  /** button "Save Changes" (state: startMyProfileDialog) */
  get saveChangesButton(): Locator {
    return this.page.getByRole("button", { name: "Save Changes", exact: true });
  }

  /** button "Close" (state: startMyProfileDialog) */
  get closeButton(): Locator {
    return this.page.getByRole("button", { name: "Close", exact: true });
  }

  /** p — static text (state: startMyProfileDialog) */
  get viewAndEditYourAccountText(): Locator {
    return this.page.getByText("View and edit your account information.", { exact: true });
  }

  /** label — static text (state: startMyProfileDialog) */
  get nameText(): Locator {
    return this.page.getByText("Name", { exact: true });
  }

  /** label — static text (state: startMyProfileDialog) */
  get emailText(): Locator {
    return this.page.getByText("Email", { exact: true });
  }

  /** label — static text (state: startMyProfileDialog) */
  get phoneText(): Locator {
    return this.page.getByText("Phone", { exact: true });
  }

  /** p — static text (state: startMyProfileDialog) */
  get changePasswordText(): Locator {
    return this.page.getByText("Change Password", { exact: true });
  }

  /** label — static text (state: startMyProfileDialog) */
  get newPasswordText(): Locator {
    return this.page.getByText("New Password", { exact: true });
  }

  /** label — static text (state: startMyProfileDialog) */
  get confirmPasswordText(): Locator {
    return this.page.getByText("Confirm Password", { exact: true });
  }

  /** div — status message (toast / notification) the application shows after the action that triggers it and removes on its own a few seconds later — assert it right after that action (state: startMyProfileDialog) */
  get errorText(): Locator {
    return this.page.getByText("Error", { exact: true });
  }

  /** div — status message (toast / notification) the application shows after the action that triggers it and removes on its own a few seconds later — assert it right after that action (state: startMyProfileDialog) */
  get userNotFoundText(): Locator {
    return this.page.getByText("User not found", { exact: true });
  }

  /** div — status message (toast / notification) the application shows after the action that triggers it and removes on its own a few seconds later — assert it right after that action (state: startMyProfileDialog) */
  get passwordsDoNotMatchText(): Locator {
    return this.page.getByText("Passwords do not match", { exact: true });
  }
}
