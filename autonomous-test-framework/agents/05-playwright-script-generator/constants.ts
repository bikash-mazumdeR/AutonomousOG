'use strict';

/**
 * @fileoverview Shared constants for Agent 05 — Playwright Script Generator.
 * Application-agnostic: no application-specific values may appear here.
 */

import * as path from 'path';

export const STAGE_ID = '05-playwright-script-generator';
export const STAGE_NAME = 'Playwright Script Generator';
export const STAGE_NUMBER = '05';
export const NEXT_STAGE = '06-automation-reviewer';

export const SKILLS_DIR = path.resolve(__dirname, '../../skills');
export const GENERIC_LEARNINGS_DIR = path.resolve(__dirname, 'learnings');

export type GenerationMode = 'UI' | 'API' | 'K6';

export const SKILL_FILES = Object.freeze({
  SHARED: 'automation-scripting.md',
  DISCOVERY: 'automation-discovery.md',
  UI: 'ui-scripting.md',
  API: 'api-scripting.md',
  K6: 'k6-scripting.md',
});

export const GENERIC_LEARNINGS_FILES: Readonly<Record<GenerationMode, string>> = Object.freeze({
  UI: 'ui-learnings.md',
  API: 'api-learnings.md',
  K6: 'k6-learnings.md',
});

/** Generic (application-agnostic) learnings for the discovery navigation planner. */
export const DISCOVERY_LEARNINGS_FILE = 'discovery-learnings.md';

export const PROJECT_LEARNINGS_FILES: Readonly<Record<GenerationMode, string>> = Object.freeze({
  UI: 'agent05-ui.md',
  API: 'agent05-api.md',
  K6: 'agent05-k6.md',
});

export const LLM_SETTINGS = Object.freeze({ TEMPERATURE: 0, MAX_TOKENS: 16384 });

/** Maximum approved test cases per generation call. */
export const MAX_TCS_PER_CALL = 6;

/** @enum {string} Per-test-case outcome of Agent 05. */
export const TC_OUTCOME = Object.freeze({
  GENERATED: 'GENERATED',
  NEEDS_CONTEXT: 'NEEDS_CONTEXT',
  BLOCKED: 'BLOCKED',
  EXCLUDED: 'EXCLUDED',
} as const);

export type TcOutcomeStatus = typeof TC_OUTCOME[keyof typeof TC_OUTCOME];

/** Header marker identifying files owned (and regenerated) by Agent 05. */
export const GENERATED_MARKER = '@aria-generated';

/** Fixture / helper identifiers available inside generated test bodies. */
export const PAGE_FIXTURE = 'featurePage';
export const DATA_FIXTURE = 'data';
export const ENV_FUNCTION = 'env';

/** Page-object method that performs the sign-in discovery verified; the framework env helper it reads credentials with. */
export const SIGN_IN_METHOD = 'signIn';
/** Page-object method that returns a still signed-in page to the signed-in state, so tests sharing one page sign in once. */
export const RESUME_SESSION_METHOD = 'resumeSession';
export const POM_ENV_FUNCTION = 'requireEnv';

/**
 * Step index discovery gives a test case's precondition. The precondition is the situation the test starts from —
 * "the user menu is open", "the user has logged out" — so it is planned and performed before step 1, and the actions
 * that established it are handed to the body generator as `preconditionActions`. It never has expected results.
 */
export const PRECONDITION_STEP_INDEX = 0;

/**
 * Page-object member for the element that shows the account identifier the session signed in with (an email or a
 * username in a user menu or account header). Its locator reads the identifier's environment variable at runtime, so
 * the value is never written into the page map, the page object or a test.
 */
export const ACCOUNT_IDENTIFIER_MEMBER = 'accountIdentifierText';

/**
 * Planner operation that requests a known state's address directly — no element, no sign-in, no action — the way a
 * step that says "the user navigates to the dashboard URL" is performed. In a page object it is the state's
 * `visit<State>()` method (or `open<State>()` for an entry state).
 */
export const GOTO_OPERATION = 'goto';

/**
 * Browser-storage accessors generated tests may call for application state that no locator can observe.
 * A body that uses one gets the helper import; the storage key always comes from the approved test case.
 */
export const STORAGE_HELPERS: readonly string[] = Object.freeze(['storedValue', 'storedDaysFromNow']);
export const K6_ENV_FUNCTION = 'requireEnv';

/**
 * `page` members a UI test body may use (everything else goes through the page object).
 * Limited to browser/viewport-level controls that have no meaningful page-object equivalent —
 * DOM interaction and content assertions must still go through `featurePage` locators.
 */
export const UI_PAGE_API: ReadonlySet<string> = new Set(['reload', 'goBack', 'goForward', 'keyboard', 'setViewportSize']);

export const API_TYPES: ReadonlySet<string> = new Set(['api', 'integration', 'contract']);
export const PERF_TYPES: ReadonlySet<string> = new Set(['performance', 'load', 'stress', 'spike', 'soak']);

export const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

/** Generic heuristics for auto-generated ids / attribute values that must not become locators. */
export const DYNAMIC_ID_HEURISTICS: readonly RegExp[] = Object.freeze([
  /\d{4,}/, /[a-f0-9]{10,}/i, /^:r[0-9a-z]*:?$/i, /^(ember|react-|mui-|radix-|headlessui-)/i,
]);

