'use strict';

/**
 * @fileoverview Context-aware, fail-closed validator for LLM-generated test bodies.
 * A body is accepted only if:
 *  - the rendered test passes every detect-only review/integrity rule,
 *  - it uses only page-contract members, bound fixture keys and bound env vars,
 *  - every step with expected results maps to assertions that exist verbatim in the body,
 *  - every assertion is mapped to a step, and
 *  - every expected value comes from the mapped step's expected-result text (or a data binding).
 */

import * as recast from 'recast';
import {
  analyzeWithAST, parseTypeScript, FILE_TYPE, FINDING_SEVERITY,
} from '../../../core/automation-reviewer/ReviewRules';
import {
  getAssertion, isLiteral, isTestDeclaration, propName,
} from '../../../core/automation-reviewer/IntegrityRules';
import { AutomationTestCase } from '../contracts/automationTestCase';
import { MISSING_KINDS, MissingItem } from '../../../core/readiness/readinessTypes';
import { FlowArg, FlowUsage } from '../discovery/flowExtractor';
import { MEMBER_KIND, PageContract } from '../rendering/pomRenderer';
import {
  DATA_FIXTURE, ENV_FUNCTION, GenerationMode, K6_ENV_FUNCTION, MIN_STATE_WORD_LENGTH, PAGE_FIXTURE, UI_PAGE_API,
} from '../constants';

/** Assertions the LLM claims verify a step. */
export interface StepAssertionMap {
  stepIndex: number;
  assertions: string[];
}

/** One LLM response entry. */
export interface GeneratedTest {
  tcKey: string;
  status: string;
  body?: string;
  stepAssertions?: StepAssertionMap[];
  missing?: MissingItem[];
}

/** Validation context for one test case. */
export interface ValidationContext {
  mode: GenerationMode;
  tc: AutomationTestCase;
  contract?: PageContract;
  /** The test rendered into its real file skeleton (used for the review/integrity rules). */
  harness: string;
  /** UI: verified flows this test case must call, with the exact arguments of each call. */
  flows?: FlowUsage[];
  /** UI: states discovery verified after each step (step index → state name and URL path). */
  verifiedStates?: Record<number, { state: string; urlPath: string }>;
}

interface AssertionStatement {
  norm: string;
  code: string;
  node: any;
}

const VALUE_AT_SECOND_ARG: ReadonlySet<string> = new Set(['toHaveCSS', 'toHaveAttribute', 'toHaveJSProperty']);
const ALLOWED_OPTION_KEYS: ReadonlySet<string> = new Set(['exact', 'ignoreCase', 'useInnerText', 'timeout']);
const TIMEOUT_OPTION = 'timeout';
const URL_MATCHER = 'toHaveURL';
const API_CONTEXT_METHODS: ReadonlySet<string> = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch']);
const SNIPPET_LENGTH = 90;

function snippet(text: string): string {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > SNIPPET_LENGTH ? `${oneLine.slice(0, SNIPPET_LENGTH - 3)}...` : oneLine;
}

/**
 * Whitespace-, semicolon- and leading-`await`-insensitive statement key.
 * @param {string} code
 * @returns {string}
 */
export function normalizeStatement(code: string): string {
  return String(code).replace(/\s+/g, '').replace(/;+$/, '').replace(/^await/, '');
}

/**
 * Fixture keys and env vars bound in a test case.
 * @param {AutomationTestCase} tc
 * @returns {{ fixtureKeys: Set<string>, envVars: Set<string> }}
 */
export function bindingsOf(tc: AutomationTestCase): { fixtureKeys: Set<string>; envVars: Set<string> } {
  const fixtureKeys = new Set<string>();
  const envVars = new Set<string>();
  tc.steps.forEach((step) => step.data.forEach((binding) => {
    if (binding.fixtureKey) fixtureKeys.add(binding.fixtureKey);
    if (binding.envVar) envVars.add(binding.envVar);
  }));
  if (tc.api?.requestBodyFixtureKey) fixtureKeys.add(tc.api.requestBodyFixtureKey);
  return { fixtureKeys, envVars };
}

/**
 * CSS rgb()/rgba() equivalents of hex colours written in a text.
 * @param {string} text
 * @returns {string[]}
 */
