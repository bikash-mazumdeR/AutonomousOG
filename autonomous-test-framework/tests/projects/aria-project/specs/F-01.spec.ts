// @aria-generated project=aria-project feature=F-01 source=tc_review_1789555293871
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

  test("[TC-001] Standard user with valid credentials is redirected to the inventory page", {
    tag: ["@positive", "@smoke", "@regression", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-001" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-1, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await featurePage.usernameInput.fill('standard_user');
    await featurePage.passwordInput.fill('secret_sauce');
    await featurePage.loginButton.click();
    await expect(page).toHaveURL(/\/inventory\.html$/);
  });

  test("[TC-006] Password field accepts pasted input and authenticates successfully", {
    tag: ["@positive", "@regression", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-006" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-6" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.passwordInput).toBeVisible();
    await featurePage.usernameInput.fill('standard_user');
    await featurePage.passwordInput.fill('secret_sauce');
    await featurePage.loginButton.click();
    await expect(page).toHaveURL(/\/inventory\.html$/);
  });

  test("[TC-008] Login page title is Swag Labs", {
    tag: ["@positive", "@regression", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-008" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-8" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginContainerElement).toBeVisible();
    await expect(page).toHaveTitle('Swag Labs');
  });

  test("[TC-011] Login page is functional and usable at 1920px desktop viewport width", {
    tag: ["@positive", "@regression", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-011" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-10" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginContainerElement).toBeVisible();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await expect(featurePage.usernameInput).toBeEnabled();
    await expect(featurePage.passwordInput).toBeEnabled();
    await expect(featurePage.loginButton).toBeEnabled();
  });

  test("[TC-019] Invalid-credentials error persists until the form is resubmitted", {
    tag: ["@positive", "@regression", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-019" },
      { type: "Story", description: "US-02" },
      { type: "Requirements", description: "AC-3, BR-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await featurePage.usernameInput.fill(data.invalidUsername);
    await featurePage.passwordInput.fill(data.invalidPassword);
    await featurePage.loginButton.click();
    await expect(featurePage.errorElement).toContainText('Epic sadface: Username and password do not match any user in this service');
    await expect(featurePage.errorElement).toContainText('Epic sadface: Username and password do not match any user in this service');
  });

  test("[TC-024] Locked out user login attempt displays the locked-out error message and remains on login page", {
    tag: ["@positive", "@smoke", "@regression", "@functional", "@error-handling"],
    annotation: [
      { type: "TC Key", description: "TC-024" },
      { type: "Story", description: "US-03" },
      { type: "Requirements", description: "AC-1, AC-2, AC-3, BR-1, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await featurePage.usernameInput.fill('locked_out_user');
    await featurePage.passwordInput.fill('secret_sauce');
    await featurePage.loginButton.click();
    await expect(featurePage.errorElement).toContainText('Epic sadface: Sorry, this user has been locked out.');
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
  });

  test("[TC-027] problem_user logs in with valid credentials and reaches the inventory page", {
    tag: ["@positive", "@smoke", "@regression", "@functional", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-027" },
      { type: "Story", description: "US-04" },
      { type: "Requirements", description: "AC-1, AC-3, BR-1, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await featurePage.usernameInput.fill('problem_user');
    await featurePage.passwordInput.fill('secret_sauce');
    await featurePage.loginButton.click();
    await expect(page).toHaveURL('/inventory.html');
    await expect(featurePage.inventoryListElement).toBeVisible();
  });

  test("[TC-028] visual_user logs in with valid credentials and reaches the inventory page", {
    tag: ["@positive", "@regression", "@functional", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-028" },
      { type: "Story", description: "US-04" },
      { type: "Requirements", description: "AC-2, AC-4, BR-1, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await featurePage.usernameInput.fill('visual_user');
    await featurePage.passwordInput.fill('secret_sauce');
    await featurePage.loginButton.click();
    await expect(page).toHaveURL('/inventory.html');
    await expect(featurePage.inventoryListElement).toBeVisible();
  });
});
