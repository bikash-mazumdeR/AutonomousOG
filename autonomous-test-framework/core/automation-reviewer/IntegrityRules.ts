'use strict';

/**
 * @fileoverview Context-free test-integrity rules (detect-only).
 * Flags constructs that let a test pass without genuinely validating application behaviour:
 * conditional / soft / tautological / weak assertions, skips, swallowed errors, arbitrary waits,
 * request mocking, serial mode, unstable or direct locators, hard-coded environments and forced actions.
 * These rules never modify code and contain no application-specific knowledge.
 */

import * as recast from 'recast';
import {
  FILE_TYPE, FINDING_SEVERITY, Finding, TEST_OBJECTS,
} from './reviewTypes';

const DIMENSION = 'TEST_INTEGRITY';
const SKIP_MODIFIERS = new Set(['skip', 'fixme', 'fail', 'slow', 'only']);
const DESCRIBE_SKIP_MODIFIERS = new Set(['skip', 'only', 'fixme']);
const WEAK_MATCHERS = new Set(['toBeTruthy', 'toBeFalsy', 'toBeDefined']);
const WEAK_NEGATED_MATCHERS = new Set(['toBeNull', 'toBeUndefined', 'toBeTruthy', 'toBeFalsy', 'toBeDefined']);
const LOCATOR_METHODS = new Set([
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId', 'getByAltText', 'getByTitle', 'frameLocator',
]);
const POSITIONAL_METHODS = new Set(['nth', 'first', 'last']);
const ROUTING_METHODS = new Set(['route', 'routeFromHAR', 'unroute', 'unrouteAll']);
const CONDITIONAL_ANCESTORS = new Set(['IfStatement', 'ConditionalExpression', 'LogicalExpression', 'CatchClause', 'SwitchCase']);
const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration']);
const LITERAL_TYPES = new Set(['Literal', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral']);
const ABSOLUTE_URL = /^https?:\/\//i;

/**
 * Whether a node is a primitive literal.
 * @param {any} node
 * @returns {boolean}
 */
export function isLiteral(node: any): boolean {
  return !!node && LITERAL_TYPES.has(node.type);
}

/**
 * Non-computed property name of a member expression.
 * @param {any} member
 * @returns {string|null}
 */
export function propName(member: any): string | null {
  if (!member || member.computed) return null;
  const { property } = member;
  if (property?.type === 'Identifier') return property.name;
  if (isLiteral(property) && typeof property.value === 'string') return property.value;
  return null;
}

/**
 * Name of the identifier at the root of a member/call chain (e.g. `page` for `page.getByRole(...).click`).
 * @param {any} node
 * @returns {string|null}
 */
export function rootIdentifier(node: any): string | null {
  let current = node;
  while (current) {
    if (current.type === 'Identifier') return current.name;
    if (current.type === 'ThisExpression') return 'this';
    if (current.type === 'MemberExpression' || current.type === 'OptionalMemberExpression') current = current.object;
    else if (current.type === 'CallExpression' || current.type === 'OptionalCallExpression') current = current.callee;
    else if (current.type === 'AwaitExpression') current = current.argument;
    else if (current.type === 'TSNonNullExpression' || current.type === 'TSAsExpression') current = current.expression;
    else return null;
  }
  return null;
}

/**
 * `expect(x)`, `expect.soft(x)` or `expect.poll(fn)` call.
 * @param {any} node
 * @returns {boolean}
 */
export function isExpectCall(node: any): boolean {
  if (node?.type !== 'CallExpression') return false;
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === 'expect';
  return callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'expect';
}

/**
 * `test('title', [options], fn)` declaration (including skip/only variants).
 * @param {any} node
 * @returns {boolean}
 */
export function isTestDeclaration(node: any): boolean {
  if (node?.type !== 'CallExpression' || node.arguments.length < 2) return false;
  const { callee } = node;
  const isTestCallee = (callee.type === 'Identifier' && TEST_OBJECTS.has(callee.name))
    || (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && TEST_OBJECTS.has(callee.object.name)
      && SKIP_MODIFIERS.has(propName(callee) || ''));
  const last = node.arguments[node.arguments.length - 1];
  return isTestCallee && FUNCTION_TYPES.has(last?.type);
}

/**
 * Resolves `expect(x)[.not][.resolves|.rejects].matcher(...)` into its parts.
 * @param {any} callNode
 * @returns {{ expectCall: any, matcher: string, negated: boolean } | null}
 */
export function getAssertion(callNode: any): { expectCall: any; matcher: string; negated: boolean } | null {
  if (callNode?.type !== 'CallExpression' || callNode.callee.type !== 'MemberExpression') return null;
  const matcher = propName(callNode.callee);
  if (!matcher) return null;
  let object = callNode.callee.object;
  let negated = false;
  while (object?.type === 'MemberExpression' && ['not', 'resolves', 'rejects'].includes(propName(object) || '')) {
    if (propName(object) === 'not') negated = !negated;
    object = object.object;
  }
  return isExpectCall(object) ? { expectCall: object, matcher, negated } : null;
}

function make(ruleId: string, message: string, suggestion: string, line?: number, severity = FINDING_SEVERITY.BLOCKER): Finding {
  return {
    ruleId, dimension: DIMENSION, severity, message, suggestion, line, patchable: false,
  };
}

function isTestFunctionPath(path: any): boolean {
  const parentNode = path.parent?.node;
  return FUNCTION_TYPES.has(path.node?.type) && isTestDeclaration(parentNode)
    && parentNode.arguments[parentNode.arguments.length - 1] === path.node;
}

function isConditionallyExecuted(path: any): boolean {
  let current = path.parent;
  while (current) {
    if (CONDITIONAL_ANCESTORS.has(current.node?.type)) return true;
    if (isTestFunctionPath(current)) return false;
    current = current.parent;
  }
  return false;
}

function literalArrayOfAtLeastTwo(node: any): boolean {
  return node?.type === 'ArrayExpression' && node.elements.length >= 2 && node.elements.every((e: any) => isLiteral(e));
}

function hasTopLevelComma(selector: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (const ch of selector) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === '[') {
      depth += 1;
    } else if (ch === ')' || ch === ']') {
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      return true;
    }
  }
  return false;
}

