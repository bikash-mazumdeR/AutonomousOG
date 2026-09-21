// Hand-written from the Nexo Desk dashboard DOM. Deliberately carries no @aria-generated marker:
// Agent 05 only ever deletes files it owns, so this file is safe from a future regeneration.
import { Page, Locator } from '@playwright/test';
import { BasePage } from '../../../pages/BasePage';

/**
 * Page object for the Nexo Desk dashboard's user menu and logout flow.
 *
 * Locators come from the application's own DOM: the profile button is the dropdown menu trigger,
 * the menu entries expose the `menuitem` role, and the confirmation is an `alertdialog`. The user's
 * initial and email are account data, so they are never matched here — the spec asserts them from
 * test data, which keeps this object valid for any account.
 */
export class LogoutPage extends BasePage {
  constructor(page: Page) {
    super(page, 'LogoutPage');
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  /** Opens the login page. */
  async openLogin(): Promise<void> {
    await this.navigate('/login');
  }

  /** Opens the dashboard root. Signed out, the application redirects to the login page. */
  async openDashboard(): Promise<void> {
    await this.navigate('/');
  }

  // ── Actions (no assertions — the spec owns those) ────────────────────────

  /**
   * Signs in with the supplied credentials. Values come from the environment, never from literals.
   * @param {{ email: string, password: string }} credentials
   */
  async signIn(credentials: { email: string; password: string }): Promise<void> {
    await this.workEmailInput.fill(credentials.email);
    await this.passwordInput.fill(credentials.password);
    await this.signInButton.click();
  }

  /**
   * Opens the user menu from the profile button.
   *
   * The profile button is a toggle, so clicking it while the menu is already open would close it.
   * This returns early in that case and waits for the menu, which keeps the action meaning "the
   * menu is open" regardless of what the previous scenario left behind.
   */
  async openUserMenu(): Promise<void> {
    if (!await this.userMenu.isVisible().catch(() => false)) {
      await this.profileButton.click();
    }
    await this.userMenu.waitFor({ state: 'visible' });
  }

  /** Opens the user menu and clicks Logout, bringing up the confirmation dialog. */
  async openLogoutConfirmation(): Promise<void> {
    await this.openUserMenu();
    await this.logoutMenuItem.click();
    await this.logoutDialog.waitFor({ state: 'visible' });
  }

  /** Confirms the logout from the open confirmation dialog. */
  async confirmLogout(): Promise<void> {
    await this.confirmLogoutButton.click();
  }

  /** Dismisses the open confirmation dialog, leaving the session untouched. */
  async cancelLogout(): Promise<void> {
    await this.cancelLogoutButton.click();
  }

  // ── Login form ───────────────────────────────────────────────────────────

  /** Email field on the login form. */
  get workEmailInput(): Locator {
    return this.page.getByPlaceholder('you@company.com');
  }

  /** Password field on the login form. */
  get passwordInput(): Locator {
    return this.page.getByPlaceholder('Enter your password');
  }

  /** Submit control on the login form. */
  get signInButton(): Locator {
    return this.page.getByRole('button', { name: 'Sign in', exact: true });
  }

  // ── Dashboard ────────────────────────────────────────────────────────────

  /**
   * Profile button at the top-left of the dashboard; its label is the user's initial.
   * Matched by its role as the menu trigger rather than by that initial, which is account data.
   */
  get profileButton(): Locator {
    return this.page.locator('button[data-slot="dropdown-menu-trigger"][aria-haspopup="menu"]');
  }

  // ── User menu ────────────────────────────────────────────────────────────

  /** The open user menu. Everything below is scoped to it, so the trigger cannot satisfy an assertion. */
  get userMenu(): Locator {
    return this.page.getByRole('menu');
  }

  /**
   * The user's initial shown inside the open menu — the avatar, not the trigger that opened it.
   * Scoped to the menu so this and the trigger stay distinct elements.
   */
  get userMenuInitial(): Locator {
    return this.userMenu.locator('div[class*="rounded-full"]').first();
  }

  /**
   * The account email shown inside the open menu. Matched by shape rather than by a literal address,
   * so the object holds no account data; the spec asserts the configured account.
   */
  get userMenuEmail(): Locator {
    return this.userMenu.getByText(/^\S+@\S+\.\S+$/);
  }

  /** "Profile" entry of the open user menu. */
  get profileMenuItem(): Locator {
    return this.page.getByRole('menuitem', { name: 'Profile' });
  }

  /** "Logout" entry of the open user menu. */
  get logoutMenuItem(): Locator {
    return this.page.getByRole('menuitem', { name: 'Logout' });
  }

  // ── Logout confirmation ──────────────────────────────────────────────────

  /** Logout confirmation dialog. */
  get logoutDialog(): Locator {
    return this.page.getByRole('alertdialog');
  }

  /** Heading of the logout confirmation dialog. */
  get logoutDialogHeading(): Locator {
    return this.logoutDialog.getByRole('heading');
  }

  /** Body message of the logout confirmation dialog. */
  get logoutDialogMessage(): Locator {
    return this.logoutDialog.locator('[data-slot="alert-dialog-description"]');
  }

  /** Cancel control of the logout confirmation dialog. */
  get cancelLogoutButton(): Locator {
    return this.logoutDialog.getByRole('button', { name: 'Cancel', exact: true });
  }

  /** Confirm control of the logout confirmation dialog. */
  get confirmLogoutButton(): Locator {
    return this.logoutDialog.getByRole('button', { name: 'Log out', exact: true });
  }
}
