'use strict';

/**
 * @fileoverview Generates test bodies with the LLM (JSON output), validates each entry fail-closed and retries
 * only the invalid test cases with their exact errors. A test case that is still invalid after the retries is
 * BLOCKED and never written as code.
 */

import pLimit from 'p-limit';
import * as recast from 'recast';
import { parseTypeScript } from '../../../core/automation-reviewer/ReviewRules';
import { GenerationMode, MAX_TCS_PER_CALL } from '../constants';
import { ChatFn, ChatMessage } from '../types';
import { AutomationTestCase, MissingItem } from '../contracts/automationTestCase';
import { PageContract } from '../rendering/pomRenderer';
import { GeneratedTest, StepAssertionMap, validateGeneratedTest } from '../validation/integrityValidator';
import { chunkArray, parseJsonObject } from '../sub-agents/shared/generation-utils';

/** Inputs for body generation. */
export interface BodyGenerationRequest {
  mode: GenerationMode;
  featureId: string;
  testCases: AutomationTestCase[];
  contract?: PageContract;
  systemPrompt: string;
  priorReviewFindings: Array<{ ruleId: string; message: string }>;
  /** Retries after the first attempt. */
  maxRetries: number;
  concurrency: number;
  /** Renders one test into its real file skeleton for rule-based validation. */
  renderHarness: (tc: AutomationTestCase, body: string) => string;
}

/** Final outcome for one test case. */
export interface TestOutcome {
  tcKey: string;
  status: 'GENERATED' | 'NEEDS_CONTEXT' | 'BLOCKED';
  body?: string;
  stepAssertions?: StepAssertionMap[];
  missing?: MissingItem[];
  errors?: string[];
  attempts: number;
}

/**
 * The JSON request sent to the LLM.
 * @param {BodyGenerationRequest} req
 * @param {AutomationTestCase[]} testCases
 * @param {Array<{ tcKey: string, errors: string[] }>} validationErrors
 * @returns {Record<string, unknown>}
 */
export function buildGenerationPayload(
  req: BodyGenerationRequest,
  testCases: AutomationTestCase[],
  validationErrors: Array<{ tcKey: string; errors: string[] }> = [],
): Record<string, unknown> {
  return {
    mode: req.mode,
    feature: { id: req.featureId },
    pageContract: req.contract,
    testCases: testCases.map((tc) => ({
      ...tc,
      steps: tc.steps.map((step) => ({
        index: step.index,
        keyword: step.keyword,
        action: step.action,
        expected: step.expected,
        testData: step.testData,
        data: step.data.map(({ token, fixtureKey, envVar }) => ({ token, fixtureKey, envVar })),
      })),
    })),
    priorReviewFindings: req.priorReviewFindings.length > 0 ? req.priorReviewFindings : undefined,
    validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
  };
}

function toMessages(req: BodyGenerationRequest, testCases: AutomationTestCase[], validationErrors: Array<{ tcKey: string; errors: string[] }>): ChatMessage[] {
  const payload = JSON.stringify(buildGenerationPayload(req, testCases, validationErrors), null, 2);
  return [
    { role: 'system', content: req.systemPrompt },
    { role: 'user', content: `Implement the approved test cases below. Respond with the JSON object defined in section F only.\n\n${payload}` },
  ];
}

/**
 * Returns the statements of a body the model wrapped in a function (`async ({ page }) => { ... }`).
 * The renderer supplies the function signature, so unwrapping does not change what the test does.
 * @param {string} body
 * @returns {string}
 */
export function unwrapFunctionBody(body: string): string {
  let ast: any;
  try {
    ast = parseTypeScript(body);
  } catch {
    return body;
  }
  const statements = ast.program.body;
  const only = statements.length === 1 ? statements[0] : null;
  const fn = only?.type === 'ExpressionStatement' ? only.expression : only;
  const isFunction = ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(fn?.type);
  if (!isFunction || fn.body?.type !== 'BlockStatement') return body;
  return fn.body.body.map((statement: any) => recast.print(statement).code).join('\n');
}