export function hexToRgbVariants(text: string): string[] {
  const variants: string[] = [];
  for (const match of String(text).matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const hex = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    variants.push(`rgb(${r}, ${g}, ${b})`, `rgba(${r}, ${g}, ${b}, 1)`);
  }
  return variants;
}

function containsAssertion(node: any, mode: GenerationMode): boolean {
  let found = false;
  recast.visit(node, {
    visitCallExpression(path: any) {
      const call = path.node;
      const isCheck = call.callee.type === 'Identifier' && call.callee.name === 'check';
      if (mode === 'K6' ? isCheck : !!getAssertion(call)) {
        found = true;
        return false;
      }
      this.traverse(path);
      return undefined;
    },
  });
  return found;
}

function validateNeedsContext(gen: GeneratedTest): string[] {
  const errors: string[] = [];
  if (gen.body && gen.body.trim()) errors.push('NEEDS_CONTEXT must not include a body.');
  if (!Array.isArray(gen.missing) || gen.missing.length === 0) errors.push('NEEDS_CONTEXT requires a non-empty "missing" array.');
  (gen.missing || []).forEach((item, idx) => {
    if (!(MISSING_KINDS as readonly string[]).includes(item?.kind)) errors.push(`missing[${idx}].kind must be one of ${MISSING_KINDS.join(', ')}.`);
    if (!item?.detail || !String(item.detail).trim()) errors.push(`missing[${idx}].detail is required.`);
  });
  return errors;
}

function harnessErrors(ctx: ValidationContext): string[] {
  const fileType = ctx.mode === 'K6' ? FILE_TYPE.K6 : FILE_TYPE.SPEC;
  return analyzeWithAST(ctx.harness, fileType).findings
    .filter((f) => f.severity === FINDING_SEVERITY.BLOCKER || f.severity === FINDING_SEVERITY.MAJOR)
    .map((f) => `${f.ruleId}: ${f.message}`);
}

function checkMember(node: any, ctx: ValidationContext, scope: { members: Set<string>; pageObjectVars: Set<string>; fixtureKeys: Set<string> }): string[] {
  if (node.object.type !== 'Identifier') return [];
  const objectName = node.object.name;
  const prop = propName(node);
  const errors: string[] = [];
  if (objectName === DATA_FIXTURE && (node.computed || !prop || !scope.fixtureKeys.has(prop))) {
    errors.push(`data.${prop ?? '[computed]'} is not a fixture key bound in the test case (${[...scope.fixtureKeys].join(', ') || 'none'}).`);
  }
  if (ctx.mode === 'UI' && scope.pageObjectVars.has(objectName) && prop && !scope.members.has(prop)) {
    errors.push(`${objectName}.${prop} is not a member of the verified page contract.`);
  }
  if (ctx.mode === 'UI' && objectName === 'page' && prop && !UI_PAGE_API.has(prop)) {
    errors.push(`page.${prop} is not allowed; use page-object members.`);
  }
  if (ctx.mode === 'API' && objectName === 'apiContext' && prop && !API_CONTEXT_METHODS.has(prop)) {
    errors.push(`apiContext.${prop} is not an allowed request method.`);
  }
  return errors;
}

