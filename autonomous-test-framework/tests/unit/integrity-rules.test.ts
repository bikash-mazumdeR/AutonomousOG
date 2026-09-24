/**
 * @fileoverview Unit tests for the detect-only test-integrity rules (false-positive safeguards).
 */

import { analyzeWithAST, FILE_TYPE, FINDING_SEVERITY } from '../../core/automation-reviewer/ReviewRules';

const spec = (body: string) => `import { test, expect } from '@playwright/test';
test.describe('F-01', () => {
  test('[TC-001] sample', { annotation: [{ type: 'TC Key', description: 'TC-001' }] }, async ({ page, featurePage, browser }) => {
${body}
  });
});
`;

const ruleIds = (code: string, type = FILE_TYPE.SPEC) => analyzeWithAST(code, type).findings.map((f) => f.ruleId);
const severe = (code: string, type = FILE_TYPE.SPEC) => analyzeWithAST(code, type).findings
  .filter((f) => f.severity === FINDING_SEVERITY.BLOCKER || f.severity === FINDING_SEVERITY.MAJOR);

describe('IntegrityRules — genuine validation safeguards', () => {
  it('accepts a compliant, unconditional web-first test and never rewrites code', () => {
    const code = spec(`    await featurePage.openStart();
    await featurePage.submitButton.click();
    await expect(featurePage.errorBanner).toHaveText('Access code is required');
    await expect(page).toHaveURL(/\\/sign-in/);`);
    const result = analyzeWithAST(code, FILE_TYPE.SPEC, ['TC-001']);
    expect(severe(code)).toEqual([]);
    expect(result.patchedCode).toBe(code);
  });

  it.each([
    ['INT-001 conditional if', "    if (shown) { await expect(featurePage.dialog).toHaveText('Saved'); }"],
    ['INT-001 ternary', "    shown ? await expect(featurePage.dialog).toHaveText('Saved') : null;"],
    ['INT-001 logical', "    shown && await expect(featurePage.dialog).toHaveText('Saved');"],
  ])('%s', (_label, body) => {
    expect(ruleIds(spec(body))).toContain('INT-001');
  });

  it.each([
    ['INT-002', "    test.skip(true, 'not implemented');\n    await expect(featurePage.a).toBeVisible();"],
    ['INT-003', '    try { await expect(featurePage.a).toBeVisible(); } catch (e) { throw e; }'],
    ['INT-003', '    const v = await featurePage.a.getAttribute("x").catch(() => null);\n    await expect(featurePage.a).toBeVisible();'],
    ['INT-004', '    await featurePage.submitButton.click();'],
    ['INT-005', '    expect(true).toBe(true);'],
    ['INT-005', '    await expect(featurePage.a).toBeTruthy();'],
    ['INT-005', '    expect(value).not.toBeNull();'],
    ['INT-006', "    expect(['#aaa', '#bbb']).toContain(colour);"],
    ['INT-006', "    expect(['#aaa', '#bbb'].includes(colour)).toBe(true);"],
    ['INT-007', "    await expect.soft(featurePage.a).toHaveText('x');"],
    ['INT-008', '    await page.waitForTimeout(500);\n    await expect(featurePage.a).toBeVisible();'],
    ['INT-008', "    await featurePage.page.waitForLoadState('networkidle');\n    await expect(featurePage.a).toBeVisible();"],
    ['INT-009', "    await page.route('**/api/**', (r) => r.fulfill({ status: 200 }));\n    await expect(featurePage.a).toBeVisible();"],
    ['INT-010', "    test.describe.configure({ mode: 'serial' });\n    await expect(featurePage.a).toBeVisible();"],
    ['INT-011', "    await expect(page.locator('#submit')).toBeVisible();"],
    ['INT-011', '    await expect(featurePage.items.first()).toBeVisible();'],
    ['INT-013', "    await expect(page).toHaveURL('https://app.example.test/home');"],
    ['INT-013', '    const token = process.env.TOKEN;\n    await expect(featurePage.a).toHaveText(token);'],
    ['INT-014', '    await featurePage.submitButton.click({ force: true });\n    await expect(featurePage.a).toBeVisible();'],
  ])('flags %s', (ruleId, body) => {
    expect(ruleIds(spec(body))).toContain(ruleId);
  });

  it('flags unstable selectors in page objects', () => {
    const pom = `import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
export class F01Page extends BasePage {
  constructor(page: Page) { super(page); }
  get a(): Locator { return this.page.locator('#a, #b'); }
  get b(): Locator { return this.page.locator('//div[3]/span'); }
}`;
    const ids = ruleIds(pom, FILE_TYPE.POM);
    expect(ids.filter((id) => id === 'INT-011').length).toBeGreaterThanOrEqual(2);
  });

  it('catches the false-positive patterns found in previously generated specs', () => {
    const legacy = spec(`    let dialogTriggered = false;
    let dialogMessage = '';
    if (dialogTriggered) {
      expect(dialogMessage.toLowerCase()).toContain('compromise');
    }
    expect(['rgb(1, 2, 3)', '#010203'].includes(bgColor)).toBeTruthy();`);
    const ids = ruleIds(legacy);
    expect(ids).toEqual(expect.arrayContaining(['INT-001', 'INT-005', 'INT-006']));
  });

  it('does not run Playwright integrity rules on K6 scripts', () => {
    const k6 = "import http from 'k6/http';\nexport default function () { http.get('https://example.test'); }";
    expect(ruleIds(k6, FILE_TYPE.K6)).toEqual([]);
  });
});

describe('IntegrityRules — the shared signed-in session block', () => {
  const sessionSpec = (configure: string, declaration = "sessionTest('[TC-002] sample'") => `import { test as base, expect, Page } from '@playwright/test';
const test = base;
let sessionPage: Page;
const sessionTest = test.extend({ page: async ({}, use) => { await use(sessionPage); } });
sessionTest.describe('F-01 signed-in session', () => {
  ${configure}
  ${declaration}, { annotation: [{ type: 'TC Key', description: 'TC-002' }] }, async ({ featurePage }) => {
    await featurePage.openStart();
    await expect(featurePage.dashboardHeading).toBeVisible();
  });
});
`;

  it('finds the tests declared on sessionTest and allows keeping them in order on one worker', () => {
    const code = sessionSpec("sessionTest.describe.configure({ mode: 'default' });");
    expect(analyzeWithAST(code, FILE_TYPE.SPEC, ['TC-002']).findings.filter((f) => f.severity === FINDING_SEVERITY.BLOCKER)).toEqual([]);
  });

  it.each([
    ["sessionTest.describe.configure({ mode: 'serial' });", 'INT-010'],
    ["sessionTest.describe.configure({ mode: 'default', retries: 3 });", 'INT-010'],
    ["test.describe.configure({ mode: 'parallel' });", 'INT-010'],
  ])('still flags %s', (configure, ruleId) => {
    expect(ruleIds(sessionSpec(configure))).toContain(ruleId);
  });

  it('still flags a skipped session test', () => {
    expect(ruleIds(sessionSpec('', "sessionTest.skip('[TC-002] sample'"))).toContain('INT-002');
  });
});