function sanitizeEntry(raw: any): GeneratedTest | null {
  if (!raw || typeof raw.tcKey !== 'string') return null;
  return {
    tcKey: raw.tcKey,
    status: String(raw.status || ''),
    body: typeof raw.body === 'string' ? unwrapFunctionBody(raw.body) : undefined,
    stepAssertions: Array.isArray(raw.stepAssertions)
      ? raw.stepAssertions.map((e: any) => ({ stepIndex: Number(e?.stepIndex), assertions: Array.isArray(e?.assertions) ? e.assertions.map(String) : [] }))
      : undefined,
    missing: Array.isArray(raw.missing) ? raw.missing.map((m: any) => ({ kind: m?.kind, detail: String(m?.detail ?? '') })) : undefined,
  };
}

function parseResponse(text: string): { entries: Map<string, GeneratedTest>; error?: string } {
  try {
    const raw = parseJsonObject(text);
    const entries = new Map<string, GeneratedTest>();
    (Array.isArray(raw?.tests) ? raw.tests : []).map(sanitizeEntry).forEach((entry: GeneratedTest | null) => {
      if (entry && !entries.has(entry.tcKey)) entries.set(entry.tcKey, entry);
    });
    return { entries };
  } catch (err: any) {
    return { entries: new Map(), error: `The response is not the required JSON object: ${err.message}` };
  }
}

function toOutcome(entry: GeneratedTest, attempts: number): TestOutcome {
  return entry.status === 'GENERATED'
    ? {
      tcKey: entry.tcKey, status: 'GENERATED', body: entry.body, stepAssertions: entry.stepAssertions, attempts,
    }
    : {
      tcKey: entry.tcKey, status: 'NEEDS_CONTEXT', missing: entry.missing, attempts,
    };
}

async function generateChunk(req: BodyGenerationRequest, chunk: AutomationTestCase[], chat: ChatFn): Promise<TestOutcome[]> {
  const outcomes = new Map<string, TestOutcome>();
  let pending = chunk;
  let feedback: Array<{ tcKey: string; errors: string[] }> = [];
  for (let attempt = 1; attempt <= req.maxRetries + 1 && pending.length > 0; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- each retry depends on the previous validation
    const { entries, error } = parseResponse(await chat(toMessages(req, pending, feedback), { json: true }));
    const retry: AutomationTestCase[] = [];
    feedback = [];
    for (const tc of pending) {
      const entry = entries.get(tc.tcKey);
      const harness = entry?.status === 'GENERATED' && entry.body ? req.renderHarness(tc, entry.body) : '';
      const errors = entry
        ? validateGeneratedTest(entry, {
          mode: req.mode, tc, contract: req.contract, harness,
        })
        : [error || `No entry was returned for ${tc.tcKey}.`];
      if (entry && errors.length === 0) {
        outcomes.set(tc.tcKey, toOutcome(entry, attempt));
      } else {
        retry.push(tc);
        feedback.push({ tcKey: tc.tcKey, errors });
        outcomes.set(tc.tcKey, {
          tcKey: tc.tcKey, status: 'BLOCKED', errors, attempts: attempt,
        });
      }
    }
    pending = retry;
  }
  return chunk.map((tc) => outcomes.get(tc.tcKey) as TestOutcome);
}

/**
 * Generates and validates bodies for all test cases (chunked, bounded concurrency, stable order).
 * @param {BodyGenerationRequest} req
 * @param {ChatFn} chat
 * @returns {Promise<TestOutcome[]>}
 */
export async function generateTestBodies(req: BodyGenerationRequest, chat: ChatFn): Promise<TestOutcome[]> {
  const limit = pLimit(Math.max(1, req.concurrency));
  const chunks = chunkArray(req.testCases, MAX_TCS_PER_CALL);
  const results = await Promise.all(chunks.map((chunk) => limit(() => generateChunk(req, chunk, chat))));
  return results.flat();
}
