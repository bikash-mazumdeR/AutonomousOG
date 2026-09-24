// @aria-generated project=nexolvi feature=F-01 source=tc_review_1790095125971
// Rendered by ARIA Agent 05 from approved test cases. Do not edit by hand; regenerate instead.
import { test as base, expect, Page } from '@playwright/test';
import { requireEnv as env } from '../../../helpers/env';
import fixtureData from '../fixtures/test-data.json';
import { ProfilePage } from '../pages/ProfilePage';

const test = base.extend<{ featurePage: ProfilePage; data: typeof fixtureData }>({
  featurePage: async ({ page }, use) => {
    await use(new ProfilePage(page));
  },
  // eslint-disable-next-line no-empty-pattern
  data: async ({}, use) => {
    await use(fixtureData);
  },
});

// One signed-in page shared by the tests that start behind the login form (see the session block below).
let sessionPage: Page;
const sessionTest = test.extend({
  // eslint-disable-next-line no-empty-pattern
  page: async ({}, use) => {
    await use(sessionPage);
  },
});

test.describe("F-01", () => {
  test("[TC-001] Login page displays required fields and Sign In button is disabled until both fields are filled", {
    tag: ["@positive", "@smoke", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-001" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-1, AC-2, AC-3" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openLogin();
    await expect(featurePage.workEmailInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.rememberMeFor30DaysCheckbox).toBeVisible();
    await expect(featurePage.signInButton).toBeVisible();
    await expect(featurePage.signInButton).not.toBeEnabled();
    await featurePage.workEmailInput.fill('qa.user@example.test');
    await expect(featurePage.signInButton).not.toBeEnabled();
    await featurePage.passwordInput.fill('Aria_Pass_01!');
    await expect(featurePage.signInButton).toBeEnabled();
  });

  test("[TC-002] Valid credentials redirect to Dashboard and profile button displays character B", {
    tag: ["@positive", "@smoke", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-002" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-4, AC-5" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openLogin();
    await expect(featurePage.workEmailInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.signInButton).toBeVisible();
    await featurePage.signIn();
    await expect(featurePage.dashboardHeading).toBeVisible();
    await expect(featurePage.bButton).toBeVisible();
  });

  test("[TC-004] Saving profile with blank password fields preserves existing password and reflects updated info", {
    tag: ["@positive", "@functional", "@isolated-session"],
    annotation: [
      { type: "TC Key", description: "TC-004" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-13, AC-16, AC-17, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openStart();
    await featurePage.bButton.click();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.nameInput).toBeVisible();
    await expect(featurePage.emailInput).toBeVisible();
    await expect(featurePage.phoneInput).toBeVisible();
    await expect(featurePage.newPasswordInput).toBeVisible();
    await expect(featurePage.confirmPasswordInput).toBeVisible();
    await featurePage.nameInput.fill(data.updatedName);
    await featurePage.saveChangesButton.click();
    await expect(featurePage.profileUpdatedSuccessfullyText).toBeVisible();
    await featurePage.bButton.click();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.nameInput).toHaveValue(data.updatedName);
    await featurePage.nameInput.fill('bikash.htc');
    await featurePage.saveChangesButton.click();
    await expect(featurePage.myProfileDialog).not.toBeVisible();
    await expect(featurePage.profileUpdatedSuccessfullyText).toBeVisible();
  });

  test("[TC-005] Saving profile with matching non-empty passwords accepts the new password", {
    tag: ["@positive", "@functional", "@isolated-session"],
    annotation: [
      { type: "TC Key", description: "TC-005" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-15, AC-16, BR-3" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openStart();
    await featurePage.bButton.click();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.newPasswordInput).toBeVisible();
    await expect(featurePage.confirmPasswordInput).toBeVisible();
    await featurePage.startMyProfileDialogClickSaveChangesButtonFlow({ newPasswordInput: env('NEXOLVI_PASSWORD'), confirmPasswordInput: env('NEXOLVI_PASSWORD') });
    await expect(featurePage.profileUpdatedSuccessfullyText).toBeVisible();
  });

  test("[TC-007] Sign In button remains disabled when only the Email field contains a value", {
    tag: ["@negative", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-007" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-2, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openLogin();
    await expect(featurePage.workEmailInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.workEmailInput).toHaveValue('');
    await expect(featurePage.passwordInput).toHaveValue('');
    await featurePage.workEmailInput.fill('qa.user@example.test');
    await expect(featurePage.signInButton).not.toBeEnabled();
  });

  test("[TC-008] Sign In button remains disabled when only the Password field contains a value", {
    tag: ["@negative", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-008" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-2, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openLogin();
    await expect(featurePage.workEmailInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.workEmailInput).toHaveValue('');
    await expect(featurePage.passwordInput).toHaveValue('');
    await featurePage.passwordInput.fill('Aria_Pass_01!');
    await expect(featurePage.signInButton).not.toBeEnabled();
  });

  test("[TC-010] Sign In button becomes enabled when each field contains exactly one character", {
    tag: ["@edge", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-010" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-3, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openLogin();
    await expect(featurePage.signInButton).not.toBeEnabled();
    await featurePage.workEmailInput.fill('a');
    await featurePage.passwordInput.fill('b');
    await expect(featurePage.signInButton).toBeEnabled();
  });

  test("[TC-014] Saving the profile a second time in the same session succeeds", {
    tag: ["@positive", "@functional", "@regression", "@isolated-session"],
    annotation: [
      { type: "TC Key", description: "TC-014" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-14, AC-16" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openStart();
    await featurePage.bButton.click();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.nameInput).toBeVisible();
    await expect(featurePage.emailInput).toBeVisible();
    await expect(featurePage.phoneInput).toBeVisible();
    await expect(featurePage.newPasswordInput).toBeVisible();
    await expect(featurePage.confirmPasswordInput).toBeVisible();
    await featurePage.saveChangesButton.click();
    await expect(featurePage.myProfileDialog).not.toBeVisible();
    await expect(featurePage.profileUpdatedSuccessfullyText).toBeVisible();
    await featurePage.bButton.click();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.nameInput).toBeVisible();
    await expect(featurePage.emailInput).toBeVisible();
    await expect(featurePage.phoneInput).toBeVisible();
    await featurePage.saveChangesButton.click();
    await expect(featurePage.myProfileDialog).not.toBeVisible();
  });
});

// These tests start behind the login form, so they share one page and sign in once: signIn() resumes the session
// while it lasts and signs in again after a test ends it. They run in order on one worker; a failure restarts the
// worker, which opens a new page, so the tests after it still run.
sessionTest.describe("F-01 signed-in session", () => {
  sessionTest.describe.configure({ mode: 'default' });

  sessionTest.beforeAll(async ({ browser }) => {
    sessionPage = await browser.newPage();
  });

  sessionTest.afterAll(async () => {
    await sessionPage?.context().close();
  });

  sessionTest.beforeEach(async ({ page, featurePage, data }) => {
    await featurePage.openStart();
  });

  sessionTest("[TC-003] Opening My Profile modal shows pre-populated editable fields and Change Password section", {
    tag: ["@positive", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-003" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.dashboardHeading).toBeVisible();
    await featurePage.bButton.click();
    await expect(featurePage.bMenu).toBeVisible();
    await expect(featurePage.accountIdentifierText).toBeVisible();
    await expect(featurePage.bikashHtcText).toBeVisible();
    await expect(featurePage.profileMenuItem).toBeVisible();
    await expect(featurePage.logoutMenuItem).toBeVisible();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.myProfileHeading).toBeVisible();
    await expect(featurePage.viewAndEditYourAccountText).toBeVisible();
    await expect(featurePage.nameInput).toBeVisible();
    await expect(featurePage.emailInput).toBeVisible();
    await expect(featurePage.phoneInput).toBeVisible();
    await expect(featurePage.nameInput).toBeEnabled();
    await expect(featurePage.emailInput).toBeEnabled();
    await expect(featurePage.phoneInput).toBeEnabled();
    await expect(featurePage.changePasswordText).toBeVisible();
    await expect(featurePage.newPasswordInput).toBeVisible();
    await expect(featurePage.confirmPasswordInput).toBeVisible();
    await expect(featurePage.closeButton).toBeVisible();
  });

  sessionTest("[TC-006] Mismatched New Password and Confirm Password values reject the save with a mismatch error", {
    tag: ["@negative", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-006" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-14, AC-26, BR-3, BR-4" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.bButton.click();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.newPasswordInput).toBeVisible();
    await expect(featurePage.confirmPasswordInput).toBeVisible();
    await featurePage.startMyProfileDialogClickSaveChangesButtonFlow({ newPasswordInput: env('NEXOLVI_PASSWORD'), confirmPasswordInput: env('NEXOLVI_MISMATCH_PASSWORD') });
    await expect(featurePage.myProfileDialog).toBeVisible();
    await expect(featurePage.errorText).toBeVisible();
    await expect(featurePage.passwordsDoNotMatchText).toBeVisible();
  });

  sessionTest("[TC-009] Clicking Cancel discards unsaved changes and closes the modal leaving the user on the Dashboard", {
    tag: ["@negative", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-009" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-18, BR-5" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.bButton.click();
    await featurePage.profileMenuItem.click();
    await featurePage.nameInput.fill("Unsaved Name");
    await expect(featurePage.nameInput).toHaveValue('Unsaved Name');
    await featurePage.cancelButton.click();
    await expect(featurePage.myProfileDialog).not.toBeVisible();
    await expect(featurePage.dashboardHeading).toBeVisible();
    await featurePage.bButton.click();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.nameInput).toHaveValue('bikash.htc');
  });

  sessionTest("[TC-011] Clicking the Close X button on the My Profile modal closes the modal", {
    tag: ["@edge", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-011" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-9" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.bButton.click();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.closeButton).toBeVisible();
    await featurePage.closeButton.click();
    await expect(featurePage.myProfileDialog).not.toBeVisible();
    await expect(featurePage.dashboardHeading).toBeVisible();
  });

  sessionTest("[TC-012] My Profile modal and user menu display exact UI text and profile button shows correct tooltip", {
    tag: ["@edge", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-012" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-19, AC-20, AC-21, AC-22, AC-23, AC-24, AC-25" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.bButton).toHaveText('B');
    await featurePage.bButton.hover();
    await expect(featurePage.bButton).toHaveAttribute('title', 'bikash.htc');
    await featurePage.bButton.click();
    await expect(featurePage.bikashHtcText).toBeVisible();
    await expect(featurePage.accountIdentifierText).toBeVisible();
    await expect(featurePage.profileMenuItem).toBeVisible();
    await expect(featurePage.logoutMenuItem).toBeVisible();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.myProfileHeading).toHaveText('My Profile');
    await expect(featurePage.viewAndEditYourAccountText).toHaveText('View and edit your account information.');
    await expect(featurePage.newPasswordInput).toHaveAttribute('placeholder', 'Leave blank to keep current');
    await expect(featurePage.confirmPasswordInput).toHaveAttribute('placeholder', 'Repeat new password');
  });

  sessionTest("[TC-013] New Password and Confirm Password fields mask entered characters", {
    tag: ["@edge", "@security"],
    annotation: [
      { type: "TC Key", description: "TC-013" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-27" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.bButton.click();
    await featurePage.profileMenuItem.click();
    await expect(featurePage.changePasswordText).toBeVisible();
    await expect(featurePage.newPasswordInput).toBeVisible();
    await expect(featurePage.confirmPasswordInput).toBeVisible();
    await featurePage.newPasswordInput.fill(env('NEXOLVI_PASSWORD'));
    await featurePage.confirmPasswordInput.fill(env('NEXOLVI_PASSWORD'));
    await expect(featurePage.newPasswordInput).toHaveAttribute('type', 'password');
    await expect(featurePage.confirmPasswordInput).toHaveAttribute('type', 'password');
  });
});
