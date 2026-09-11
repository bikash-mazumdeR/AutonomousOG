'use strict';

/**
 * @fileoverview AST-based Automation Review Rules for the ARIA Framework.
 * Performs deep semantic analysis of test scripts using Recast AST parser.
 */

import * as recast from 'recast';
const tsParser = require('recast/parsers/typescript');
const b = recast.types.builders;

/** @enum {string} */
export enum FILE_TYPE {
  SPEC = 'spec',
  POM = 'pom',
  K6 = 'k6'
}

/** @enum {string} */
export enum FINDING_SEVERITY {
  BLOCKER = 'BLOCKER',
  MAJOR = 'MAJOR',
  MINOR = 'MINOR',
  INFO = 'INFO'
}

export interface Finding {
  ruleId: string;
  dimension: string;
  severity: FINDING_SEVERITY;
  message: string;
  suggestion: string;
  line?: number;
  patchable: boolean;
}

export interface ReviewResult {
  findings: Finding[];
  patchedCode: string;
}

function isLiteralNode(node: any): boolean {
  return !!node && (
    node.type === 'Literal' ||
    node.type === 'StringLiteral' ||
    node.type === 'NumericLiteral' ||
    node.type === 'BooleanLiteral'
  );
}

/**
 * Main entry point for code analysis.
 * Parses the code once and runs all AST-based rules.
 * @param expectedTCKeys - Optional list of TC keys (e.g. ['TC-001','TC-002']) that MUST each
 *   appear as an `annotation: [{ type: 'TC Key', description: '...' }]` in a test() block.
 *   If any key is absent, a COMPLETENESS-001 BLOCKER finding is emitted.
 */
