// @aria-generated project=aria-project feature=F-01 source=tc_review_1789567816468
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
  });

  test("[TC-002] standard_user logs in with valid credentials and reaches the inventory page", {
    tag: ["@positive", "@smoke", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-002" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-5, AC-6, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.startClickLoginButtonFlow({ usernameInput: "standard_user", passwordInput: "secret_sauce" });
    await expect(page).toHaveURL(/\/inventory\.html/);
    await expect(featurePage.inventoryListElement).toBeVisible();
  });

  test("[TC-003] problem_user logs in and is redirected to the inventory page", {
    tag: ["@positive", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-003" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-7, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.startClickLoginButtonFlow({ usernameInput: "problem_user", passwordInput: "secret_sauce" });
    await expect(page).toHaveURL(/\/inventory\.html/);
  });

  test("[TC-004] visual_user logs in and is redirected to the inventory page", {
    tag: ["@positive", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-004" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-9, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.startClickLoginButtonFlow({ usernameInput: "visual_user", passwordInput: "secret_sauce" });
    await expect(page).toHaveURL(/\/inventory\.html/);
  });

  test("[TC-007] locked_out_user sees locked-out error and remains on the login page", {
    tag: ["@negative", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-007" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-10, AC-13, BR-5" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.startClickLoginButtonFlow({ usernameInput: "locked_out_user", passwordInput: "secret_sauce" });
    await expect(featurePage.errorElement).toContainText('Epic sadface: Sorry, this user has been locked out.');
    await expect(page).toHaveURL('/');
    await expect(featurePage.errorElement).toContainText('Epic sadface: Sorry, this user has been locked out.');
  });

  test("[TC-008] Invalid credentials display an error that persists until resubmission", {
    tag: ["@negative", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-008" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-11, AC-12" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(page).toHaveURL('/');
    await featurePage.startClickLoginButtonFlow({ usernameInput: data.invalidUsername, passwordInput: data.invalidPassword });
    await expect(featurePage.errorElement).toContainText('Epic sadface: Username and password do not match any user in this service');
    await expect(page).toHaveURL('/');
    await expect(featurePage.errorElement).toContainText('Epic sadface: Username and password do not match any user in this service');
  });

  test("[TC-011] Username entered in wrong case is rejected with invalid-credentials error", {
    tag: ["@negative", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-011" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-11, AC-15, BR-3" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(page).toHaveURL('/');
    await featurePage.startClickLoginButtonFlow({ usernameInput: "Standard_User", passwordInput: "secret_sauce" });
    await expect(featurePage.errorElement).toContainText('Epic sadface: Username and password do not match any user in this service');
    await expect(page).toHaveURL('/');
  });

  test("[TC-013] Error message clears when the page is refreshed", {
    tag: ["@negative", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-013" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-12, AC-13" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.usernameInput.fill(data.TC013_invalidUsername);
    await featurePage.passwordInput.fill(data.invalidPassword);
    await featurePage.loginButton.click();
    await expect(featurePage.errorElement).toContainText('Epic sadface: Username and password do not match any user in this service');
    await page.reload();
    await expect(featurePage.errorElement).not.toBeVisible();
    await expect(featurePage.usernameInput).toHaveValue('');
    await expect(featurePage.passwordInput).toHaveValue('');
  });
});
