// @aria-generated project=aria-project feature=F-01 source=tc_review_1789651410724
// Rendered by ARIA Agent 05 from approved test cases. Do not edit by hand; regenerate instead.
import { test as base, expect } from '@playwright/test';
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
    await expect(featurePage.loginContainerElement).toBeVisible();
  });

  test("[TC-002] Login button is enabled and labelled correctly regardless of empty fields", {
    tag: ["@positive", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-002" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-3, AC-4, BR-6" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginButton).toBeEnabled();
    await expect(featurePage.loginButton).toHaveText('Login');
    await expect(featurePage.loginButton).toHaveAttribute('type', 'submit');
  });

  test("[TC-003] standard_user logs in with valid credentials and is redirected to inventory", {
    tag: ["@positive", "@smoke", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-003" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-5, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.startClickLoginButtonFlow({ usernameInput: "standard_user", passwordInput: "secret_sauce" });
    await expect(page).toHaveURL('/inventory.html');
    await expect(featurePage.inventoryListElement).toBeVisible();
  });

  test("[TC-004] problem_user logs in with valid credentials and is redirected to inventory", {
    tag: ["@positive", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-004" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-6, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.startClickLoginButtonFlow({ usernameInput: "problem_user", passwordInput: "secret_sauce" });
    await expect(page).toHaveURL('/inventory.html');
    await expect(featurePage.inventoryListElement).toBeVisible();
  });

  test("[TC-006] locked_out_user is denied access and sees the locked-out error message", {
    tag: ["@negative", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-006" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-8, AC-28, BR-4" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.startClickLoginButtonFlow({ usernameInput: "locked_out_user", passwordInput: "secret_sauce" });
    await expect(featurePage.errorElement).toContainText('Epic sadface: Sorry, this user has been locked out.');
    await expect(page).toHaveURL('/');
    await expect(featurePage.loginContainerElement).toBeVisible();
  });

  test("[TC-007] Unrecognised credentials display the invalid credentials error message", {
    tag: ["@negative", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-007" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-9, AC-27" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.startClickLoginButtonFlow({ usernameInput: data.unregisteredUsername, passwordInput: data.wrongPassword });
    await expect(featurePage.errorElement).toContainText('Epic sadface: Username and password do not match any user in this service');
    await expect(page).toHaveURL('/');
    await expect(featurePage.loginContainerElement).toBeVisible();
  });

  test("[TC-008] Submitting with an empty Username field displays the username required error", {
    tag: ["@negative", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-008" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-11, AC-25" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.loginButton.click();
    await expect(featurePage.errorElement).toContainText('Epic sadface: Username is required');
    await expect(page).toHaveURL('/');
  });

  test("[TC-010] Invalid credentials error message persists until the form is resubmitted", {
    tag: ["@negative", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-010" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-10, AC-29" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.startClickLoginButtonFlow({ usernameInput: data.TC010_unregisteredUsername, passwordInput: data.TC010_wrongPassword });
    await expect(featurePage.errorElement).toContainText('Epic sadface: Username and password do not match any user in this service');
    await expect(featurePage.errorElement).toContainText('Epic sadface: Username and password do not match any user in this service');
  });

  test("[TC-015] Credentials Info Box lists all accepted usernames and the shared password hint", {
    tag: ["@edge", "@functional", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-015" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-16" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.acceptedUsernamesAreHeading).toBeVisible();
    await expect(featurePage.loginCredentialsElement).toContainText('standard_user');
    await expect(featurePage.loginCredentialsElement).toContainText('locked_out_user');
    await expect(featurePage.loginCredentialsElement).toContainText('problem_user');
    await expect(featurePage.loginCredentialsElement).toContainText('performance_glitch_user');
    await expect(featurePage.loginCredentialsElement).toContainText('error_user');
    await expect(featurePage.loginCredentialsElement).toContainText('visual_user');
    await expect(featurePage.passwordForAllUsersHeading).toBeVisible();
    await expect(featurePage.loginPasswordElement).toContainText('secret_sauce');
  });
});
