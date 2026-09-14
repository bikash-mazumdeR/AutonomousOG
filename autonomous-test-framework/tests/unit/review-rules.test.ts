import {
  analyzeWithAST,
  FILE_TYPE,
  FINDING_SEVERITY,
} from '../../core/automation-reviewer/ReviewRules';

describe('ReviewRules AST Engine (detect-only)', () => {
  describe('Syntax Validation', () => {
    it('should return a BLOCKER finding for invalid JS syntax', () => {
      const invalidCode = 'const x = ;';
      const { findings } = analyzeWithAST(invalidCode, FILE_TYPE.SPEC);
      expect(findings[0].ruleId).toBe('SYNTAX-001');
      expect(findings[0].severity).toBe(FINDING_SEVERITY.BLOCKER);
    });
  });

  describe('No automatic code rewriting', () => {
    it.each([
      ['waitForTimeout', 'page.waitForTimeout(1000);'],
      ['console.assert', 'console.assert(x === 1, "failed");'],
      ['empty catch', 'try { f(); } catch(e) {}'],
      ['missing use strict', 'const x = 1;'],
    ])('reports but never patches: %s', (_label, code) => {
      const { patchedCode, findings } = analyzeWithAST(code, FILE_TYPE.SPEC);
      expect(patchedCode).toBe(code);
      expect(findings.every((f) => f.patchable === false)).toBe(true);
    });

    it('does not require a "use strict" directive in TypeScript modules', () => {
      const { findings } = analyzeWithAST('const x = 1;', FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'STYLE-001')).toBe(false);
    });
  });

  describe('Detected issues', () => {
    it('flags XPath locators', () => {
      const { findings } = analyzeWithAST('page.locator("//div")', FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'INT-011')).toBe(true);
    });

    it('flags hard sleeps', () => {
      const { findings } = analyzeWithAST('page.waitForTimeout(1000);', FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'INT-008')).toBe(true);
    });

    it('flags console.assert', () => {
      const { findings } = analyzeWithAST('console.assert(x === 1, "failed");', FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'ASSERT-001')).toBe(true);
    });

    it('flags hard-coded absolute URLs', () => {
      const { findings } = analyzeWithAST('const url = "https://example.com";', FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'INT-013')).toBe(true);
    });

    it('flags empty catch blocks', () => {
      const { findings } = analyzeWithAST('try { f(); } catch(e) {}', FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'ERR-001')).toBe(true);
    });
  });

  describe('POM-001: Extend BasePage', () => {
    it('should flag POM classes that do not extend BasePage', () => {
      const { findings } = analyzeWithAST('class LoginPage {}', FILE_TYPE.POM);
      expect(findings.some((f) => f.ruleId === 'POM-001')).toBe(true);
    });

    it('should not flag POM classes that extend BasePage', () => {
      const { findings } = analyzeWithAST('class LoginPage extends BasePage {}', FILE_TYPE.POM);
      expect(findings.some((f) => f.ruleId === 'POM-001')).toBe(false);
    });
  });

  describe('TypeScript Native Syntax Support', () => {
    it('should parse TypeScript interfaces, type annotations, and generics without SYNTAX-001 error', () => {
      const tsCode = `
import { test, expect, Page, Locator } from '@playwright/test';
import { BasePage } from '../pages/BasePage';

interface UserCredentials {
  username: string;
  password?: string;
}

export class LoginPage extends BasePage {
  readonly usernameInput: Locator;
  constructor(page: Page) {
    super(page);
    this.usernameInput = this.page.getByTestId('username');
  }
}

test('typed test', { annotation: [{ type: 'TC Key', description: 'TC-001' }] }, async ({ page }: { page: Page }) => {
  const loginPage: LoginPage = new LoginPage(page);
  await expect(loginPage.usernameInput).toBeVisible();
});
`;
      const { findings } = analyzeWithAST(tsCode, FILE_TYPE.SPEC, ['TC-001']);
      expect(findings.some((f) => f.ruleId === 'SYNTAX-001')).toBe(false);
      expect(findings.some((f) => f.ruleId === 'COMPLETENESS-001')).toBe(false);
    });

    it('reports missing test case keys', () => {
      const code = "test('[TC-001] a', { annotation: [{ type: 'TC Key', description: 'TC-001' }] }, async () => { expect(1).toBe(1); });";
      const { findings } = analyzeWithAST(code, FILE_TYPE.SPEC, ['TC-001', 'TC-002']);
      expect(findings.find((f) => f.ruleId === 'COMPLETENESS-001')?.message).toContain('TC-002');
    });
  });
});