function collectBodyFacts(ast: any, ctx: ValidationContext): { statements: AssertionStatement[]; errors: string[] } {
  const statements: AssertionStatement[] = [];
  const errors: string[] = [];
  const { fixtureKeys, envVars } = bindingsOf(ctx.tc);
  const scope = { members: new Set((ctx.contract?.members || []).map((m) => m.name)), pageObjectVars: new Set([PAGE_FIXTURE]), fixtureKeys };
  const envFunction = ctx.mode === 'K6' ? K6_ENV_FUNCTION : ENV_FUNCTION;

  recast.visit(ast, {
    visitExpressionStatement(path: any) {
      if (containsAssertion(path.node, ctx.mode)) {
        const code = recast.print(path.node).code;
        statements.push({ norm: normalizeStatement(code), code, node: path.node });
      }
      this.traverse(path);
    },
    visitImportDeclaration() {
      errors.push('Imports are not allowed in a test body.');
      return false;
    },
    visitVariableDeclarator(path: any) {
      const { init, id } = path.node;
      if (init?.type === 'NewExpression' && init.callee.type === 'Identifier' && init.callee.name === ctx.contract?.pageObject && id.type === 'Identifier') {
        scope.pageObjectVars.add(id.name);
      }
      this.traverse(path);
    },
    visitCallExpression(path: any) {
      const { node } = path;
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') errors.push('require() is not allowed in a test body.');
      if (isTestDeclaration(node)) errors.push('Nested test declarations are not allowed in a test body.');
      if (node.callee.type === 'Identifier' && node.callee.name === envFunction) {
        const arg = node.arguments[0];
        if (!isLiteral(arg) || !envVars.has(String(arg.value))) {
          errors.push(`${envFunction}(${arg ? recast.print(arg).code : ''}) must use an environment variable bound in the test case (${[...envVars].join(', ') || 'none'}).`);
        }
      }
      this.traverse(path);
    },
    visitMemberExpression(path: any) {
      errors.push(...checkMember(path.node, ctx, scope));
      this.traverse(path);
    },
  });
  return { statements, errors };
}

function checkStepMapping(gen: GeneratedTest, statements: AssertionStatement[], tc: AutomationTestCase): string[] {
  const errors: string[] = [];
  const entries = Array.isArray(gen.stepAssertions) ? gen.stepAssertions : [];
  const bodyNorms = new Set(statements.map((s) => s.norm));
  const mapped = new Set<string>();
  for (const entry of entries) {
    const step = tc.steps.find((s) => s.index === entry.stepIndex);
    if (!step) {
      errors.push(`stepAssertions references unknown step ${entry.stepIndex}.`);
      continue;
    }
    for (const assertion of entry.assertions || []) {
      const norm = normalizeStatement(assertion);
      if (!bodyNorms.has(norm)) errors.push(`Step ${step.index}: listed assertion is not a statement in the body: ${snippet(assertion)}`);
      mapped.add(norm);
    }
  }
  for (const step of tc.steps.filter((s) => s.expected.length > 0)) {
    const count = entries.filter((e) => e.stepIndex === step.index).reduce((sum, e) => sum + (e.assertions || []).length, 0);
    if (count < step.expected.length) {
      errors.push(`Step ${step.index} has ${step.expected.length} expected result(s) ("${snippet(step.expected.join('; '))}") but ${count} mapped assertion(s).`);
    }
  }
  statements.filter((s) => !mapped.has(s.norm)).forEach((s) => errors.push(`Assertion is not mapped to any step: ${snippet(s.code)}`));
  return errors;
}

function regexChunks(pattern: string): string[] {
  return pattern.replace(/\\(.)/g, '$1').split(/[\^$.*+?()[\]{}|]/).map((chunk) => chunk.trim()).filter((chunk) => chunk.length >= 3);
}

function timeoutErrors(options: any, allowed: string, label: string): string[] {
  const timeout = options.properties.find((p: any) => (p.key?.name ?? p.key?.value) === TIMEOUT_OPTION);
  if (!timeout) return [];
  const { value } = timeout;
  const isNumber = value?.type === 'NumericLiteral' || (value?.type === 'Literal' && typeof value.value === 'number');
  return isNumber && allowed.includes(String(value.value)) ? [] : [`${label}: timeout must be a number stated in the step's expected result.`];
}

