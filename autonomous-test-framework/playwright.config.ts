import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { readActiveProjectSlug } from './core/aut/projectPaths';
import { loadFrameworkEnv, resolveAutBaseUrl } from './core/aut/autBaseUrl';
import { otherBrowsersPattern } from './core/readiness/browserTargets';

/**
 * @fileoverview Playwright Global Configuration — ARIA Framework
 * Application-agnostic: the active project (ARIA_PROJECT_ID env, or the marker written by Agent 05) selects
 * the generated test folder and its AUT profile (base URL env var, test-id attribute, browsers).
 * @see https://playwright.dev/docs/test-configuration
 */

// Load autonomous-test-framework/.env even when Playwright is started from another folder (IDE, workspace root)
loadFrameworkEnv();

const projectSlug = readActiveProjectSlug();
const profileFile = projectSlug ? path.join(__dirname, 'projects', projectSlug, 'aut-profile.json') : null;
const profile = profileFile && fs.existsSync(profileFile) ? JSON.parse(fs.readFileSync(profileFile, 'utf-8')) : null;
const projectSpecsDir = projectSlug ? path.join(__dirname, 'tests', 'projects', projectSlug, 'specs') : null;
const browsers: string[] = Array.isArray(profile?.browsers) && profile.browsers.length > 0 ? profile.browsers : ['chromium'];

const BROWSER_PROJECTS: Record<string, any> = {
  chromium: { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  firefox: { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  webkit: { name: 'webkit', use: { ...devices['Desktop Safari'] } },
};

module.exports = defineConfig({
  // ── Test Discovery ───────────────────────────────────────────────────────
  testDir: projectSpecsDir && fs.existsSync(projectSpecsDir) ? projectSpecsDir : './tests/specs',
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
    // Streams per-test progress as NDJSON so the Agent 07 UI can render a live results grid.
    // No-ops unless ARIA_PROGRESS_FILE is set, so a manual `npx playwright test` is unaffected.
    [path.join(__dirname, 'core', 'reporters', 'AriaProgressReporter.ts')],
    // An agent-driven run already gets structured progress from the reporter above, so the
    // chattier `list` output is only worth its log volume for a human-driven terminal run.
    [process.env.ARIA_PROGRESS_FILE ? 'dot' : 'list'],
  ],

  // ── Global Use Settings ──────────────────────────────────────────────────
  use: {
    // Fails fast when unset — a default URL would silently run every test against the wrong application
    baseURL: resolveAutBaseUrl(profile?.baseUrlEnv),
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
    actionTimeout: 10000,
    navigationTimeout: 15000,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    testIdAttribute: process.env.PLAYWRIGHT_TEST_ID_ATTRIBUTE || profile?.testIdAttribute || 'data-testid',
  },

  // ── Output Directory ─────────────────────────────────────────────────────
  outputDir: 'reports/attachments',

  // ── Browser Projects (from the AUT profile) ──────────────────────────────
  // A test tagged @browser-<engine> (a browser-specific test case) runs only in that browser's project
  projects: browsers.filter((name) => BROWSER_PROJECTS[name]).map((name) => ({ ...BROWSER_PROJECTS[name], grepInvert: otherBrowsersPattern(name) })),
});
