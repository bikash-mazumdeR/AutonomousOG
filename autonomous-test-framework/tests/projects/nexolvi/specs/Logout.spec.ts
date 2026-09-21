// Hand-written from the approved Logout feature file and the dashboard DOM. Deliberately carries no
// @aria-generated marker: Agent 05 only deletes files it owns, so this file survives a regeneration.
//
// This file signs in exactly once. Every scenario shares that one browser context and page, so the
// suite runs serially: each test hands the session to the next, and a failure part-way through
// leaves the ones after it unrunnable rather than silently re-authenticating.
//
// Logging out terminates the session on the server — a storage state captured before a logout no
// longer authenticates afterwards. The three scenarios that end the session are therefore grouped
// last, and the two that follow the logout take it as their precondition, exactly as their Given
// steps describe, instead of signing in again to tear it down a second time.
import { test, expect, Page } from '@playwright/test';
import { requireEnv as env } from '../../../helpers/env';
import fixtureData from '../fixtures/test-data.json';
import { LogoutPage } from '../pages/LogoutPage';

const data = fixtureData;

let page: Page;
let featurePage: LogoutPage;

test.describe('Logout', () => {
  test.describe.configure({ mode: 'serial' });

  // The single login for the whole file. Credentials come from the environment and are never
  // inlined, so the suite carries no account secret.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    featurePage = new LogoutPage(page);
    await featurePage.openLogin();
    await featurePage.signIn({ email: env('NEXOLVI_EMAIL'), password: env('NEXOLVI_PASSWORD') });
    await expect(page).toHaveURL(data.dashboardUrl);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  // A shared page means one test's leftovers become the next test's starting state. An open menu or
  // dialog would swallow the next click, so any overlay is dismissed here. Escape closes both.
  test.afterEach(async () => {
    for (const overlay of [featurePage.logoutDialog, featurePage.userMenu]) {
      if (await overlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        // Waited for, not fired and forgotten: the next test clicks the profile button, which is a
        // toggle, so a half-closed overlay would make that click close what it meant to open.
        await expect(overlay).toBeHidden();
      }
    }
  });

  // ── Scenarios that leave the session intact ────────────────────────────────

  test('[TC-LOGOUT-001] Profile button displays the user initial at the top-left corner of the Dashboard after login', {
    tag: ['@positive', '@smoke', '@functional', '@ui'],
    annotation: [
      { type: 'TC Key', description: 'TC-LOGOUT-001' },
      { type: 'Story', description: 'US-01' },
      { type: 'Requirements', description: 'AC-1, AC-8' },
    ],
  }, async () => {
    // Then the Dashboard page is displayed
    await expect(page).toHaveURL(data.dashboardUrl);

    // When the user views the top-left corner of the Dashboard
    // Then the profile button displaying the single uppercase character 'B' is visible
    await expect(featurePage.profileButton).toBeVisible();
    await expect(featurePage.profileButton).toHaveText(data.profileInitial);
  });

  test('[TC-LOGOUT-002] Clicking the profile button opens the user menu with all required elements', {
    tag: ['@positive', '@functional', '@ui'],
    annotation: [
      { type: 'TC Key', description: 'TC-LOGOUT-002' },
      { type: 'Story', description: 'US-01' },
      { type: 'Requirements', description: 'AC-2, AC-10' },
    ],
  }, async () => {
    // Then the Dashboard page is displayed
    await expect(page).toHaveURL(data.dashboardUrl);

    // When the user clicks the profile button at the top-left corner
    await featurePage.openUserMenu();

    // Then the user menu is displayed containing four distinct visible elements.
    // Each is asserted separately, and the menu members are scoped inside the menu, so the trigger
    // that opened it can never stand in for the initial the menu is supposed to show.
    await expect(featurePage.userMenu).toBeVisible();
    await expect(featurePage.userMenuInitial).toBeVisible();
    await expect(featurePage.userMenuInitial).toHaveText(data.profileInitial);
    await expect(featurePage.userMenuEmail).toBeVisible();
    await expect(featurePage.userMenuEmail).toHaveText(env('NEXOLVI_EMAIL'));
    await expect(featurePage.profileMenuItem).toBeVisible();
    await expect(featurePage.logoutMenuItem).toBeVisible();
  });

  test('[TC-LOGOUT-003] Clicking Logout in the user menu displays the confirmation popup with correct text', {
    tag: ['@positive', '@smoke', '@functional', '@ui'],
    annotation: [
      { type: 'TC Key', description: 'TC-LOGOUT-003' },
      { type: 'Story', description: 'US-01' },
      { type: 'Requirements', description: 'AC-3, AC-4, AC-11, AC-12, AC-13, BR-2' },
      // The scenario calls this a "native browser dialog". It is not: the application renders an
      // in-page element with role="alertdialog", and no native dialog event is ever raised.
      { type: 'Deviation', description: 'Confirmation is an in-page alertdialog, not a native browser dialog' },
      { type: 'Deviation', description: 'Confirm control reads "Log out"; the scenario expects "Logout"' },
    ],
  }, async () => {
    // Then the Dashboard page is displayed
    await expect(page).toHaveURL(data.dashboardUrl);

    // When the user clicks the profile button and then clicks Logout in the user menu
    await featurePage.openLogoutConfirmation();

    // Then the dialog shows the required header and body
    await expect(featurePage.logoutDialog).toBeVisible();
    await expect(featurePage.logoutDialogHeading).toHaveText(data.popupHeader);
    await expect(featurePage.logoutDialogMessage).toHaveText(data.popupMessage);

    // And both actions are labelled as the application renders them.
    await expect(featurePage.cancelLogoutButton).toHaveText('Cancel');
    await expect(featurePage.confirmLogoutButton).toHaveText('Log out');
  });

  test('[TC-LOGOUT-005] Clicking Cancel on the confirmation popup closes it and keeps the user authenticated', {
    tag: ['@positive', '@functional', '@error-handling'],
    annotation: [
      { type: 'TC Key', description: 'TC-LOGOUT-005' },
      { type: 'Story', description: 'US-01' },
      { type: 'Requirements', description: 'AC-5, AC-15, BR-3' },
    ],
  }, async () => {
    // Given the confirmation popup is displayed with the warning text
    await featurePage.openLogoutConfirmation();
    await expect(featurePage.logoutDialogMessage).toHaveText(data.popupMessage);

    // When the user clicks the Cancel button in the confirmation popup
    await featurePage.cancelLogout();

    // Then the popup closes and the user remains on the Dashboard
    await expect(featurePage.logoutDialog).toBeHidden();
    await expect(page).toHaveURL(data.dashboardUrl);

    // And the session is unchanged: the authenticated control is still there and still works
    await expect(featurePage.profileButton).toBeVisible();
    await featurePage.openUserMenu();
    await expect(featurePage.userMenu).toBeVisible();
  });

  test('[TC-LOGOUT-008] Hovering over the profile button exposes the user email as a tooltip', {
    tag: ['@edge', '@ui'],
    annotation: [
      { type: 'TC Key', description: 'TC-LOGOUT-008' },
      { type: 'Story', description: 'US-01' },
      { type: 'Requirements', description: 'AC-9' },
      { type: 'Deviation', description: 'A native tooltip is drawn outside the DOM; the title attribute producing it is asserted instead' },
    ],
  }, async () => {
    // Then the Dashboard page is displayed
    await expect(page).toHaveURL(data.dashboardUrl);

    // When the user hovers over the profile button at the top-left corner
    await featurePage.profileButton.hover();

    // Then the first part of the email is shown. The browser draws a native tooltip outside the
    // DOM, so it cannot be read; the title attribute that produces it is the observable fact, and
    // it is compared against the configured account rather than a literal address.
    const [localPart] = env('NEXOLVI_EMAIL').split('@');
    await expect(featurePage.profileButton).toHaveAttribute('title', localPart);
  });

  test('[TC-LOGOUT-009] Profile button displays exactly the single uppercase initial and nothing else', {
    tag: ['@edge', '@ui'],
    annotation: [
      { type: 'TC Key', description: 'TC-LOGOUT-009' },
      { type: 'Story', description: 'US-01' },
      { type: 'Requirements', description: 'AC-1, AC-8' },
    ],
  }, async () => {
    // Then the Dashboard page is displayed
    await expect(page).toHaveURL(data.dashboardUrl);

    // When the user views the profile button at the top-left corner
    await expect(featurePage.profileButton).toBeVisible();

    // Then it displays exactly the initial and no other characters. toHaveText compares the whole
    // string, so any extra character fails. The expected initial is also tied back to the account,
    // so the fixture cannot drift into asserting a letter the signed-in user does not have.
    await expect(featurePage.profileButton).toHaveText(data.profileInitial);
    expect(data.profileInitial).toBe(env('NEXOLVI_EMAIL').charAt(0).toUpperCase());
  });

  test('[TC-LOGOUT-010] Reopening the user menu after cancelling the logout popup shows it again unchanged', {
    tag: ['@edge', '@functional', '@error-handling'],
    annotation: [
      { type: 'TC Key', description: 'TC-LOGOUT-010' },
      { type: 'Story', description: 'US-01' },
      { type: 'Requirements', description: 'AC-5, AC-15, BR-3' },
    ],
  }, async () => {
    // Given the user has cancelled the logout confirmation and is back on the Dashboard
    await featurePage.openLogoutConfirmation();
    await featurePage.cancelLogout();
    await expect(featurePage.logoutDialog).toBeHidden();
    await expect(page).toHaveURL(data.dashboardUrl);

    // When the user clicks the profile button again
    await featurePage.openUserMenu();

    // Then the user menu is displayed again with the same four elements, session unchanged
    await expect(featurePage.userMenu).toBeVisible();
    await expect(featurePage.userMenuInitial).toHaveText(data.profileInitial);
    await expect(featurePage.userMenuEmail).toHaveText(env('NEXOLVI_EMAIL'));
    await expect(featurePage.profileMenuItem).toBeVisible();
    await expect(featurePage.logoutMenuItem).toBeVisible();
  });

  // ── Scenarios that end the session, and the two that depend on it being ended ──
  // These run last because the logout is irreversible for the shared session: the server rejects
  // the terminated token, so nothing authenticated can follow them without a second sign-in.

  test('[TC-LOGOUT-004] Clicking Logout in the confirmation popup terminates the session and redirects to the Login page', {
    tag: ['@positive', '@smoke', '@functional', '@security'],
    annotation: [
      { type: 'TC Key', description: 'TC-LOGOUT-004' },
      { type: 'Story', description: 'US-01' },
      { type: 'Requirements', description: 'AC-6, AC-14, BR-3' },
      { type: 'Deviation', description: 'Header asserted as "Log out?"; the scenario step for it is malformed' },
      { type: 'Deviation', description: 'Redirect lands on /login, not the Dashboard URL the scenario names' },
    ],
  }, async () => {
    // Given the confirmation popup is displayed
    await featurePage.openLogoutConfirmation();
    await expect(featurePage.logoutDialog).toBeVisible();
    await expect(featurePage.logoutDialogHeading).toHaveText(data.popupHeader);
    await expect(featurePage.logoutDialogMessage).toHaveText(data.popupMessage);
    await expect(featurePage.cancelLogoutButton).toHaveText('Cancel');
    await expect(featurePage.confirmLogoutButton).toHaveText('Log out');

    // When the user clicks the Logout button in the confirmation popup
    await featurePage.confirmLogout();

    // Then the session is terminated and the user is taken to the Login page
    await expect(page).toHaveURL(new RegExp('/login$'));
    await expect(featurePage.workEmailInput).toBeVisible();

    // And the Dashboard is no longer accessible: its authenticated control is gone
    await expect(featurePage.profileButton).toBeHidden();
  });

  test('[TC-LOGOUT-006] Navigating to the Dashboard URL after logout displays the Login page', {
    tag: ['@negative', '@functional', '@security'],
    annotation: [
      { type: 'TC Key', description: 'TC-LOGOUT-006' },
      { type: 'Story', description: 'US-01' },
      { type: 'Requirements', description: 'AC-7, BR-3' },
    ],
  }, async () => {
    // Given the user has completed the logout flow and is on the Login page — established by
    // TC-LOGOUT-004, which this scenario names as its precondition rather than its subject.
    await expect(featurePage.workEmailInput).toBeVisible();

    // When the user navigates to the Dashboard URL
    await featurePage.openDashboard();

    // Then the Login page is displayed and the Dashboard is not accessible. The application serves
    // the login form at the Dashboard URL rather than redirecting away from it, so this asserts
    // what is rendered rather than the address.
    await expect(featurePage.workEmailInput).toBeVisible();
    await expect(featurePage.signInButton).toBeVisible();
    await expect(featurePage.profileButton).toBeHidden();
  });

  test('[TC-LOGOUT-007] Attempting to reuse a terminated session to access the Dashboard is blocked', {
    tag: ['@negative', '@functional', '@security'],
    annotation: [
      { type: 'TC Key', description: 'TC-LOGOUT-007' },
      { type: 'Story', description: 'US-01' },
      { type: 'Requirements', description: 'AC-14, BR-3' },
    ],
  }, async () => {
    // Given the session has been terminated, still carried by this shared context
    await expect(featurePage.workEmailInput).toBeVisible();

    // When the user attempts to access the Dashboard with that terminated session
    await featurePage.openDashboard();

    // Then the Login page is displayed instead of the Dashboard
    await expect(featurePage.workEmailInput).toBeVisible();
    await expect(featurePage.profileButton).toBeHidden();
    await expect(featurePage.userMenu).toBeHidden();
  });
});
