// @aria-generated project=aria-project feature=F-01 source=tc_review_1789490485178
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

  test("[TC-006] Login button is visible and enabled when both fields are empty", {
    tag: ["@positive", "@smoke", "@regression", "@functional", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-006" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-5, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginContainerElement).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await expect(featurePage.loginButton).toBeEnabled();
  });

  test("[TC-007] Login button remains enabled after entering text in the Username field only", {
    tag: ["@positive", "@regression", "@functional", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-007" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-5, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.usernameInput.fill(data.validUsername);
    await expect(featurePage.loginButton).toBeEnabled();
  });

  test("[TC-008] Login button remains enabled after entering text in the Password field only", {
    tag: ["@positive", "@regression", "@functional", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-008" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-5, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.passwordInput.fill(data.validPassword);
    await expect(featurePage.loginButton).toBeEnabled();
  });

  test("[TC-015] Standard user login with valid credentials redirects to inventory page", {
    tag: ["@positive", "@smoke", "@regression", "@functional", "@security"],
    annotation: [
      { type: "TC Key", description: "TC-015" },
      { type: "Story", description: "US-02" },
      { type: "Requirements", description: "AC-1, AC-2, AC-4, BR-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await featurePage.startClickLoginButtonFlow({ usernameInput: "standard_user", passwordInput: "secret_sauce" });
    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(page).toHaveURL(/\/inventory\.html$/);
  });

  test("[TC-016] Login button remains enabled throughout the login interaction for standard user", {
    tag: ["@positive", "@regression", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-016" },
      { type: "Story", description: "US-02" },
      { type: "Requirements", description: "AC-3" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.loginButton).toBeVisible();
    await expect(featurePage.loginButton).toBeEnabled();
    await featurePage.startClickLoginButtonFlow({ usernameInput: "standard_user", passwordInput: "secret_sauce" });
    await expect(featurePage.loginButton).toBeEnabled();
  });

  test("[TC-024] Login button remains enabled when both username and password fields are empty", {
    tag: ["@positive", "@smoke", "@regression", "@functional", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-024" },
      { type: "Story", description: "US-04" },
      { type: "Requirements", description: "AC-6" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await expect(featurePage.loginButton).toBeEnabled();
  });

  test("[TC-038] Performance glitch user login redirects to inventory page within 5000 ms", {
    tag: ["@positive", "@smoke", "@regression", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-038" },
      { type: "Story", description: "US-07" },
      { type: "Requirements", description: "AC-1, AC-2" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await featurePage.usernameInput.fill("performance_glitch_user");
    await featurePage.passwordInput.fill("secret_sauce");
    await featurePage.loginButton.click();
    await expect(page).toHaveURL(/\/inventory\.html/, { timeout: 5000 });
  });

  test("[TC-040] Login button remains enabled during the slow-load period for performance glitch user", {
    tag: ["@positive", "@regression", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-040" },
      { type: "Story", description: "US-07" },
      { type: "Requirements", description: "AC-1, AC-4" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await expect(featurePage.usernameInput).toBeVisible();
    await expect(featurePage.passwordInput).toBeVisible();
    await expect(featurePage.loginButton).toBeVisible();
    await expect(featurePage.loginButton).toBeEnabled();
    await featurePage.startClickLoginButtonFlow({ usernameInput: "performance_glitch_user", passwordInput: "secret_sauce" });
    await expect(featurePage.loginButton).toBeEnabled();
    await expect(page).toHaveURL(/\/inventory\.html/);
  });
});
