import {
  analyzeWithAST,
  FILE_TYPE,
  FINDING_SEVERITY,
} from '../../core/automation-reviewer/ReviewRules';

describe('ReviewRules AST Engine', () => {
  describe('Syntax Validation', () => {
    it('should return a BLOCKER finding for invalid JS syntax', () => {
      const invalidCode = 'const x = ;';
      const { findings } = analyzeWithAST(invalidCode, FILE_TYPE.SPEC);
      expect(findings[0].ruleId).toBe('SYNTAX-001');
      expect(findings[0].severity).toBe(FINDING_SEVERITY.BLOCKER);
    });
  });

  describe('STYLE-001: use strict directive', () => {
    it('should add "use strict" if missing and not a K6 file', () => {
      const code = 'const x = 1;';
      const { findings, patchedCode } = analyzeWithAST(code, FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'STYLE-001')).toBe(true);
      // Recast might use double or single quotes depending on config
      expect(patchedCode).toMatch(/["']use strict["'];/);
    });
  });

  describe('LOC-001: XPath Detection', () => {
    it('should flag XPath locators starting with //', () => {
      const code = 'page.locator("//div")';
      const { findings } = analyzeWithAST(code, FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'LOC-001')).toBe(true);
    });
  });

  describe('WAIT-001/002: Hard Sleep checks', () => {
    it('should flag and patch waitForTimeout', () => {
      const code = 'page.waitForTimeout(1000);';
      const { findings, patchedCode } = analyzeWithAST(code, FILE_TYPE.SPEC);
      // The rule checks for MemberExpression prop name 'waitForTimeout'
      expect(findings.some((f) => f.ruleId === 'WAIT-002' || f.ruleId === 'WAIT-001')).toBe(true);
      expect(patchedCode).toContain('waitForLoadState');
      expect(patchedCode).toContain('networkidle');
    });
  });

  describe('ASSERT-001: console.assert', () => {
    it('should flag and patch console.assert to expect()', () => {
      const code = 'console.assert(x === 1, "failed");';
      const { findings, patchedCode } = analyzeWithAST(code, FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'ASSERT-001')).toBe(true);
      expect(patchedCode).toContain('expect');
      expect(patchedCode).toContain('toBeTruthy');
    });
  });

  describe('POM-001: Extend BasePage', () => {
    it('should flag POM classes that do not extend BasePage', () => {
      const code = 'class LoginPage {}';
      const { findings } = analyzeWithAST(code, FILE_TYPE.POM);
      expect(findings.some((f) => f.ruleId === 'POM-001')).toBe(true);
    });

    it('should not flag POM classes that extend BasePage', () => {
      const code = 'class LoginPage extends BasePage {}';
      const { findings } = analyzeWithAST(code, FILE_TYPE.POM);
      expect(findings.some((f) => f.ruleId === 'POM-001')).toBe(false);
    });
  });

  describe('DATA-002: Hardcoded URLs', () => {
    it('should flag hardcoded HTTP URLs in specs', () => {
      const code = 'const url = "https://example.com";';
      const { findings } = analyzeWithAST(code, FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'DATA-002')).toBe(true);
    });
  });

  describe('ERR-001: Empty Catch Block', () => {
    it('should flag and patch empty catch blocks', () => {
      const code = 'try { f(); } catch(e) {}';
      const { findings, patchedCode } = analyzeWithAST(code, FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'ERR-001')).toBe(true);
      expect(patchedCode).toContain('throw e');
    });
  });

  describe('TypeScript Native Syntax Support', () => {
    it('should parse TypeScript interfaces, type annotations, and generics without SYNTAX-001 error', () => {
      const tsCode = `
'use strict';
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
    this.usernameInput = this.page.locator('[data-test="username"]');
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
  });
});
