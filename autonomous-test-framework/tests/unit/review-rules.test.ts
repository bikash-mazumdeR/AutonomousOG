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
    it('reports issues but never patches the code', () => {
      const code = 'page.waitForTimeout(1000);\nconsole.assert(x === 1, "failed");\ntry { f(); } catch(e) {}';
      const { patchedCode, findings } = analyzeWithAST(code, FILE_TYPE.SPEC);
      expect(findings.length).toBeGreaterThan(0);
      expect(patchedCode).toBe(code);
      expect(findings.every((f) => f.patchable === false)).toBe(true);
    });
  });

  describe('Detected issues', () => {
    it('flags console.assert', () => {
      const { findings } = analyzeWithAST('console.assert(x === 1, "failed");', FILE_TYPE.SPEC);
      expect(findings.some((f) => f.ruleId === 'ASSERT-001')).toBe(true);
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

    it('flags assertions inside page objects (POM-002)', () => {
      const asserting = 'class LoginPage extends BasePage { async check() { await expect(this.page).toHaveTitle("Home"); } }';
      const acting = 'class LoginPage extends BasePage { async go() { await this.page.reload(); } }';
      expect(analyzeWithAST(asserting, FILE_TYPE.POM).findings.some((f) => f.ruleId === 'POM-002' && f.severity === FINDING_SEVERITY.BLOCKER)).toBe(true);
      expect(analyzeWithAST(acting, FILE_TYPE.POM).findings.some((f) => f.ruleId === 'POM-002')).toBe(false);
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