function valueErrors(arg: any, allowed: string, label: string, colourAware: boolean): string[] {
  if (!arg) return [];
  const isString = arg.type === 'StringLiteral' || (arg.type === 'Literal' && typeof arg.value === 'string');
  if (isString) {
    const value = String(arg.value);
    if (value === '' || allowed.includes(value) || (colourAware && hexToRgbVariants(allowed).includes(value))) return [];
    return [`${label}: expected value "${snippet(value)}" does not appear in the step's expected result.`];
  }
  if (arg.type === 'NumericLiteral' || (arg.type === 'Literal' && typeof arg.value === 'number')) {
    return allowed.includes(String(arg.value)) ? [] : [`${label}: expected number ${arg.value} does not appear in the step's expected result.`];
  }
  if (arg.type === 'RegExpLiteral' || arg.regex) {
    const pattern = arg.pattern ?? arg.regex?.pattern ?? '';
    const chunks = regexChunks(pattern);
    if (chunks.length === 0) return [`${label}: regular expression /${pattern}/ contains no literal text from the expected result.`];
    const missing = chunks.filter((chunk) => !allowed.includes(chunk));
    return missing.length > 0 ? [`${label}: regular expression text "${missing.join('", "')}" does not appear in the step's expected result.`] : [];
  }
  if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
    return valueErrors({ type: 'StringLiteral', value: arg.quasis[0]?.value?.cooked ?? '' }, allowed, label, colourAware);
  }
  if (arg.type === 'MemberExpression' && arg.object.type === 'Identifier' && arg.object.name === DATA_FIXTURE) return [];
  if (arg.type === 'CallExpression' && arg.callee.type === 'Identifier' && arg.callee.name === ENV_FUNCTION) return [];
  if (arg.type === 'ObjectExpression') {
    const keys = arg.properties.map((p: any) => p.key?.name ?? p.key?.value);
    const invalid = keys.filter((key: string) => !ALLOWED_OPTION_KEYS.has(key));
    return invalid.length > 0 ? [`${label}: assertion option(s) ${invalid.join(', ')} are not allowed.`] : timeoutErrors(arg, allowed, label);
  }
  return [`${label}: expected value must be a literal from the test case, data.<key> or env(); got ${snippet(recast.print(arg).code)}`];
}

function assertionProvenanceErrors(statement: AssertionStatement, allowed: string, stepIndex: number, verifiedUrl?: string): string[] {
  const errors: string[] = [];
  recast.visit(statement.node, {
    visitCallExpression(path: any) {
      const assertion = getAssertion(path.node);
      if (assertion) {
        const args = VALUE_AT_SECOND_ARG.has(assertion.matcher) ? path.node.arguments.slice(1) : path.node.arguments;
        const scope = assertion.matcher === URL_MATCHER && verifiedUrl ? `${allowed}\n${verifiedUrl}` : allowed;
        args.forEach((arg: any) => errors.push(...valueErrors(arg, scope, `Step ${stepIndex} ${assertion.matcher}()`, assertion.matcher === 'toHaveCSS')));
      }
      this.traverse(path);
    },
  });
  return errors;
}

function nonAssertionLiteralErrors(ast: any, statements: AssertionStatement[], tc: AutomationTestCase): string[] {
  const allText = [tc.title, tc.objective, tc.precondition, ...tc.steps.flatMap((s) => [s.action, s.testData, ...s.expected])].join('\n');
  const assertionNodes = new Set(statements.map((s) => s.node));
  const errors: string[] = [];
  recast.visit(ast, {
    visitExpressionStatement(path: any) {
      if (assertionNodes.has(path.node)) return false;
      this.traverse(path);
      return undefined;
    },
    visitLiteral(path: any) {
      const { node } = path;
      const parent = path.parent?.node;
      if (typeof node.value !== 'string' || node.value === '') return false;
      const isKey = (parent?.type === 'ObjectProperty' || parent?.type === 'Property') && parent.key === node;
      const calleeName = parent?.type === 'CallExpression'
        ? (parent.callee.type === 'Identifier' ? parent.callee.name : propName(parent.callee))
        : null;
      const exempt = calleeName === 'press' || calleeName === ENV_FUNCTION;
      if (!isKey && !exempt && !allText.includes(node.value)) {
        errors.push(`Literal "${snippet(node.value)}" does not appear in the test case; use a data binding.`);
      }
      return false;
    },
  });
  return errors;
}

function stateWords(stateName: string): string[] {
  return stateName.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length >= MIN_STATE_WORD_LENGTH);
}

/**
 * URL path of the state discovery verified after a step. It may be used as a `toHaveURL` value only when the step's
 * expected result names that state (one of the state name's words appears in it).
 * @param {ValidationContext} ctx
 * @param {number} stepIndex
 * @returns {string|undefined}
 */
export function verifiedUrlFor(ctx: ValidationContext, stepIndex: number): string | undefined {
  const verified = ctx.verifiedStates?.[stepIndex];
  if (!verified) return undefined;
  const expected = (ctx.tc.steps.find((s) => s.index === stepIndex)?.expected.join(' ') || '').toLowerCase();
  return stateWords(verified.state).some((word) => expected.includes(word)) ? verified.urlPath : undefined;
}

