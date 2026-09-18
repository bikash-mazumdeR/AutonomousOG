// @aria-generated project=nexolvi feature=F-01 source=tc_review_1789744904509
// Rendered by ARIA Agent 05 from approved test cases. Do not edit by hand; regenerate instead.
import { test as base, expect } from '@playwright/test';
import { requireEnv as env } from '../../../helpers/env';
import { storedDaysFromNow } from '../../../helpers/storage';
import fixtureData from '../fixtures/test-data.json';
import { F01Page } from '../pages/F01Page';

const test = base.extend<{ featurePage: F01Page; data: typeof fixtureData }>({
  featurePage: async ({ page }, use) => {
    await use(new F01Page(page));
  },
  // eslint-disable-next-line no-empty-pattern
  data: async ({}, use) => {
    await use(fixtureData);
  },
});

test.describe("F-01", () => {
  test.beforeEach(async ({ page, featurePage, data }) => {
    await featurePage.openStart();
    await expect(featurePage.welcomeToNexolviHeading).toBeVisible();
  });

  test("[TC-001] Successful login with valid credentials redirects to the Nexo Desk Dashboard", {
    tag: ["@positive", "@smoke", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-001" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-8, AC-10, AC-11" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.workEmailInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.rememberMeFor30DaysCheckbox).toBeVisible();
    await expect(featurePage.signInButton).toBeVisible();
    await featurePage.startClickSignInButtonFlow({ workEmailInput: env('NEXOLVI_EMAIL'), passwordInput: env('NEXOLVI_PASSWORD') });
    await expect(featurePage.dashboardHeading).toBeVisible();
  });

  test("[TC-002] Sign In button becomes enabled when both Email and Password fields contain at least one character", {
    tag: ["@positive", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-002" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-4, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.workEmailInput.fill(data.anyEmail);
    await featurePage.passwordInput.fill(data.anyPassword);
    await expect(featurePage.signInButton).toBeEnabled();
  });

  test("[TC-003] Password field masks its value by default on the login page", {
    tag: ["@positive", "@functional", "@security"],
    annotation: [
      { type: "TC Key", description: "TC-003" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-12, AC-16" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.passwordInput.fill(env('NEXOLVI_PASSWORD'));
    await expect(featurePage.passwordInput).toHaveAttribute('type', 'password');
  });

  test("[TC-004] Clicking the eye icon once reveals the password and clicking it again re-masks it", {
    tag: ["@positive", "@functional", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-004" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-13, AC-14" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.passwordInput.fill(env('NEXOLVI_PASSWORD'));
    await featurePage.showPasswordButton.click();
    await expect(featurePage.passwordInput).toHaveAttribute('type', 'text');
    await featurePage.passwordVisibilityToggle.click();
    await expect(featurePage.passwordInput).toHaveAttribute('type', 'password');
  });

  test("[TC-005] Selecting Remember Me during successful login persists the session for 30 days", {
    tag: ["@positive", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-005" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-9, BR-3" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.workEmailInput.fill(env('NEXOLVI_EMAIL'));
    await featurePage.passwordInput.fill(env('NEXOLVI_PASSWORD'));
    await featurePage.rememberMeFor30DaysCheckbox.check();
    await featurePage.signInButton.click();
    await expect(featurePage.dashboardHeading).toBeVisible();
    await expect.poll(() => storedDaysFromNow(page, 'auth_expires_at')).toBe(30);
  });

  test("[TC-006] Submitting an invalid email with a valid password displays the Login failed error in the DOM", {
    tag: ["@negative", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-006" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-5, AC-15, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.startClickSignInButtonFlow({ workEmailInput: data.invalidEmail, passwordInput: "admin" });
    await expect(featurePage.loginErrorAlert).toBeVisible();
    await expect(featurePage.loginErrorAlert).toContainText('Login failed');
  });

  test("[TC-007] Submitting a valid email with an invalid password displays the Login failed error in the DOM", {
    tag: ["@negative", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-007" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-6, AC-15, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.startClickSignInButtonFlow({ workEmailInput: "bikash.htc@gmail.com", passwordInput: data.invalidPassword });
    await expect(featurePage.loginErrorAlert).toContainText('Login failed');
  });

  test("[TC-008] Submitting an invalid email and an invalid password displays the Login failed error in the DOM", {
    tag: ["@negative", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-008" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-7, AC-15, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.startClickSignInButtonFlow({ workEmailInput: data.invalidEmail, passwordInput: data.invalidPassword });
    await expect(featurePage.loginErrorAlert).toContainText('Login failed');
  });

  test("[TC-009] User remains on the login page after submitting invalid credentials", {
    tag: ["@negative", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-009" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-5, AC-6, AC-7, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.startClickSignInButtonFlow({ workEmailInput: data.invalidEmail, passwordInput: data.invalidPassword });
    await expect(page).toHaveURL('/');
  });

  test("[TC-010] Sign In button is disabled when both Email and Password fields are empty", {
    tag: ["@edge", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-010" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-1, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.signInButton).toBeDisabled();
  });

  test("[TC-011] Sign In button is disabled when only the Email field has a value and Password is empty", {
    tag: ["@edge", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-011" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-2, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.workEmailInput.fill(env('NEXOLVI_EMAIL'));
    await expect(featurePage.signInButton).toBeDisabled();
  });

  test("[TC-012] Sign In button is disabled when only the Password field has a value and Email is empty", {
    tag: ["@edge", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-012" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-3, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.passwordInput.fill(env('NEXOLVI_PASSWORD'));
    await expect(featurePage.signInButton).toBeDisabled();
  });
});