/**
 * Positive integer from the environment, or the fallback when the variable is unset, non-numeric or
 * not positive. A malformed override must never silently disable a timeout.
 * @param {string} name - Environment variable name
 * @param {number} fallback
 * @returns {number}
 */
function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const DISCOVERY_SETTINGS = Object.freeze({
  /**
   * Budget for one page load during discovery, overridable with DISCOVERY_NAVIGATION_TIMEOUT_MS.
   * Discovery waits for the load event, so an application whose first load is slow — a large
   * JavaScript bundle, a cold start, a throttled link — needs a larger budget than the default:
   * a page that has not finished rendering yields no elements, and every test case of the
   * feature is parked as NEEDS_CONTEXT.
   */
  // Read on access, not at module load: whether dotenv has populated process.env by then depends
  // on which entry point imported this file first.
  get NAVIGATION_TIMEOUT_MS(): number { return envInt('DISCOVERY_NAVIGATION_TIMEOUT_MS', 30000); },
  ACTION_TIMEOUT_MS: 10000,
  DOM_QUIET_MS: 400,
  DOM_SETTLE_MAX_MS: 5000,
  /** Overall bound on settling after an action; an application that polls never goes fully idle. */
  SETTLE_MAX_MS: 15000,
  /** Time an interaction is given to dispatch its request before in-flight requests are counted. */
  REQUEST_START_GRACE_MS: 800,
  /** Poll interval while in-flight requests drain. */
  IN_FLIGHT_POLL_MS: 100,
  /**
   * Poll interval for status messages while an action settles. A toast lives a few seconds and may be gone
   * by the time the page is quiet, so it is looked for while settling, not only when the state is captured.
   */
  NOTIFICATION_POLL_MS: 200,
  MAX_ELEMENTS_PER_STATE: 150,
  MAX_TEXT_LENGTH: 80,
  PLANNER_ATTEMPTS: 2,
  /** Budget for reading one element's accessibility snapshot; an element that vanished must not stall the capture. */
  ARIA_SNAPSHOT_TIMEOUT_MS: 2000,
  /** Poll interval while a client-rendered sign-in form finishes mounting before the bootstrap judges it. */
  SIGN_IN_FORM_POLL_MS: 250,
});

/**
 * Attribute discovery stamps on the elements it inventories so each can be addressed for its accessibility
 * snapshot; removed again before the capture ends.
 */
export const DISCOVERY_MARK_ATTRIBUTE = 'data-aria-discovery';

/**
 * Roles whose accessible name is their visible content, so that text also addresses them (`getByText`).
 * Everything else names itself by label, attribute or reference and is never matched by text.
 */
export const CONTENT_NAMED_ROLES: ReadonlySet<string> = new Set([
  'button', 'link', 'heading', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab', 'treeitem',
  'cell', 'gridcell', 'columnheader', 'rowheader', 'switch', 'listitem',
]);

/**
 * Roles whose open instance makes the page a different state at the same URL, in order of precedence when several
 * are open at once (a confirmation raised from a menu sits above the menu).
 */
export const OVERLAY_ROLES: readonly string[] = Object.freeze(['alertdialog', 'dialog', 'menu']);

/**
 * Roles of live regions: a status message, toast or alert the application announces after an action. Elements with
 * aria-live="polite" or "assertive" are live regions too, whatever their role.
 */
export const LIVE_REGION_ROLES: readonly string[] = Object.freeze(['status', 'alert', 'log']);

/**
 * Roles that are addressable by role alone (`getByRole('alertdialog')`) when the page holds exactly one: overlays,
 * landmarks and composite widgets. They typically carry no accessible name, which is why a role + name locator
 * cannot capture them, yet a test must reach them to assert what they show or to scope its own assertions.
 */
export const CONTAINER_ROLES: ReadonlySet<string> = new Set([
  'dialog', 'alertdialog', 'menu', 'menubar', 'alert', 'status', 'log', 'tooltip', 'navigation', 'main', 'banner',
  'contentinfo', 'complementary', 'search', 'form', 'region', 'tablist', 'tabpanel', 'toolbar', 'tree', 'grid',
  'table', 'list', 'listbox', 'radiogroup', 'progressbar',
]);

/** Verified flows: a run of at least MIN_ACTIONS actions that at least MIN_USERS test cases performed identically. */
export const FLOW_SETTINGS = Object.freeze({
  MIN_USERS: 2,
  MIN_ACTIONS: 2,
  NAME_SUFFIX: 'Flow',
});

/** Minimum number of tests in a spec before leading statements they all share are moved into beforeEach. */
export const HOOK_MIN_TESTS = 2;

/** Minimum number of tests that start by signing in before they share one signed-in page instead of signing in each. */
export const SESSION_MIN_TESTS = 2;

/**
 * Review label that keeps a test case out of the shared signed-in session: it gets a fresh page and its own sign-in,
 * so what earlier tests did in the session cannot change its outcome. Matched case-insensitively, ignoring separators.
 */
export const ISOLATED_SESSION_LABEL = 'Isolated Session';

/** Minimum length of a state-name word that must appear in an expected result before its URL path may be asserted. */
export const MIN_STATE_WORD_LENGTH = 3;