export function analyzeWithAST(code: string, fileType: FILE_TYPE, expectedTCKeys?: string[]): ReviewResult {
  const findings: Finding[] = [];
  let ast: any;

  // 1. Syntax Validation (TypeScript native)
  try {
    ast = recast.parse(code, { parser: tsParser });
  } catch (err: any) {
    return {
      findings: [{
        ruleId: 'SYNTAX-001',
        dimension: 'CODE_STYLE',
        severity: FINDING_SEVERITY.BLOCKER,
        message: `Syntax Error: ${err.message}`,
        suggestion: 'Fix the TypeScript/JavaScript syntax errors in the generated code.',
        patchable: false
      }],
      patchedCode: code
    };
  }

  let modified = false;

  // 2. Traversal & Rule Application
  recast.visit(ast, {
    // Check for 'use strict'
    visitProgram(path) {
      const { node } = path;
      const hasStrict =
        (node.directives && node.directives.some((d: any) => (d.value?.value || d.value) === 'use strict')) ||
        node.body.some(stmt => 
          stmt.type === 'ExpressionStatement' && 
          isLiteralNode(stmt.expression) && 
          stmt.expression.value === 'use strict'
        );
      if (!hasStrict && fileType !== FILE_TYPE.K6) {
        findings.push({
          ruleId: 'STYLE-001', dimension: 'CODE_STYLE', severity: FINDING_SEVERITY.MINOR,
          message: "'use strict' directive missing at file top.",
          suggestion: "Add 'use strict'; as the very first line.",
          patchable: true, line: 1
        });
        // Auto-patch: Add 'use strict'
        node.body.unshift(b.expressionStatement(b.literal('use strict')));
        modified = true;
      }
      this.traverse(path);
    },

    visitCallExpression(path) {
      const { node } = path;
      const codeStr = recast.print(node).code;

      // LOC-001: XPath check
      const isLocatorCall =
        node.callee.type === 'MemberExpression' &&
        node.callee.property &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'locator';
      if (isLocatorCall || codeStr.includes('.locator("') || codeStr.includes(".locator('")) {
        const arg = node.arguments[0];
        if (arg && isLiteralNode(arg) && typeof arg.value === 'string' && arg.value.startsWith('//')) {
          findings.push({
            ruleId: 'LOC-001', dimension: 'LOCATOR_QUALITY', severity: FINDING_SEVERITY.BLOCKER,
            message: 'XPath locator detected. XPath is brittle and prohibited.',
            suggestion: 'Replace with role/testid/label locator strategy.',
            patchable: false, line: node.loc?.start.line
          });
        }
      }

      // LOC-002: Ambiguous container ID causing Playwright strict mode violation
      if (codeStr.includes(".locator('#inventory_container')") || codeStr.includes('.locator("#inventory_container")')) {
        findings.push({
          ruleId: 'LOC-002', dimension: 'LOCATOR_QUALITY', severity: FINDING_SEVERITY.BLOCKER,
          message: "Ambiguous locator '#inventory_container' causes Playwright strict mode violations on nested containers.",
          suggestion: "Use locator('[data-test=\"inventory-container\"]').first() or locator('#inventory_container').first()",
          patchable: true, line: node.loc?.start.line
        });
        if (node.arguments[0] && isLiteralNode(node.arguments[0])) {
          node.arguments[0] = b.literal('[data-test="inventory-container"]');
          modified = true;
        }
      }

      // LOC-003: Brittle getByTestId without multi-attribute fallback in POM
      if (fileType === FILE_TYPE.POM && node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' && node.callee.property.name === 'getByTestId') {
        const arg = node.arguments[0];
        if (arg && isLiteralNode(arg) && typeof arg.value === 'string') {
          const testIdVal = arg.value;
          findings.push({
            ruleId: 'LOC-003', dimension: 'LOCATOR_QUALITY', severity: FINDING_SEVERITY.MAJOR,
            message: `Single-attribute getByTestId('${testIdVal}') may fail if testIdAttribute does not match. Auto-patching to resilient multi-attribute locator.`,
            suggestion: `Use locator('[data-test="${testIdVal}"], [data-testid="${testIdVal}"]')`,
            patchable: true, line: node.loc?.start.line
          });
          node.callee.property.name = 'locator';
          node.arguments = [b.literal(`[data-test="${testIdVal}"], [data-testid="${testIdVal}"]`)];
          modified = true;
        }
      }

      // ASSERT-003: Negative/Edge test asserting positive navigation
      const isTestCall =
        (node.callee.type === 'Identifier' && node.callee.name === 'test') ||
        (node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'test');
      if (isTestCall && node.arguments.length >= 2) {
        const testTitleNode = node.arguments[0];
        const testTitle = testTitleNode && isLiteralNode(testTitleNode) ? String(testTitleNode.value) : '';
        const isNegativeOrEdge = /\[(?:NEG|EDGE)\]/i.test(testTitle) || /(?:invalid|unauthorized|below minimum|above maximum|empty mandatory|boundary)/i.test(testTitle);
        if (isNegativeOrEdge) {
          const testFnNode = node.arguments[node.arguments.length - 1];
          let usesInventory = false;
          recast.visit(testFnNode, {
            visitMemberExpression(subPath) {
              if (subPath.node.property && subPath.node.property.type === 'Identifier' && subPath.node.property.name === 'inventoryContainer') {
                usesInventory = true;
              }
              this.traverse(subPath);
            }
          });
          const testBodyCode = recast.print(testFnNode).code;
          if (usesInventory && testBodyCode.includes('toBeVisible()')) {
            findings.push({
              ruleId: 'ASSERT-003', dimension: 'ASSERTION_QUALITY', severity: FINDING_SEVERITY.BLOCKER,
              message: `Negative or Edge test "${testTitle}" asserts successful inventory visibility instead of an error state. Auto-patching to errorMessage assertion.`,
              suggestion: 'Assert that errorMessage is visible or that error text matches expected validation, not inventoryContainer.toBeVisible().',
              patchable: true, line: node.loc?.start.line
            });
            recast.visit(testFnNode, {
              visitMemberExpression(subPath) {
                if (subPath.node.property && subPath.node.property.type === 'Identifier' && subPath.node.property.name === 'inventoryContainer') {
                  subPath.node.property.name = 'errorMessage';
                  modified = true;
                }
                this.traverse(subPath);
              },
              visitLiteral(subPath) {
                if (typeof subPath.node.value === 'string' && (subPath.node.value === 'visual_user' || subPath.node.value === 'problem_user')) {
                  subPath.node.value = 'unauthorized_user';
                  modified = true;
                }
                this.traverse(subPath);
              }
            });
          }
        }
      }

      // WAIT-001/002: Hard Sleep checks
      if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier' && node.callee.property.name === 'waitForTimeout') {
        const timeoutArg = node.arguments[0];
        if (timeoutArg && isLiteralNode(timeoutArg) && typeof timeoutArg.value === 'number') {
          const timeout = timeoutArg.value;
          const severity = timeout > 5000 ? FINDING_SEVERITY.BLOCKER : FINDING_SEVERITY.MAJOR;
          findings.push({
            ruleId: timeout > 5000 ? 'WAIT-001' : 'WAIT-002',
            dimension: 'WAIT_STRATEGY', severity,
            message: `Hard sleep (${timeout}ms) detected. Causes slow, flaky tests.`,
            suggestion: 'Replace with waitForLoadState, waitForSelector, or waitForResponse.',
            patchable: true, line: node.loc?.start.line
          });
          // Auto-patch
          node.callee.property.name = 'waitForLoadState';
          node.arguments = [b.literal('networkidle')];
          modified = true;
        }
      }

      // ASSERT-001: console.assert
      if (node.callee.type === 'MemberExpression' && 
          node.callee.object.type === 'Identifier' && node.callee.object.name === 'console' &&
          node.callee.property.type === 'Identifier' && node.callee.property.name === 'assert') {
        findings.push({
          ruleId: 'ASSERT-001', dimension: 'ASSERTION_QUALITY', severity: FINDING_SEVERITY.BLOCKER,
          message: 'console.assert() used. Must use Playwright expect() only.',
          suggestion: "Replace console.assert(x, msg) with expect(x, msg).toBeTruthy()",
          patchable: true, line: node.loc?.start.line
        });
        // Auto-patch: console.assert(cond, msg) -> expect(cond, msg).toBeTruthy()
        const cond = node.arguments[0];
        const msg = node.arguments[1];
        path.replace(
          b.callExpression(
            b.memberExpression(
              b.callExpression(b.identifier('expect'), [cond, msg].filter(Boolean) as any),
              b.identifier('toBeTruthy')
            ),
            []
          )
        );
        modified = true;
      }

      // ASSERT-002: toContain on boolean (TypeError: c is not iterable)
      if (node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'toContain') {
        const arg = node.arguments[0];
        if (arg && isLiteralNode(arg) && typeof arg.value === 'boolean') {
          findings.push({
            ruleId: 'ASSERT-002', dimension: 'ASSERTION_QUALITY', severity: FINDING_SEVERITY.BLOCKER,
            message: `expect(...).toContain(${arg.value}) on boolean value will throw TypeError: c is not iterable.`,
            suggestion: `Replace with expect(...).toBe(${arg.value}) or a web-first assertion like await expect(locator).toBeVisible().`,
            patchable: true, line: node.loc?.start.line
          });
          // Auto-patch: change toContain to toBe
          node.callee.property.name = 'toBe';
          modified = true;
        }
      }

      // HOOK-001: Unsanitized testInfo.title in file paths (causes ENOENT on Windows)
      if (codeStr.includes('${testInfo.title}') && (codeStr.includes('screenshots') || codeStr.includes('attachments') || codeStr.includes('path:'))) {
        findings.push({
          ruleId: 'HOOK-001', dimension: 'CODE_STYLE', severity: FINDING_SEVERITY.BLOCKER,
          message: 'Unsanitized testInfo.title used in file path. Causes fatal ENOENT on Windows due to colons.',
          suggestion: "Sanitize title: const sanitizedTitle = testInfo.title.replace(/[^a-zA-Z0-9_-]/g, '_');",
          patchable: false, line: node.loc?.start.line
        });
      }

      // STYLE-003: console.log
      if (node.callee.type === 'MemberExpression' && 
          node.callee.object.type === 'Identifier' && node.callee.object.name === 'console' &&
          node.callee.property.type === 'Identifier' && node.callee.property.name === 'log' &&
          fileType === FILE_TYPE.SPEC) {
        findings.push({
          ruleId: 'STYLE-003', dimension: 'CODE_STYLE', severity: FINDING_SEVERITY.MINOR,
          message: 'console.log() in spec file. Use testInfo.attach() for debug output.',
          suggestion: 'Remove console.log or replace with testInfo.attach() for structured debug.',
          patchable: true, line: node.loc?.start.line
        });
        // Auto-patch: Comment out
        path.replace(b.expressionStatement(b.literal(`[ARIA-REVIEWER] Removed console.log: ${codeStr}`)));
        modified = true;
      }

      this.traverse(path);
    },

    visitClassDeclaration(path) {
      const { node } = path;
      // POM-001: Extend BasePage
      if (fileType === FILE_TYPE.POM && (!node.superClass || (node.superClass.type === 'Identifier' && node.superClass.name !== 'BasePage'))) {
        findings.push({
          ruleId: 'POM-001', dimension: 'POM_COMPLIANCE', severity: FINDING_SEVERITY.BLOCKER,
          message: 'POM class does not extend BasePage.',
          suggestion: "Change 'class XPage {' to 'class XPage extends BasePage {'",
          patchable: false, line: node.loc?.start.line
        });
      }
      this.traverse(path);
    },

    visitLiteral(path) {
      const { node } = path;
      if (typeof node.value === 'string') {
        // DATA-001: Secrets
        if (/(?:password|secret|token|apikey)/i.test(node.value) && node.value.length > 8) {
           // This is a bit simplistic, usually we check the variable name it's assigned to
        }
        // DATA-002: URLs (must be actual URL with host, and not the testData baseURL definition)
        const isUrl = /^https?:\/\/[a-z0-9]/i.test(node.value);
        const parentNode = path.parent?.node;
        const isBaseUrlDef = parentNode && (
          (parentNode.type === 'Property' || parentNode.type === 'ObjectProperty') &&
          (parentNode.key?.name === 'baseURL' || parentNode.key?.value === 'baseURL')
        );
        if (isUrl && !node.value.includes('localhost') && !isBaseUrlDef && fileType === FILE_TYPE.SPEC) {
           findings.push({
             ruleId: 'DATA-002', dimension: 'DATA_USAGE', severity: FINDING_SEVERITY.MAJOR,
             message: `Hardcoded URL detected: ${node.value}. Should use testData.baseURL.`,
             suggestion: 'Replace hardcoded URL with testData.baseURL or process.env.AUT_BASE_URL.',
             patchable: false, line: node.loc?.start.line
           });
        }
      }
      this.traverse(path);
    },

    visitCatchClause(path) {
      const { node } = path;
      // ERR-001: Empty catch
      if (node.body.body.length === 0) {
        findings.push({
          ruleId: 'ERR-001', dimension: 'ERROR_HANDLING', severity: FINDING_SEVERITY.BLOCKER,
          message: 'Empty catch block detected. Errors are being swallowed.',
          suggestion: 'Always re-throw or log errors in catch blocks.',
          patchable: true, line: node.loc?.start.line
        });
        // Auto-patch
        const errName = node.param && node.param.type === 'Identifier' ? node.param.name : 'err';
        node.body.body.push(
          b.expressionStatement(
            b.callExpression(
              b.memberExpression(b.identifier('console'), b.identifier('error')),
              [b.literal('[ARIA] Caught error:'), b.memberExpression(b.identifier(errName), b.identifier('message'))]
            )
          ),
          b.throwStatement(b.identifier(errName))
        );
        modified = true;
      }
      this.traverse(path);
    }
  });

  // 3. COMPLETENESS-001: Verify all expected TC keys are present in the generated spec
  if (expectedTCKeys && expectedTCKeys.length > 0 && fileType === FILE_TYPE.SPEC) {
    const foundKeys: string[] = [];
    recast.visit(ast, {
      visitCallExpression(path) {
        const { node } = path;
        // Match: test('...', { annotation: [...] }, async ...)
        const callee = node.callee;
        const isTestCall =
          (callee.type === 'Identifier' && callee.name === 'test') ||
          (callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            callee.object.name === 'test');
        if (isTestCall && node.arguments.length >= 1) {
          // Fallback check: test title contains TC key (e.g. test('TC-001: ...'))
          const titleArg = node.arguments[0];
          if (titleArg && isLiteralNode(titleArg) && typeof titleArg.value === 'string') {
            for (const expKey of expectedTCKeys) {
              if (titleArg.value.includes(expKey) && !foundKeys.includes(expKey)) {
                foundKeys.push(expKey);
              }
            }
          }

          if (node.arguments.length >= 2) {
            const opts = node.arguments[1];
            if (opts && opts.type === 'ObjectExpression') {
              const annotProp: any = opts.properties.find(
                (p: any) => (p.type === 'Property' || p.type === 'ObjectProperty') &&
                  ((p.key.type === 'Identifier' && p.key.name === 'annotation') ||
                   (isLiteralNode(p.key) && p.key.value === 'annotation'))
              );
              if (annotProp && annotProp.value.type === 'ArrayExpression') {
                for (const elem of annotProp.value.elements) {
                  if (elem && elem.type === 'ObjectExpression') {
                    let typeProp: any, descProp: any;
                    for (const p of elem.properties) {
                      if (p.type !== 'Property' && p.type !== 'ObjectProperty') continue;
                      const keyName = (p as any).key.type === 'Identifier' ? (p as any).key.name : (p as any).key.value;
                      if (keyName === 'type') typeProp = (p as any).value;
                      if (keyName === 'description') descProp = (p as any).value;
                    }
                    if (typeProp && isLiteralNode(typeProp) && typeProp.value === 'TC Key' &&
                        descProp && isLiteralNode(descProp)) {
                      const val = String(descProp.value);
                      if (!foundKeys.includes(val)) {
                        foundKeys.push(val);
                      }
                    }
                  }
                }
              }
            }
          }
        }
        this.traverse(path);
      }
    });

    const missingKeys = expectedTCKeys.filter(k => !foundKeys.includes(k));
    if (missingKeys.length > 0) {
      findings.push({
        ruleId: 'COMPLETENESS-001',
        dimension: 'TEST_COMPLETENESS',
        severity: FINDING_SEVERITY.BLOCKER,
        message: `Incomplete spec — ${missingKeys.length} test case(s) missing: ${missingKeys.join(', ')}. Expected ${expectedTCKeys.length} test blocks but found ${foundKeys.length}.`,
        suggestion: `Add a test() block with annotation: [{ type: 'TC Key', description: '<key>' }] for each missing key: ${missingKeys.join(', ')}.`,
        patchable: false
      });
    }
  }

  // Handle Unimplemented Assertion Comments (Regex still useful for comments)
  const commentRegex = /\/\/ VERIFY:|\/\/ EXPECTED:/;
  if (commentRegex.test(code)) {
    findings.push({
      ruleId: 'ASSERT-002', dimension: 'ASSERTION_QUALITY', severity: FINDING_SEVERITY.MAJOR,
      message: 'Unimplemented assertion — step marked as comment only.',
      suggestion: 'Implement the assertion with expect(). Do not leave as comment.',
      patchable: false
    });
  }

  return {
    findings,
    patchedCode: modified ? recast.print(ast).code : code
  };
}

/** Legacy array for backward compatibility during transition */
export const ANALYSIS_RULES: any[] = [];
