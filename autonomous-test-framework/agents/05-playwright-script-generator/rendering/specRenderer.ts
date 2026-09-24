'use strict';

/**
 * @fileoverview Deterministic spec / script renderer. Code — not the LLM — owns imports, fixtures, describe
 * blocks, titles, tags, annotations, K6 options and summaries. The LLM only supplies validated test bodies.
 */

import * as path from 'path';
import { GENERATED_MARKER, STORAGE_HELPERS } from '../constants';
import { SLA_PATTERN } from '../../../core/readiness/readinessConstants';
import { browserTag } from '../../../core/readiness/browserTargets';
import { AutomationTestCase } from '../contracts/automationTestCase';
import { SESSION_TEST_OBJECT } from '../../../core/automation-reviewer/reviewTypes';

/** A test case with its validated body. */
export interface RenderedTest {
  tc: AutomationTestCase;
  body: string;
}

/** Common render context. */
export interface SpecRenderContext {
  projectSlug: string;
  featureId: string;
  sourceReviewId: string | null;
}

/** UI spec parameters. */
export interface UiSpecParams extends SpecRenderContext {
  pageObject: string;
  pomImport: string;
  fixtureImport: string;
  envImport: string;
  /** Import path of the browser-storage helpers, added only when a body uses them. */
  storageImport: string;
  /** Statements every test starts with, rendered once as test.beforeEach. */
  hook?: string[];
  tests: RenderedTest[];
  /** Tests that start behind the login form: rendered in their own block that shares one signed-in page. */
  sessionTests?: RenderedTest[];
  /** Statements every session test starts with, rendered once as that block's beforeEach. */
  sessionHook?: string[];
}

/** API spec parameters. */
export interface ApiSpecParams extends SpecRenderContext {
  fixtureImport: string;
  envImport: string;
  authHeaderEnv?: string;
  basePathEnv?: string;
  tests: RenderedTest[];
}

/** K6 script parameters. */
export interface K6ScriptParams extends SpecRenderContext {
  tc: AutomationTestCase;
  body: string;
  baseUrlEnv: string;
  thresholdEnv?: string;
}

/**
 * Relative ES import path (TypeScript extension removed, POSIX separators).
 * @param {string} fromDir
 * @param {string} toFile
 * @returns {string}
 */
