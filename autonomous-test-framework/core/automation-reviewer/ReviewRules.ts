'use strict';

/**
 * @fileoverview AST-based Automation Review Rules for the ARIA Framework.
 * Every rule is DETECT-ONLY: findings are reported and code is never rewritten, so no tooling can
 * change what a test validates. Combines code-quality rules with the context-free test-integrity
 * rules in IntegrityRules.ts. Contains no application-specific knowledge.
 */

import * as recast from 'recast';
import { FILE_TYPE, FINDING_SEVERITY, Finding, ReviewResult } from './reviewTypes';
import { collectIntegrityFindings, isLiteral, propName } from './IntegrityRules';

const tsParser = require('recast/parsers/typescript');

export { FILE_TYPE, FINDING_SEVERITY } from './reviewTypes';
export type { Finding, ReviewResult } from './reviewTypes';

/** Legacy export kept for backward compatibility. */
export const ANALYSIS_RULES: any[] = [];

/**
 * Parses TypeScript/JavaScript source with the TypeScript-aware recast parser.
 * @param {string} code
 * @returns {any} AST
 */
export function parseTypeScript(code: string): any {
  return recast.parse(code, { parser: tsParser });
}

function quality(ruleId: string, dimension: string, severity: FINDING_SEVERITY, message: string, suggestion: string, line?: number): Finding {
  return {
    ruleId, dimension, severity, message, suggestion, line, patchable: false,
  };
}

function collectQualityFindings(ast: any, fileType: FILE_TYPE): Finding[] {
  const findings: Finding[] = [];
  recast.visit(ast, {
    visitCallExpression(path: any) {
      const { node } = path;
      const line = node.loc?.start.line;
      const { callee } = node;
      const isConsole = callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'console';
      if (isConsole && propName(callee) === 'assert') {
        findings.push(quality('ASSERT-001', 'ASSERTION_QUALITY', FINDING_SEVERITY.BLOCKER,
          'console.assert() does not fail the test.', 'Use Playwright expect() assertions.', line));
      }
      if (isConsole && propName(callee) === 'log' && fileType === FILE_TYPE.SPEC) {
        findings.push(quality('STYLE-003', 'CODE_STYLE', FINDING_SEVERITY.MINOR,
          'console.log() in spec file.', 'Remove it or use testInfo.attach() for structured debug output.', line));
      }
      if (callee.type === 'MemberExpression' && propName(callee) === 'toContain'
        && isLiteral(node.arguments[0]) && typeof node.arguments[0].value === 'boolean') {
        findings.push(quality('ASSERT-002', 'ASSERTION_QUALITY', FINDING_SEVERITY.BLOCKER,
          `toContain(${node.arguments[0].value}) on a boolean throws "not iterable".`, 'Use a web-first assertion on the locator.', line));
      }
      const codeStr = recast.print(node).code;
      if (codeStr.includes('${testInfo.title}') && /screenshots|attachments|path:/.test(codeStr)) {
        findings.push(quality('HOOK-001', 'CODE_STYLE', FINDING_SEVERITY.BLOCKER,
          'Unsanitized testInfo.title used in a file path.', "Sanitize it: testInfo.title.replace(/[^a-zA-Z0-9_-]/g, '_').", line));
      }
      this.traverse(path);
    },
    visitClassDeclaration(path: any) {
      const { node } = path;
      if (fileType === FILE_TYPE.POM && (!node.superClass || (node.superClass.type === 'Identifier' && node.superClass.name !== 'BasePage'))) {
        findings.push(quality('POM-001', 'POM_COMPLIANCE', FINDING_SEVERITY.BLOCKER,
          'POM class does not extend BasePage.', "Declare 'class XPage extends BasePage'.", node.loc?.start.line));
      }
      this.traverse(path);
    },
    visitCatchClause(path: any) {
      const { node } = path;
      if (node.body.body.length === 0) {
        findings.push(quality('ERR-001', 'ERROR_HANDLING', FINDING_SEVERITY.BLOCKER,
          'Empty catch block swallows errors.', 'Remove the try/catch or rethrow.', node.loc?.start.line));
      }
      this.traverse(path);
    },
  });
  return findings;
}

function collectAnnotatedKeys(node: any, expectedTCKeys: string[], foundKeys: Set<string>): void {
  const titleArg = node.arguments[0];
  if (isLiteral(titleArg) && typeof titleArg.value === 'string') {
    expectedTCKeys.filter((key) => titleArg.value.includes(key)).forEach((key) => foundKeys.add(key));
  }
  const opts = node.arguments[1];
  if (opts?.type !== 'ObjectExpression') return;
  const annotation = opts.properties.find((p: any) => (p.key?.name ?? p.key?.value) === 'annotation');
  if (annotation?.value?.type !== 'ArrayExpression') return;
  for (const elem of annotation.value.elements) {
    if (elem?.type !== 'ObjectExpression') continue;
    const valueOf = (key: string) => elem.properties.find((p: any) => (p.key?.name ?? p.key?.value) === key)?.value;
    const type = valueOf('type');
    const description = valueOf('description');
    if (isLiteral(type) && type.value === 'TC Key' && isLiteral(description)) foundKeys.add(String(description.value));
  }
}

function checkCompleteness(ast: any, expectedTCKeys: string[]): Finding[] {
  const foundKeys = new Set<string>();
  recast.visit(ast, {
    visitCallExpression(path: any) {
      const { callee } = path.node;
      const isTest = (callee.type === 'Identifier' && callee.name === 'test')
        || (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'test');
      if (isTest && path.node.arguments.length >= 1) collectAnnotatedKeys(path.node, expectedTCKeys, foundKeys);
      this.traverse(path);
    },
  });
  const missing = expectedTCKeys.filter((key) => !foundKeys.has(key));
  if (missing.length === 0) return [];
  return [{
    ruleId: 'COMPLETENESS-001',
    dimension: 'TEST_COMPLETENESS',
    severity: FINDING_SEVERITY.BLOCKER,
    message: `Incomplete spec — ${missing.length} test case(s) missing: ${missing.join(', ')}.`,
    suggestion: `Add a test() with annotation [{ type: 'TC Key', description: '<key>' }] for: ${missing.join(', ')}.`,
    patchable: false,
  }];
}

/**
 * Analyzes automation code with all detect-only rules.
 * @param {string} code
 * @param {FILE_TYPE} fileType
 * @param {string[]} [expectedTCKeys] - When given (specs only), every key must appear as a 'TC Key' annotation.
 * @returns {ReviewResult}
 */
export function analyzeWithAST(code: string, fileType: FILE_TYPE, expectedTCKeys?: string[]): ReviewResult {
  let ast: any;
  try {
    ast = parseTypeScript(code);
  } catch (err: any) {
    return {
      findings: [quality('SYNTAX-001', 'CODE_STYLE', FINDING_SEVERITY.BLOCKER, `Syntax Error: ${err.message}`, 'Fix the syntax errors.')],
      patchedCode: code,
    };
  }

  const findings = [...collectQualityFindings(ast, fileType), ...collectIntegrityFindings(ast, fileType)];
  if (expectedTCKeys && expectedTCKeys.length > 0 && fileType === FILE_TYPE.SPEC) {
    findings.push(...checkCompleteness(ast, expectedTCKeys));
  }
  if (/\/\/ VERIFY:|\/\/ EXPECTED:/.test(code)) {
    findings.push(quality('ASSERT-004', 'ASSERTION_QUALITY', FINDING_SEVERITY.MAJOR,
      'Unimplemented assertion — step left as a comment.', 'Implement the assertion with expect().'));
  }
  return { findings, patchedCode: code };
}
