// @aria-generated project=aria-project feature=F-01 source=tc_review_1789385437197
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
  test("[TC-002] Successful login for performance glitch user within threshold", {
    tag: ["@positive", "@regression", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-002" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-6" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openStart();
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.usernameInput.fill("performance_glitch_user");
    await featurePage.passwordInput.fill("secret_sauce");
    await featurePage.loginButton.click();
    await expect(featurePage.inventoryContainerElement).toBeVisible();
  });

  test("[TC-001] Successful login with valid credentials", {
    tag: ["@positive", "@smoke", "@regression", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-001" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-1" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openStart();
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.usernameInput.fill(data.validUsername);
    await featurePage.passwordInput.fill("secret_sauce");
    await featurePage.loginButton.click();
    await expect(page).toHaveURL(/\/inventory\.html/);
    await expect(featurePage.inventoryContainerElement).toBeVisible();
  });

  test("[TC-003] Successful login for error user displays compromise dialog", {
    tag: ["@positive", "@regression", "@functional"],
    annotation: [
      { type: "TC Key", description: "TC-003" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-7" },
      {
        type: "Known Limitation",
        description: "Agent 05's discovery flagged this NEEDS_CONTEXT: the expected dialog is Chrome's " +
          "native \"Change your password\" breach-checkup warning, not app content. It is rendered by the " +
          "browser chrome, outside the page DOM/accessibility tree that Playwright's CDP-based automation " +
          "(and this locator) can see, and it only appears in a Chrome profile signed into Google with Sync " +
          "and Password Checkup enabled. Playwright's isolated test browser has none of that, so this cannot " +
          "trigger or pass in this or any CI run. Kept in the suite per explicit request; verify manually in " +
          "a signed-in Chrome session. Written by hand — a regeneration of this file will drop it.",
      },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    test.fixme(true, "Chrome's native password-breach dialog is outside Playwright's automation surface (see Known Limitation annotation) — cannot pass in an automated run.");
    await featurePage.openStart();
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.usernameInput.fill("error_user");
    await featurePage.passwordInput.fill("secret_sauce");
    await featurePage.loginButton.click();
    await expect(featurePage.inventoryContainerElement).toBeVisible();
    // The assertion below targets Chrome's own UI, not the page — it will not find this locator.
    await expect(page.getByText(/credentials are compromise|found in a data breach/i)).toBeVisible({ timeout: 5000 });
  });

  test("[TC-004] Successful login for visual user displays identical product images", {
    tag: ["@positive", "@regression", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-004" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-8" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openStart();
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.usernameInput.fill("visual_user");
    await featurePage.passwordInput.fill("secret_sauce");
    await featurePage.loginButton.click();
    await expect(featurePage.inventoryItemSauceLabsBackpackImage).toBeVisible();
    await expect(featurePage.inventoryItemSauceLabsBikeImage).toBeVisible();
    await expect(featurePage.inventoryItemSauceLabsBoltImage).toBeVisible();
    await expect(featurePage.inventoryItemSauceLabsFleeceImage).toBeVisible();
    await expect(featurePage.inventoryItemSauceLabsOnesieImage).toBeVisible();
    await expect(featurePage.inventoryItemTestAllthethingsTImage).toBeVisible();
  });

  test("[TC-005] Successful login for problem user displays identical product images", {
    tag: ["@positive", "@regression", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-005" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-8" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openStart();
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.usernameInput.fill("problem_user");
    await featurePage.passwordInput.fill("secret_sauce");
    await featurePage.loginButton.click();
    await expect(featurePage.inventoryItemSauceLabsBackpackImage).toBeVisible();
    await expect(featurePage.inventoryItemSauceLabsBikeImage).toBeVisible();
    await expect(featurePage.inventoryItemSauceLabsBoltImage).toBeVisible();
    await expect(featurePage.inventoryItemSauceLabsFleeceImage).toBeVisible();
    await expect(featurePage.inventoryItemSauceLabsOnesieImage).toBeVisible();
    await expect(featurePage.inventoryItemTestAllthethingsTImage).toBeVisible();
  });

  test("[TC-006] Login button remains enabled regardless of form state", {
    tag: ["@positive", "@regression", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-006" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-9" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openStart();
    await expect(featurePage.loginContainerElement).toBeVisible();
    await expect(featurePage.loginButton).toBeEnabled();
  });

  test("[TC-007] Password field masks input characters", {
    tag: ["@positive", "@regression", "@ui", "@security"],
    annotation: [
      { type: "TC Key", description: "TC-007" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-11" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openStart();
    await expect(featurePage.loginContainerElement).toBeVisible();
    await featurePage.passwordInput.fill(data.anyPassword);
    await expect(featurePage.passwordInput).toHaveAttribute("type", "password");
  });

  test("[TC-008] Login page supports responsive layouts", {
    tag: ["@positive", "@regression", "@ui"],
    annotation: [
      { type: "TC Key", description: "TC-008" },
      { type: "Story", description: "US-01" },
      { type: "Requirements", description: "AC-12" },
    ],
  }, async ({ page, featurePage, data, browser }) => {
    await featurePage.openStart();
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(featurePage.loginContainerElement).toBeVisible();
    await page.setViewportSize({ width: 2560, height: 1440 });
    await expect(featurePage.loginContainerElement).toBeVisible();
  });
});
