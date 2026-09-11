// @ts-check
import { defineConfig, devices } from '@playwright/test';

'use strict';

/**
 * @fileoverview Playwright Global Configuration — ARIA Framework
 * All settings driven by environment variables for CI/CD compatibility.
 * @see https://playwright.dev/docs/test-configuration
 */

require('dotenv').config();

module.exports = defineConfig({
  // ── Test Discovery ───────────────────────────────────────────────────────
  testDir: './tests/specs',
  testMatch: '**/*.spec.ts',

  // ── Execution Settings ───────────────────────────────────────────────────
  fullyParallel: true,
  workers: parseInt(process.env.PLAYWRIGHT_WORKERS || '3', 10),
  retries: parseInt(process.env.PLAYWRIGHT_RETRIES || '1', 10),
  timeout: parseInt(process.env.PLAYWRIGHT_TIMEOUT || '30000', 10),
  forbidOnly: !!process.env.CI, // Fail if test.only left in code in CI

  // ── Reporting ────────────────────────────────────────────────────────────
  reporter: [
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/json/playwright-results.json' }],
    ['junit', { outputFile: 'reports/json/junit-results.xml' }],
    ['list'],
  ],

  // ── Global Use Settings ──────────────────────────────────────────────────
  use: {
    baseURL: process.env.AUT_BASE_URL || 'http://localhost:3000',
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
    actionTimeout: 10000,
    navigationTimeout: 15000,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,

    testIdAttribute: process.env.PLAYWRIGHT_TEST_ID_ATTRIBUTE || 'data-test',
  },

  // ── Output Directory ─────────────────────────────────────────────────────
  outputDir: 'reports/attachments',

  // ── Browser Projects ─────────────────────────────────────────────────────
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
    // Uncomment for cross-browser:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',  use: { ...devices['Desktop Safari']  } },
  ],
});