/** An assertion whose value came from a discovery-verified state rather than the test case text. */
export interface DiscoveryProvenance {
  stepIndex: number;
  assertion: string;
  state: string;
  urlPath: string;
}

function parseStatement(code: string): any | null {
  try {
    return parseTypeScript(`async function __ariaAssertion() {\n${code}\n}`).program.body[0].body.body[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Assertions that are valid only because of a discovery-verified URL path (recorded for traceability).
 * @param {GeneratedTest} gen
 * @param {ValidationContext} ctx
 * @returns {DiscoveryProvenance[]}
 */
export function discoveryProvenance(gen: GeneratedTest, ctx: ValidationContext): DiscoveryProvenance[] {
  if (ctx.mode !== 'UI') return [];
  return (gen.stepAssertions || []).flatMap((entry) => {
    const url = verifiedUrlFor(ctx, entry.stepIndex);
    const verified = ctx.verifiedStates?.[entry.stepIndex];
    if (!url || !verified) return [];
    const expected = ctx.tc.steps.find((s) => s.index === entry.stepIndex)?.expected.join('\n') || '';
    return (entry.assertions || []).filter((assertion) => {
      const node = parseStatement(assertion);
      const statement = { norm: normalizeStatement(assertion), code: assertion, node };
      return !!node && assertionProvenanceErrors(statement, expected, entry.stepIndex).length > 0
        && assertionProvenanceErrors(statement, expected, entry.stepIndex, url).length === 0;
    }).map((assertion) => ({
      stepIndex: entry.stepIndex, assertion, state: verified.state, urlPath: url,
    }));
  });
}

function argMatches(node: any, arg: FlowArg): boolean {
  if (arg.kind === 'literal') return isLiteral(node) && String(node.value) === arg.value;
  if (arg.kind === 'data') {
    return node?.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier'
      && node.object.name === DATA_FIXTURE && propName(node) === arg.key;
  }
  return node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === ENV_FUNCTION
    && isLiteral(node.arguments[0]) && node.arguments[0].value === arg.name;
}

function argsMatch(nodes: any[], args: Record<string, FlowArg>): boolean {
  const params = Object.keys(args);
  if (params.length === 0) return nodes.length === 0;
  if (nodes.length !== 1 || nodes[0].type !== 'ObjectExpression') return false;
  const props = new Map<string, any>(nodes[0].properties.map((p: any) => [p.key?.name ?? p.key?.value, p.value]));
  return props.size === params.length && params.every((param) => props.has(param) && argMatches(props.get(param), args[param]));
}

function describeArgs(args: Record<string, FlowArg>): string {
  const entries = Object.entries(args);
  return entries.length === 0 ? '()' : `({ ${entries.map(([param, arg]) => `${param}: ${arg.expression}`).join(', ')} })`;
}

function checkFlowCall(
  path: any,
  member: string,
  ctx: ValidationContext,
  remaining: Map<string, Array<Record<string, FlowArg>>>,
  topLevel: Set<any>,
): string[] {
  const calls = remaining.get(member);
  if (!calls) return [`featurePage.${member}() is not a verified flow for ${ctx.tc.tcKey}; perform the test case's own steps instead.`];
  if (path.parent?.node?.type !== 'AwaitExpression' || !topLevel.has(path.parent.parent?.node)) {
    return [`featurePage.${member}() must be awaited as its own top-level statement.`];
  }
  if (calls.length === 0) return [`featurePage.${member}() is called more often than ${ctx.tc.tcKey} performs it.`];
  const index = calls.findIndex((args) => argsMatch(path.node.arguments, args));
  if (index === -1) return [`featurePage.${member}() arguments must be exactly ${calls.map(describeArgs).join(' or ')}.`];
  calls.splice(index, 1);
  return [];
}

function flowCallErrors(ast: any, ctx: ValidationContext): string[] {
  const flowMembers = new Set((ctx.contract?.members || []).filter((m) => m.kind === MEMBER_KIND.FLOW).map((m) => m.name));
  if (ctx.mode !== 'UI' || flowMembers.size === 0) return [];
  const topLevel = new Set<any>(ast.program.body[0].body.body);
  const remaining = new Map((ctx.flows || []).map((usage) => [usage.member, [...usage.calls]]));
  const errors: string[] = [];
  recast.visit(ast, {
    visitCallExpression(path: any) {
      const { callee } = path.node;
      const member = callee.type === 'MemberExpression' && callee.object.type === 'Identifier' ? propName(callee) : null;
      if (member && flowMembers.has(member)) errors.push(...checkFlowCall(path, member, ctx, remaining, topLevel));
      this.traverse(path);
    },
  });
  return errors;
}

function actionToken(statement: any): string | null {
  const expression = statement.type === 'ExpressionStatement' ? statement.expression : null;
  const call = expression?.type === 'AwaitExpression' ? expression.argument : expression;
  if (call?.type !== 'CallExpression' || call.callee.type !== 'MemberExpression') return null;
  const target = call.callee.object;
  if (target.type === 'Identifier' && target.name === 'page') return `page:${propName(call.callee)}`;
  return target.type === 'MemberExpression' ? `${propName(target)}:${propName(call.callee)}` : null;
}

function inlineFlowErrors(ast: any, ctx: ValidationContext): string[] {
  if (ctx.mode !== 'UI' || !ctx.flows || ctx.flows.length === 0) return [];
  const tokens = (ast.program.body[0].body.body as any[]).map(actionToken);
  return ctx.flows
    .filter((usage) => {
      const sequence = usage.actions.map((action) => `${action.member ?? 'page'}:${action.op}`);
      return tokens.some((_, start) => sequence.every((token, offset) => tokens[start + offset] === token));
    })
    .map((usage) => `The body performs the actions of verified flow ${usage.member} one by one; call featurePage.${usage.member}(...) instead.`);
}

function checkProvenance(gen: GeneratedTest, ast: any, statements: AssertionStatement[], ctx: ValidationContext): string[] {
  if (ctx.mode === 'K6') return [];
  const stepByNorm = new Map<string, number>();
  (gen.stepAssertions || []).forEach((entry) => (entry.assertions || []).forEach((a) => stepByNorm.set(normalizeStatement(a), entry.stepIndex)));
  const errors: string[] = [];
  for (const statement of statements) {
    const stepIndex = stepByNorm.get(statement.norm);
    if (stepIndex === undefined) continue;
    const expected = ctx.tc.steps.find((s) => s.index === stepIndex)?.expected.join('\n') || '';
    const allowed = ctx.mode === 'API' ? `${expected}\n${ctx.tc.api?.expectedStatusCode ?? ''}` : expected;
    errors.push(...assertionProvenanceErrors(statement, allowed, stepIndex, ctx.mode === 'UI' ? verifiedUrlFor(ctx, stepIndex) : undefined));
  }
  if (ctx.mode === 'UI') errors.push(...nonAssertionLiteralErrors(ast, statements, ctx.tc));
  return errors;
}

/**
 * Validates one generated test entry.
 * @param {GeneratedTest} gen
 * @param {ValidationContext} ctx
 * @returns {string[]} Errors; empty when the entry is acceptable
 */
export function validateGeneratedTest(gen: GeneratedTest, ctx: ValidationContext): string[] {
  if (gen.status === 'NEEDS_CONTEXT') return validateNeedsContext(gen);
  if (gen.status !== 'GENERATED') return ['status must be GENERATED or NEEDS_CONTEXT.'];
  if (!gen.body || !gen.body.trim()) return ['GENERATED requires a non-empty body.'];

  let ast: any;
  try {
    ast = parseTypeScript(`async function __ariaBody() {\n${gen.body}\n}`);
  } catch (err: any) {
    return [`The body is not valid TypeScript: ${err.message}`];
  }
  const facts = collectBodyFacts(ast, ctx);
  const errors = [
    ...harnessErrors(ctx),
    ...facts.errors,
    ...flowCallErrors(ast, ctx),
    ...inlineFlowErrors(ast, ctx),
    ...checkStepMapping(gen, facts.statements, ctx.tc),
    ...checkProvenance(gen, ast, facts.statements, ctx),
  ];
  return [...new Set(errors)];
}
