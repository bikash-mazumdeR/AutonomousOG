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

/**
 * Positive integer from the environment, or the fallback when unset, non-numeric or not positive.
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// An application whose first paint is slow — a large JavaScript bundle, a cold start, a throttled
// link — needs every budget raised together, so these are configurable rather than fixed.
const ACTION_TIMEOUT = envInt('PLAYWRIGHT_ACTION_TIMEOUT', 10000);
const NAVIGATION_TIMEOUT = envInt('PLAYWRIGHT_NAVIGATION_TIMEOUT', 15000);
// Web-first assertions carry their own budget, and Playwright's built-in default for it is 5s —
// independent of `actionTimeout`, so raising the action budget for a slow application does nothing
// for the assertion that waits on the result of that action. An assertion placed right after a
// submit is waiting on a server round trip plus a re-render, which is routinely slower than any
// single click or fill, so it defaults to the action budget rather than under it.
const EXPECT_TIMEOUT = envInt('PLAYWRIGHT_EXPECT_TIMEOUT', ACTION_TIMEOUT);
// A per-test budget smaller than the navigation and assertions it must contain fails the test before
// the page has settled, reported as a test timeout rather than as the slow page it is. Raising any
// one of those budgets therefore raises this floor with it, unless the caller sets an explicit value.
const TEST_TIMEOUT = envInt(
  'PLAYWRIGHT_TIMEOUT',
  Math.max(30000, NAVIGATION_TIMEOUT + ACTION_TIMEOUT + EXPECT_TIMEOUT + 5000),
);

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
  timeout: TEST_TIMEOUT,
  expect: { timeout: EXPECT_TIMEOUT },
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
    actionTimeout: ACTION_TIMEOUT,
    navigationTimeout: NAVIGATION_TIMEOUT,
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