function checkSelector(value: string, line: number | undefined, findings: Finding[]): void {
  const selector = value.trim();
  if (/^(\(?\/\/|xpath=)/i.test(selector)) {
    findings.push(make('INT-011', `XPath selector "${selector}" is brittle.`, 'Use a verified role/test-id/label locator from the page contract.', line));
  }
  if (hasTopLevelComma(selector)) {
    findings.push(make('INT-011', `Comma-separated multi-selector "${selector}" can match different elements.`, 'Use exactly one verified, unique locator.', line));
  }
  if (/\s>\s/.test(selector)) {
    findings.push(make('INT-011', `Structural CSS chain "${selector}" breaks when layout changes.`, 'Use a semantic or test-id locator.', line, FINDING_SEVERITY.MAJOR));
  }
}

function checkExpectCall(path: any, findings: Finding[]): void {
  const { node } = path;
  const line = node.loc?.start.line;
  if (node.callee.type === 'MemberExpression' && propName(node.callee) === 'soft') {
    findings.push(make('INT-007', 'expect.soft() lets a test continue past failed checks.', 'Use hard assertions.', line));
  }
  if (isLiteral(node.arguments[0])) {
    findings.push(make('INT-005', 'Assertion on a literal value is a tautology.', 'Assert the actual application state.', line));
  }
  if (isConditionallyExecuted(path)) {
    findings.push(make('INT-001', 'Assertion runs only under a condition, so failures can be bypassed.', 'Make every assertion unconditional.', line));
  }
}

function checkAssertionShape(node: any, findings: Finding[]): void {
  const assertion = getAssertion(node);
  if (!assertion) return;
  const line = node.loc?.start.line;
  const weak = assertion.negated ? WEAK_NEGATED_MATCHERS.has(assertion.matcher) : WEAK_MATCHERS.has(assertion.matcher);
  if (weak) {
    findings.push(make('INT-005', `Weak assertion "${assertion.negated ? 'not.' : ''}${assertion.matcher}()" does not check a concrete expected value.`,
      'Assert the exact expected text, value, URL, count, attribute or state.', line));
  }
  if (assertion.matcher === 'toContain' && literalArrayOfAtLeastTwo(assertion.expectCall.arguments[0])) {
    findings.push(make('INT-006', 'Assertion accepts any of several values.', 'Assert the single expected value from the test case.', line));
  }
}

/**
 * `describe.configure({ mode: 'default' })` and nothing else: runs the block's tests in order on one worker without
 * chaining them (a failure does not skip the rest) or changing retries, so the tests stay independent.
 */
function isDefaultModeOnly(node: any): boolean {
  const [options] = node.arguments;
  if (node.arguments.length !== 1 || options?.type !== 'ObjectExpression' || options.properties.length !== 1) return false;
  const [property] = options.properties;
  const key = property.key?.name ?? property.key?.value;
  return key === 'mode' && LITERAL_TYPES.has(property.value?.type) && property.value.value === 'default';
}

function checkMemberCall(node: any, isSpec: boolean, findings: Finding[]): void {
  const { callee } = node;
  if (callee.type !== 'MemberExpression') return;
  const name = propName(callee) || '';
  const line = node.loc?.start.line;
  const objectIsTest = callee.object.type === 'Identifier' && TEST_OBJECTS.has(callee.object.name);
  const objectIsDescribe = callee.object.type === 'MemberExpression' && TEST_OBJECTS.has(rootIdentifier(callee.object) || '') && propName(callee.object) === 'describe';

  if ((objectIsTest && SKIP_MODIFIERS.has(name)) || (objectIsDescribe && DESCRIBE_SKIP_MODIFIERS.has(name))) {
    findings.push(make('INT-002', `test${objectIsDescribe ? '.describe' : ''}.${name}() changes whether or how a test runs.`, 'Remove it; a test that cannot pass must fail or be reported as NEEDS_CONTEXT.', line));
  }
  if (objectIsDescribe && name === 'configure' && !isDefaultModeOnly(node)) {
    findings.push(make('INT-010', 'test.describe.configure() changes execution mode or retries.', 'Keep tests independent and parallel-safe.', line));
  }
  if (name === 'catch' && isSpec) {
    findings.push(make('INT-003', '.catch() swallows errors in a test.', 'Let failures propagate.', line));
  }
  if (name === 'waitForTimeout') {
    findings.push(make('INT-008', 'Fixed sleep hides synchronization problems.', 'Use web-first assertions that auto-wait.', line));
  }
  if (ROUTING_METHODS.has(name)) {
    findings.push(make('INT-009', `${name}() mocks or intercepts traffic, bypassing real behaviour.`, 'Test the real application.', line));
  }
  if (isSpec && LOCATOR_METHODS.has(name) && rootIdentifier(callee.object) === 'page') {
    findings.push(make('INT-011', `Direct locator page.${name}() in a spec.`, 'Use page-object members verified by discovery.', line));
  }
  if (POSITIONAL_METHODS.has(name)) {
    findings.push(make('INT-011', `Positional locator .${name}() depends on element order.`, 'Use a unique locator.', line, isSpec ? FINDING_SEVERITY.BLOCKER : FINDING_SEVERITY.MAJOR));
  }
  if (name === 'locator' && isLiteral(node.arguments[0]) && typeof node.arguments[0].value === 'string') {
    checkSelector(node.arguments[0].value, line, findings);
  }
  if (name === 'includes' && literalArrayOfAtLeastTwo(callee.object)) {
    findings.push(make('INT-006', 'Accept-any-of check over a list of literal values.', 'Assert the single expected value from the test case.', line));
  }
}

function countExpectCalls(fnNode: any): number {
  let count = 0;
  recast.visit(fnNode, {
    visitCallExpression(path: any) {
      if (isExpectCall(path.node)) count += 1;
      this.traverse(path);
    },
  });
  return count;
}

function checkCall(path: any, isSpec: boolean, findings: Finding[]): void {
  const { node } = path;
  if (isExpectCall(node)) checkExpectCall(path, findings);
  checkAssertionShape(node, findings);
  checkMemberCall(node, isSpec, findings);
  if (node.callee.type === 'Identifier' && node.callee.name === 'setTimeout') {
    findings.push(make('INT-008', 'setTimeout() introduces an arbitrary wait.', 'Use web-first assertions that auto-wait.', node.loc?.start.line));
  }
  if (isSpec && isTestDeclaration(node) && countExpectCalls(node.arguments[node.arguments.length - 1]) === 0) {
    findings.push(make('INT-004', 'Test contains no assertions.', 'Assert every expected result of the approved test case.', node.loc?.start.line));
  }
}

function checkStringValue(value: unknown, line: number | undefined, findings: Finding[]): void {
  if (typeof value !== 'string') return;
  if (ABSOLUTE_URL.test(value)) {
    findings.push(make('INT-013', `Hard-coded absolute URL "${value}".`, 'Use relative paths resolved against the configured baseURL.', line));
  }
  if (value === 'networkidle') {
    findings.push(make('INT-008', "'networkidle' waits are unreliable and slow.", 'Use web-first assertions that auto-wait.', line));
  }
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.ruleId}|${f.line}|${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Collects integrity findings from a parsed TypeScript AST. K6 scripts are not checked.
 * @param {any} ast - recast AST (TypeScript parser)
 * @param {FILE_TYPE} fileType
 * @returns {Finding[]}
 */
export function collectIntegrityFindings(ast: any, fileType: FILE_TYPE): Finding[] {
  if (fileType === FILE_TYPE.K6) return [];
  const isSpec = fileType === FILE_TYPE.SPEC;
  const findings: Finding[] = [];
  const checkForce = (path: any) => {
    const { node } = path;
    const keyName = node.key?.type === 'Identifier' ? node.key.name : node.key?.value;
    if (keyName === 'force' && node.value?.value === true) {
      findings.push(make('INT-014', '{ force: true } bypasses actionability checks.', 'Interact only with actionable elements.', node.loc?.start.line));
    }
  };

  recast.visit(ast, {
    visitCallExpression(path: any) { checkCall(path, isSpec, findings); this.traverse(path); },
    visitTryStatement(path: any) {
      if (isSpec) findings.push(make('INT-003', 'try/catch in a test can swallow failures.', 'Let failures propagate.', path.node.loc?.start.line));
      this.traverse(path);
    },
    visitMemberExpression(path: any) {
      const { node } = path;
      const line = node.loc?.start.line;
      if (node.object.type === 'Identifier' && node.object.name === 'process' && propName(node) === 'env') {
        findings.push(make('INT-013', 'process.env accessed directly in test code.', 'Use the requireEnv() helper via the env binding.', line));
      }
      if (propName(node) === 'serial' && propName(node.object) === 'describe' && TEST_OBJECTS.has(rootIdentifier(node.object) || '')) {
        findings.push(make('INT-010', 'Serial test mode couples tests together.', 'Keep tests independent.', line));
      }
      this.traverse(path);
    },
    visitProperty(path: any) { checkForce(path); this.traverse(path); },
    visitObjectProperty(path: any) { checkForce(path); this.traverse(path); },
    visitLiteral(path: any) { checkStringValue(path.node.value, path.node.loc?.start.line, findings); this.traverse(path); },
    visitTemplateLiteral(path: any) {
      const first = path.node.quasis?.[0]?.value?.cooked;
      checkStringValue(first, path.node.loc?.start.line, findings);
      this.traverse(path);
    },
  });

  return dedupe(findings);
}