export function importPath(fromDir: string, toFile: string): string {
  const relative = path.relative(fromDir, toFile).replace(/\\/g, '/').replace(/\.ts$/, '');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function slug(value: string): string {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Test title rendered from the approved test case.
 * @param {AutomationTestCase} tc
 * @returns {string}
 */
export function renderTestTitle(tc: AutomationTestCase): string {
  return `[${tc.tcKey}] ${tc.title}`;
}

/**
 * Tags from the test case type and labels, plus a browser tag for each browser the test case targets (the browser
 * projects in playwright.config.ts run a tagged test only in its own browser).
 * @param {AutomationTestCase} tc
 * @returns {string[]}
 */
export function renderTags(tc: AutomationTestCase): string[] {
  const browserTags = (tc.targetBrowsers || []).filter((target) => target.engine).map((target) => browserTag(target.engine as string));
  return [...new Set([...[tc.type, ...tc.labels].map(slug).filter(Boolean).map((tag) => `@${tag}`), ...browserTags])];
}

/**
 * Traceability annotations.
 * @param {AutomationTestCase} tc
 * @returns {Array<{ type: string, description: string }>}
 */
export function renderAnnotations(tc: AutomationTestCase): Array<{ type: string; description: string }> {
  const annotations = [{ type: 'TC Key', description: tc.tcKey }];
  if (tc.userStoryId) annotations.push({ type: 'Story', description: tc.userStoryId });
  if (tc.requirementRefs.length > 0) annotations.push({ type: 'Requirements', description: tc.requirementRefs.join(', ') });
  return annotations;
}

/**
 * Re-indents a code block to a fixed indentation, preserving relative nesting.
 * @param {string} code
 * @param {number} spaces
 * @returns {string}
 */
export function indent(code: string, spaces: number): string {
  const lines = String(code).replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '').split('\n');
  const widths = lines.filter((line) => line.trim()).map((line) => (line.match(/^ */) as RegExpMatchArray)[0].length);
  const common = widths.length > 0 ? Math.min(...widths) : 0;
  const pad = ' '.repeat(spaces);
  return lines.map((line) => (line.trim() ? `${pad}${line.slice(common)}` : '')).join('\n');
}

function header(ctx: SpecRenderContext): string[] {
  return [
    `// ${GENERATED_MARKER} project=${ctx.projectSlug} feature=${ctx.featureId} source=${ctx.sourceReviewId || 'unknown'}`,
    '// Rendered by ARIA Agent 05 from approved test cases. Do not edit by hand; regenerate instead.',
  ];
}

function renderTestBlock(tc: AutomationTestCase, body: string, fixtureParams: string, testFn = 'test'): string {
  return [
    `  ${testFn}(${JSON.stringify(renderTestTitle(tc))}, {`,
    `    tag: [${renderTags(tc).map((tag) => JSON.stringify(tag)).join(', ')}],`,
    '    annotation: [',
    ...renderAnnotations(tc).map((a) => `      { type: ${JSON.stringify(a.type)}, description: ${JSON.stringify(a.description)} },`),
    '    ],',
    `  }, async (${fixtureParams}) => {`,
    indent(body, 4),
    '  });',
  ].join('\n');
}

function dataFixtureLines(): string[] {
  return [
    '  // eslint-disable-next-line no-empty-pattern',
    '  data: async ({}, use) => {',
    '    await use(fixtureData);',
    '  },',
  ];
}

function renderHook(hook: string[], testFn = 'test'): string {
  return [`  ${testFn}.beforeEach(async ({ page, featurePage, data }) => {`, indent(hook.join('\n'), 4), '  });'].join('\n');
}

/** Name of the test object whose page fixture is the shared signed-in page. */
const SESSION_TEST = SESSION_TEST_OBJECT;
const UI_FIXTURE_PARAMS = '{ page, featurePage, data, browser }';

/** The shared page and the test object that hands it to every session test in place of a fresh one. */
function sessionFixtureLines(): string[] {
  return [
    '',
    '// One signed-in page shared by the tests that start behind the login form (see the session block below).',
    'let sessionPage: Page;',
    `const ${SESSION_TEST} = test.extend({`,
    '  // eslint-disable-next-line no-empty-pattern',
    '  page: async ({}, use) => {',
    '    await use(sessionPage);',
    '  },',
    '});',
  ];
}

function renderSessionBlock(p: UiSpecParams): string[] {
  const sessionHook = p.sessionHook || [];
  return [
    '',
    '// These tests start behind the login form, so they share one page and sign in once: signIn() resumes the session',
    '// while it lasts and signs in again after a test ends it. They run in order on one worker; a failure restarts the',
    '// worker, which opens a new page, so the tests after it still run.',
    `${SESSION_TEST}.describe(${JSON.stringify(`${p.featureId} signed-in session`)}, () => {`,
    `  ${SESSION_TEST}.describe.configure({ mode: 'default' });`,
    '',
    `  ${SESSION_TEST}.beforeAll(async ({ browser }) => {`,
    '    sessionPage = await browser.newPage();',
    '  });',
    '',
    `  ${SESSION_TEST}.afterAll(async () => {`,
    '    await sessionPage?.context().close();',
    '  });',
    '',
    ...(sessionHook.length > 0 ? [renderHook(sessionHook, SESSION_TEST), ''] : []),
    (p.sessionTests || []).map((t) => renderTestBlock(t.tc, t.body, UI_FIXTURE_PARAMS, SESSION_TEST)).join('\n\n'),
    '});',
  ];
}

/**
 * Renders a UI spec file. `hook` statements run in test.beforeEach before every test body. Session tests, when
 * given, follow in their own block sharing one signed-in page.
 * @param {UiSpecParams} p
 * @returns {string}
 */
export function renderUiSpec(p: UiSpecParams): string {
  const hook = p.hook || [];
  const sessionTests = p.sessionTests || [];
  const hasSession = sessionTests.length > 0;
  const bodies = [...hook, ...(p.sessionHook || []), ...[...p.tests, ...sessionTests].map((t) => t.body)];
  const usesEnv = bodies.some((code) => /\benv\(/.test(code));
  const storageHelpers = STORAGE_HELPERS.filter((helper) => bodies.some((code) => new RegExp(`\\b${helper}\\(`).test(code)));
  return [
    ...header(p),
    `import { test as base, expect${hasSession ? ', Page' : ''} } from '@playwright/test';`,
    ...(usesEnv ? [`import { requireEnv as env } from '${p.envImport}';`] : []),
    ...(storageHelpers.length > 0 ? [`import { ${storageHelpers.join(', ')} } from '${p.storageImport}';`] : []),
    `import fixtureData from '${p.fixtureImport}';`,
    `import { ${p.pageObject} } from '${p.pomImport}';`,
    '',
    `const test = base.extend<{ featurePage: ${p.pageObject}; data: typeof fixtureData }>({`,
    '  featurePage: async ({ page }, use) => {',
    `    await use(new ${p.pageObject}(page));`,
    '  },',
    ...dataFixtureLines(),
    '});',
    ...(hasSession ? sessionFixtureLines() : []),
    '',
    ...(p.tests.length > 0 || !hasSession ? [
      `test.describe(${JSON.stringify(p.featureId)}, () => {`,
      ...(hook.length > 0 ? [renderHook(hook), ''] : []),
      p.tests.map((t) => renderTestBlock(t.tc, t.body, UI_FIXTURE_PARAMS)).join('\n\n'),
      '});',
    ] : []),
    ...(hasSession ? renderSessionBlock(p) : []),
    '',
  ].join('\n');
}

/**
 * Renders an API spec file.
 * @param {ApiSpecParams} p
 * @returns {string}
 */
export function renderApiSpec(p: ApiSpecParams): string {
  const usesEnv = !!p.authHeaderEnv || !!p.basePathEnv || p.tests.some((t) => /\benv\(/.test(t.body));
  const contextOptions = [
    p.basePathEnv ? `baseURL: new URL(env(${JSON.stringify(p.basePathEnv)}), baseURL).toString()` : 'baseURL',
    ...(p.authHeaderEnv ? [`extraHTTPHeaders: { Authorization: env(${JSON.stringify(p.authHeaderEnv)}) }`] : []),
  ];
  return [
    ...header(p),
    "import { test as base, expect, APIRequestContext } from '@playwright/test';",
    ...(usesEnv ? [`import { requireEnv as env } from '${p.envImport}';`] : []),
    `import fixtureData from '${p.fixtureImport}';`,
    '',
    'const test = base.extend<{ apiContext: APIRequestContext; data: typeof fixtureData }>({',
    '  apiContext: async ({ playwright, baseURL }, use) => {',
    `    const context = await playwright.request.newContext({ ${contextOptions.join(', ')} });`,
    '    await use(context);',
    '    await context.dispose();',
    '  },',
    ...dataFixtureLines(),
    '});',
    '',
    `test.describe(${JSON.stringify(`${p.featureId} API`)}, () => {`,
    p.tests.map((t) => renderTestBlock(t.tc, t.body, '{ apiContext, data }')).join('\n\n'),
    '});',
    '',
  ].join('\n');
}

/**
 * Latency SLA in milliseconds from the test case's SLA text.
 * @param {string} [slaText]
 * @returns {number|undefined}
 */
export function slaMilliseconds(slaText?: string): number | undefined {
  const match = slaText?.match(SLA_PATTERN);
  if (!match) return undefined;
  const value = Number(match[1]);
  return /^m/i.test(match[2]) ? value : value * 1000;
}

const CONSTANT_VUS = [
  "      executor: 'constant-vus',",
  "      vus: Number(requireEnv('K6_VUS')),",
  "      duration: requireEnv('K6_DURATION'),",
];

const K6_EXECUTORS: Readonly<Record<string, string[]>> = Object.freeze({
  load: CONSTANT_VUS,
  soak: CONSTANT_VUS,
  stress: [
    "      executor: 'ramping-vus',",
    '      startVUs: 0,',
    '      stages: [',
    "        { duration: requireEnv('K6_DURATION'), target: Number(requireEnv('K6_VUS')) },",
    "        { duration: requireEnv('K6_DURATION'), target: 0 },",
    '      ],',
  ],
  spike: [
    "      executor: 'ramping-vus',",
    '      startVUs: 0,',
    '      stages: [',
    "        { duration: requireEnv('K6_SPIKE_RAMP'), target: Number(requireEnv('K6_VUS')) },",
    "        { duration: requireEnv('K6_DURATION'), target: Number(requireEnv('K6_VUS')) },",
    "        { duration: requireEnv('K6_SPIKE_RAMP'), target: 0 },",
    '      ],',
  ],
});

/**
 * Renders a K6 script for one performance test case.
 * @param {K6ScriptParams} p
 * @returns {string}
 */
export function renderK6Script(p: K6ScriptParams): string {
  const scenario = p.tc.performance?.scenario && K6_EXECUTORS[p.tc.performance.scenario] ? p.tc.performance.scenario : 'load';
  const sla = slaMilliseconds(p.tc.performance?.slaText);
  const threshold = sla !== undefined ? String(sla) : `Number(requireEnv(${JSON.stringify(p.thresholdEnv || 'K6_THRESHOLD_P95')}))`;
  return [
    ...header(p),
    "import http from 'k6/http';",
    "import { check } from 'k6';",
    '',
    'function requireEnv(name) {',
    '  const value = __ENV[name];',
    "  if (value === undefined || value === '') {",
    '    throw new Error(`Required environment variable "${name}" is not set.`);',
    '  }',
    '  return value;',
    '}',
    '',
    `const BASE_URL = requireEnv(${JSON.stringify(p.baseUrlEnv)}).replace(/\\/+$/, '');`,
    `const P95_THRESHOLD_MS = ${threshold};`,
    '',
    'export const options = {',
    '  scenarios: {',
    `    ${scenario}: {`,
    ...K6_EXECUTORS[scenario],
    '    },',
    '  },',
    '  thresholds: {',
    '    http_req_duration: [`p(95)<${P95_THRESHOLD_MS}`],',
    '  },',
    '};',
    '',
    `// ${renderTestTitle(p.tc)}`,
    'export default function () {',
    indent(p.body, 2),
    '}',
    '',
    'export function handleSummary(data) {',
    "  const dir = __ENV.K6_SUMMARY_DIR || 'reports/json';",
    `  return { [\`\${dir}/k6-${p.tc.tcKey}-summary.json\`]: JSON.stringify(data, null, 2) };`,
    '}',
    '',
  ].join('\n');
}
