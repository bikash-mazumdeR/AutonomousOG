/**
 * @fileoverview Agent 04 — Test Data Generator.
 * Resolves every {{placeholder}} in the reviewed test suite into concrete,
 * realistic, environment-aware test data values. Produces a TestDataManifest
 * consumed by Agents 05 and 07.
 *
 * @module TestDataGeneratorAgent
 * @version 1.0.0
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { llmClient } from '../../core/llm/LLMClient';
import { isTestCaseSelected } from '../../core/types';
import { buildFlatTestData } from '../../core/state-manager/FixtureSync';
import {
  RUNTIME_SENTINEL, deriveGenericValue, isSensitivePlaceholder, resolveByIntent,
} from './placeholderIntent';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_ID = '04-test-data-generator';
const STAGE_NAME = 'Test Data Generator';
const NEXT_STAGE = '05-playwright-script-generator';

const SKILL_PATH = path.resolve(__dirname, '../../skills/test-data-generation.md');

/**
 * Placeholder resolution map.
 * Key   = placeholder name (without braces).
 * Value = resolver function or static descriptor.
 * @type {Object.<string, Function|string>}
 */
const PLACEHOLDER_RESOLVERS = Object.freeze({
  // ── URLs ──────────────────────────────────────────────────────────────
  validBaseURL: (ctx) => ctx.requirementData?.baseURL || ctx.baseURL || 'https://www.saucedemo.com/',
  apiBaseURL: (ctx) => ctx.requirementData?.baseURL || ctx.baseURL || 'https://www.saucedemo.com/',
  apiEndpoint: (ctx) => ctx.firstEndpoint || '{{apiEndpoint — UNRESOLVED: set integration endpoint}}',

  // ── Credentials (Rule 0: Requirement document takes priority) ────────
  validUsername: (ctx) => ctx.requirementData?.standardUsername || 'standard_user',
  validPassword: (ctx) => ctx.requirementData?.password || 'secret_sauce',
  invalidPassword: () => 'wrong_pass_001',
  adminUsername: (ctx) => ctx.requirementData?.standardUsername || 'standard_user',
  adminPassword: (ctx) => ctx.requirementData?.password || 'secret_sauce',
  lowPrivUsername: (ctx) => ctx.requirementData?.visualUsername || 'visual_user',
  lowPrivPassword: (ctx) => ctx.requirementData?.password || 'secret_sauce',
  lowPrivilegeUserCredentials: (ctx) => `${ctx.requirementData?.visualUsername || 'visual_user'} / ${ctx.requirementData?.password || 'secret_sauce'}`,
  script: () => 'console.log("ARIA Test Script Executing");',

  // ── Emails ────────────────────────────────────────────────────────────
  validEmail: (ctx) => `aria_test_${ctx.seed}@testdomain.io`,
  invalidEmail: () => 'notanemail.nodomain',
  existingEmail: (ctx) => `aria_existing_${ctx.seed}@testdomain.io`,
  adminEmail: (ctx) => `aria_admin_${ctx.seed}@testdomain.io`,

  // ── Names ─────────────────────────────────────────────────────────────
  validName: (ctx) => `${FIRST_NAMES[ctx.seedInt % FIRST_NAMES.length]} ${
    LAST_NAMES[ctx.seedInt % LAST_NAMES.length]}`,
  firstName: (ctx) => FIRST_NAMES[ctx.seedInt % FIRST_NAMES.length],
  lastName: (ctx) => LAST_NAMES[ctx.seedInt % LAST_NAMES.length],

  // ── Phone ─────────────────────────────────────────────────────────────
  validPhone: (ctx) => `+91-${9000000000 + (ctx.seedInt % 999999999)}`,
  invalidPhone: () => 'INVALID-PHONE-ABC',

  // ── Dates ─────────────────────────────────────────────────────────────
  validDate: () => new Date().toISOString().slice(0, 10),
  validFutureDate: () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  validPastDate: () => new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
  validExpiredDate: () => new Date(Date.now() - 86400000).toISOString().slice(0, 10),

  // ── Amounts / Numbers ─────────────────────────────────────────────────
  validAmount: () => '99.99',
  invalidAmount: () => '-1',
  maxAmount: () => '999999.99',
  minAmount: () => '0.01',
  exactMinimumValue: () => '1',
  exactMaximumValue: () => '255',

  // ── URLs ──────────────────────────────────────────────────────────────
  validURL: (ctx) => `https://aria-test-${ctx.seed}.example.com`,

  // ── Tokens — runtime resolved ─────────────────────────────────────────
  authToken: () => RUNTIME_SENTINEL,
  expiredJwtToken: () => _buildExpiredJWT(),
  lowPrivToken: () => RUNTIME_SENTINEL,
  csrfToken: () => RUNTIME_SENTINEL,

  // ── Generic data ──────────────────────────────────────────────────────
  testData: (ctx) => `aria_data_${ctx.seed}`,
  validTestData: (ctx) => `aria_valid_${ctx.seed}`,
  invalidTestData: () => 'ARIA_INVALID_DATA_##!!',
  validPayload: (ctx) => JSON.stringify({ testKey: `aria_${ctx.seed}`, timestamp: Date.now() }),
  validRequestPayload: (ctx) => JSON.stringify({ data: `aria_request_${ctx.seed}` }),
  invalidPayload: () => '{ broken json }',
});

/** Synthetic first names pool */
const FIRST_NAMES = Object.freeze([
  'Priya', 'Amit', 'Sneha', 'Rahul', 'Anjali', 'Vikram', 'Kavya', 'Arjun',
  'Meena', 'Suresh', 'Deepa', 'Nikhil', 'Pooja', 'Rajesh', 'Sunita', 'Aakash',
  'Divya', 'Kiran', 'Lakshmi', 'Manoj',
]);

/** Synthetic last names pool */
const LAST_NAMES = Object.freeze([
  'Sharma', 'Patel', 'Verma', 'Singh', 'Kumar', 'Gupta', 'Iyer', 'Nair',
  'Reddy', 'Joshi', 'Mehta', 'Shah', 'Kapoor', 'Chopra', 'Bose', 'Das',
  'Pillai', 'Rao', 'Sinha', 'Tiwari',
]);

/** Edge case boundary data sets */
const BOUNDARY_LIBRARY = Object.freeze({
  strings: {
    min: 1,
    max: 255,
    minValue: 'A',
    maxValue: 'A'.repeat(255),
    underMin: '',
    overMax: 'A'.repeat(256),
    zero: '',
    longString: 'A'.repeat(1001),
    specialChars: '#%&<>!@$^*()',
    unicode: '🚀 中文 العربية Ñ',
    whitespace: '   ',
    sqlInject: "' OR '1'='1'; DROP TABLE users;--",
    xssPayload: "<script>alert('aria-xss-test')</script>",
  },
  numbers: {
    min: 0,
    max: 2147483647,
    underMin: -1,
    overMax: 2147483648,
    zero: 0,
    negative: -999,
    decimal: 0.001,
    maxDecimal: 999999999.99,
  },
});

// ─── TestDataGeneratorAgent ───────────────────────────────────────────────────

/**
 * @class TestDataGeneratorAgent
 * @description Resolves all test data placeholders into concrete, deterministic values.
 */
class TestDataGeneratorAgent {
  constructor() {
    this._logger = new Logger(STAGE_ID);
    this._skill = this._loadSkill();
  }

  // ── Entry Point ──────────────────────────────────────────────────────────

  /**
   * @param {Object} input
   * @param {Object} input.reviewedTestCases    - Output of Agent 03
   * @param {Object} input.analyzedRequirements - Output of Agent 01
   * @returns {Promise<AgentResult>}
   */
  async run(input) {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);

    if (!input.reviewedTestCases) {
      throw new Error('reviewedTestCases not found. Ensure Agent 03 completed successfully.');
    }

    try {
      const memoryContext = await memoryEngine.getContextForStage(STAGE_ID);
      await stateManager.markStageRunning(STAGE_ID);

      const { reviewedZephyrExport } = input.reviewedTestCases;
      const analysis = input.analyzedRequirements || {};
      const allTestCases = reviewedZephyrExport?.testCases || [];
      const { projectId } = FRAMEWORK_CONFIG;

      // ── Approved Scope Enforcement ──────────────────────────────────────────
      // Test data is strictly generated ONLY for approved test cases
      const isApproved = (tc: any) =>
        tc.reviewStatus !== 'REJECTED' && isTestCaseSelected(tc);

      const approvedTestCases = allTestCases.filter(isApproved);
      const excludedTestCases = allTestCases.filter((tc: any) => !isApproved(tc));

      this._logger.info('Generating test data for approved test cases', {
        totalReviewed: allTestCases.length,
        approvedForDataGen: approvedTestCases.length,
        excludedSkipped: excludedTestCases.length,
        env: FRAMEWORK_CONFIG.environment,
      });

      // ── 1. Extract explicit test data from requirements (Rule 0) ────────
      const requirementData = this._extractRequirementData(analysis);

      // ── 2. Build global context with requirement values ─────────────────
      const globalCtx = this._buildGlobalContext(analysis, projectId, requirementData);

      // ── 3. Restore known patterns from memory (requirement values still win, Rule 0)
      const knownPatterns = this._loadMemoryPatterns(memoryContext);

      // ── 4. Resolve per-TC data (only for approved test cases) ───────────
      const perTCData = {};
      const unresolved = [];
      const sensitiveRefs = new Set();

      for (const tc of approvedTestCases) {
        const tcCtx = this._buildTCContext(tc, globalCtx, projectId);
        const result = this._resolveTC(tc, tcCtx, knownPatterns);

        perTCData[tc.key] = result.data;
        unresolved.push(...result.unresolved);
        result.sensitiveRefs.forEach((r) => sensitiveRefs.add(r));
      }

      // ── 5. Build API payload library ───────────────────────────────────
      const apiPayloadLibrary = this._buildAPIPayloadLibrary(approvedTestCases, globalCtx);

      // ── 6. Build environment overrides ────────────────────────────────
      const environmentOverrides = this._buildEnvironmentOverrides(globalCtx);

      // ── 7. Build manifest ──────────────────────────────────────────────
      const manifest = this._buildManifest({
        projectId,
        sourceReviewId: input.reviewedTestCases.reviewId || null,
        requirementValues: requirementData,
        globalCtx,
        perTCData,
        apiPayloadLibrary,
        environmentOverrides,
        unresolved,
        sensitiveRefs: [...sensitiveRefs],
        totalTCs: approvedTestCases.length,
        totalReviewed: allTestCases.length,
        approvedCount: approvedTestCases.length,
        excludedCount: excludedTestCases.length,
        excludedTestCases: excludedTestCases.map((tc: any) => ({
          key: tc.key,
          name: tc.name,
          type: tc.type,
          reason: tc.reviewStatus === 'REJECTED' ? 'Rejected in Agent 03 review' : 'Excluded by user selection'
        }))
      });

      // ── 8. Persist patterns to memory ─────────────────────────────────
      await this._persistPatternsToMemory(perTCData);

      // ── 9. Inject resolved data into approved test cases ───────────────
      const enrichedApprovedTestCases = this._injectDataIntoTestCases(approvedTestCases, perTCData);

      const output = {
        manifest,
        enrichedZephyrExport: {
          ...reviewedZephyrExport,
          testCases: enrichedApprovedTestCases,
        },
        summary: this._buildSummary(manifest),
      };

      // ── 9. Persist to state & disk ────────────────────────────────────
      await stateManager.setPipelineArtifact('testData', output);
      await stateManager.markStageCompleted(STAGE_ID, output);
      this._saveToDisk(manifest, enrichedApprovedTestCases);

      const durationMs = Date.now() - startMs;
      this._logger.stage('COMPLETE', STAGE_ID, {
        resolved: manifest.resolvedCount,
        unresolved: manifest.unresolvedCount,
        durationMs,
      });

      const warnings = unresolved.map(
        (u) => `[UNRESOLVED] ${u.tcKey} step ${u.stepIndex}: ${u.placeholder} — ${u.reason}`,
      );

      const agentResult = this._buildAgentResult(output, warnings, durationMs);

      // ── 10. Approval gate ──────────────────────────────────────────────
      const gateResult = await approvalGate.waitForApproval({
        stageId: STAGE_ID,
        stageName: STAGE_NAME,
        nextStageName: NEXT_STAGE,
        summary: this._buildApprovalSummary(manifest),
        fullOutput: manifest,
        warnings,
      });

      agentResult.approvalStatus = gateResult.status;
      agentResult.approvalComment = gateResult.comment;

      await memoryEngine.recordApprovalFeedback(
        STAGE_ID,
        gateResult.status,
        gateResult.comment,
        `Resolved: ${manifest.resolvedCount}, Unresolved: ${manifest.unresolvedCount}`,
      );

      return agentResult;
    } catch (error) {
      this._logger.error('Agent execution failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  // ── Global Context Builder ────────────────────────────────────────────────

  /**
   * Builds the shared resolution context for all TCs.
   * @private
   */
  _buildGlobalContext(analysis, projectId, requirementData: any = {}) {
    const masterSeed = this._makeSeed(projectId);
    const masterSeedInt = parseInt(masterSeed.slice(0, 8), 16);
    const firstEndpoint = analysis.integrationPoints?.[0]?.endpoint || null;

    const baseURL = requirementData.baseURL || FRAMEWORK_CONFIG.playwright.baseURL || 'https://www.saucedemo.com/';
    const password = requirementData.password || 'secret_sauce';
    const standardUsername = requirementData.standardUsername || 'standard_user';

    return {
      baseURL,
      apiBaseURL: baseURL,
      environment: FRAMEWORK_CONFIG.environment,
      projectId,
      seed: masterSeed,
      seedInt: masterSeedInt,
      firstEndpoint,
      requirementData,
      globalFixtures: {
        baseURL,
        adminCredentials: {
          username: standardUsername,
          password,
        },
        userCredentials: {
          username: standardUsername,
          password,
        },
        guestCredentials: {
          username: requirementData.visualUsername || 'visual_user',
          password,
        },
        apiBaseURL: baseURL,
        defaultHeaders: { 'Content-Type': 'application/json' },
      },
    };
  }

  /**
   * Builds a per-TC resolution context (deterministic seed per TC).
   * @private
   */
  _buildTCContext(tc, globalCtx, projectId) {
    const seed = this._makeSeed(`${projectId}-${tc.key}`);
    const seedInt = parseInt(seed.slice(0, 8), 16);
    return {
      ...globalCtx,
      seed,
      seedInt,
      tcKey: tc.key,
      tcType: tc.type,
    };
  }

  // ── Placeholder Resolution ────────────────────────────────────────────────

  /**
   * Resolves all placeholders in a single test case's steps.
   * @private
   */
  _resolveTC(tc, ctx, knownPatterns) {
    const inputs = {};
    const unresolved = [];
    const sensitiveRefs = [];

    for (const ph of this._extractPlaceholders(tc)) {
      const key = ph.replace(/^\{\{|\}\}$/g, '');
      const entry = this._resolveInput(key, tc, ctx, knownPatterns);

      if (entry) {
        inputs[ph] = entry;
        if (entry.sensitive) sensitiveRefs.push(ph);
        continue;
      }

      unresolved.push({
        placeholder: ph,
        tcKey: tc.key,
        stepIndex: this._findPlaceholderStep(tc, ph),
        reason: `Cannot infer data type for "${key}" from context`,
        suggestion: `Provide "${key}" in the requirement, add it to PLACEHOLDER_RESOLVERS in agent.ts, or set it in the Agent 04 UI`,
      });
      inputs[ph] = {
        value: `{{UNRESOLVED:${key}}}`, type: 'unknown', sensitive: false, source: 'unresolved', note: 'REQUIRES MANUAL RESOLUTION',
      };
    }

    const apiPayload = tc.type === 'API' && tc.apiDetails?.requestBody ? this._resolveAPIPayload(tc.apiDetails, ctx) : null;
    const boundaryData = tc.type === 'Edge' ? this._buildBoundaryData(tc) : null;

    return {
      data: {
        tcKey: tc.key, type: tc.type, inputs, apiPayload, boundaryData, unresolved: unresolved.map((u) => u.placeholder),
      },
      unresolved,
      sensitiveRefs,
    };
  }

  /**
   * Resolves one placeholder. Priority: requirement (Rule 0) → memory → resolver catalogue →
   * intent (wrong / arbitrary / case-variant credential) → boundary → generic field name.
   * @returns {Object|null} Manifest input entry, or null when the placeholder cannot be resolved
   * @private
   */
  _resolveInput(key, tc, ctx, knownPatterns) {
    const sensitive = isSensitivePlaceholder(key);
    const requirementValue = ctx.requirementData?.[key];
    if (requirementValue !== undefined) return this._entry(key, requirementValue, 'requirement', sensitive, 'Copied from the requirement');
    if (knownPatterns[key] !== undefined) return this._entry(key, knownPatterns[key], 'memory', sensitive, 'Reused from previous run');

    const resolver = PLACEHOLDER_RESOLVERS[key];
    if (resolver) return this._generatedEntry(key, typeof resolver === 'function' ? resolver(ctx) : resolver, sensitive, '');

    const intent = resolveByIntent(key, {
      seed: ctx.seed, username: ctx.requirementData?.standardUsername, password: ctx.requirementData?.password,
    });
    if (intent) return this._entry(key, intent.value, 'generated', sensitive, intent.note);

    const boundaryValue = this._resolveBoundary(key, tc);
    if (boundaryValue !== null) {
      return { value: boundaryValue, type: 'boundary', sensitive: false, source: 'generated', note: `Boundary value for edge test: ${key}` };
    }

    const contextValue = deriveGenericValue(key, { seed: ctx.seed, tcKey: ctx.tcKey, tcText: `${tc.name} ${tc.objective}` });
    return contextValue === null ? null : this._generatedEntry(key, contextValue, sensitive, 'Context-derived fallback');
  }

  /** Entry for a generated value; the runtime sentinel is marked as runtime-resolved. @private */
  _generatedEntry(key, value, sensitive, note) {
    return value === RUNTIME_SENTINEL
      ? this._entry(key, value, 'runtime', sensitive, 'Loaded from CI/env secrets at runtime')
      : this._entry(key, value, 'generated', sensitive, note);
  }

  /** @private */
  _entry(key, value, source, sensitive, note) {
    return { value, type: this._inferDataType(key, value), sensitive, source, note };
  }

  /**
   * Extracts all unique {{placeholder}} tokens from a TC's steps.
   * @private
   */
  _extractPlaceholders(tc) {
    const found = new Set();
    const re = /\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g;

    const texts = [
      tc.precondition,
      tc.objective,
      ...(tc.testSteps || []).flatMap((s) => [s.description, s.testData, s.expectedResult]),
      tc.apiDetails ? JSON.stringify(tc.apiDetails) : '',
    ].filter(Boolean);

    for (const text of texts) {
      const matches = text.match(re) || [];
      matches.forEach((m) => found.add(m));
    }

    return [...found];
  }

  /**
   * Attempts to resolve boundary-specific placeholder names.
   * @private
   */
  _resolveBoundary(key, tc) {
    const lower = key.toLowerCase();

    if (tc.type !== 'Edge') return null;

    const boundaryMap = {
      exactminimumvalue: BOUNDARY_LIBRARY.strings.minValue,
      exactmaximumvalue: BOUNDARY_LIBRARY.strings.maxValue,
      longstring: BOUNDARY_LIBRARY.strings.longString,
      specialchars: BOUNDARY_LIBRARY.strings.specialChars,
      unicode: BOUNDARY_LIBRARY.strings.unicode,
      whitespaceonly: BOUNDARY_LIBRARY.strings.whitespace,
      sqlinjection: BOUNDARY_LIBRARY.strings.sqlInject,
      xsspayload: BOUNDARY_LIBRARY.strings.xssPayload,
    };

    return boundaryMap[lower] || null;
  }

  /**
   * Resolves an API request body, substituting placeholders.
   * @private
   */
  _resolveAPIPayload(apiDetails, ctx) {
    try {
      const raw = JSON.stringify(apiDetails.requestBody);
      const filled = raw.replace(/"\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}"/g, (match, key) => {
        const resolver = PLACEHOLDER_RESOLVERS[key];
        if (resolver) {
          const val = typeof resolver === 'function' ? resolver(ctx) : resolver;
          return JSON.stringify(val);
        }
        return match;
      });
      return JSON.parse(filled);
    } catch {
      return apiDetails.requestBody;
    }
  }

  /**
   * Builds boundary data object for edge TCs.
   * @private
   */
  _buildBoundaryData(tc) {
    const name = tc.name.toLowerCase();

    if (name.includes('min')) return { type: 'MIN_BOUNDARY', value: BOUNDARY_LIBRARY.strings.minValue, numeric: BOUNDARY_LIBRARY.numbers.min };
    if (name.includes('max')) return { type: 'MAX_BOUNDARY', value: BOUNDARY_LIBRARY.strings.maxValue, numeric: BOUNDARY_LIBRARY.numbers.max };
    if (name.includes('long')) return { type: 'LONG_STRING', value: BOUNDARY_LIBRARY.strings.longString };
    if (name.includes('special')) return { type: 'SPECIAL_CHARS', value: BOUNDARY_LIBRARY.strings.specialChars };
    if (name.includes('unicode')) return { type: 'UNICODE', value: BOUNDARY_LIBRARY.strings.unicode };
    if (name.includes('whitespace')) return { type: 'WHITESPACE', value: BOUNDARY_LIBRARY.strings.whitespace };
    if (name.includes('zero')) return { type: 'ZERO', value: 0, string: '' };
    if (name.includes('sql')) return { type: 'SQL_INJECT', value: BOUNDARY_LIBRARY.strings.sqlInject };
    if (name.includes('xss')) return { type: 'XSS', value: BOUNDARY_LIBRARY.strings.xssPayload };
    if (name.includes('concurrent')) return { type: 'CONCURRENT', parallelRequests: 2 };

    return { type: 'GENERIC_EDGE', value: BOUNDARY_LIBRARY.strings.specialChars };
  }

  // ── API Payload Library ───────────────────────────────────────────────────

  /**
   * Builds a reusable API payload library from all API TCs.
   * @private
   */
  _buildAPIPayloadLibrary(testCases, ctx) {
    const library = {};

    testCases
      .filter((tc) => tc.type === 'API' && tc.apiDetails)
      .forEach((tc) => {
        const key = `${tc.apiDetails.method} ${tc.apiDetails.endpoint}`;
        if (!library[key]) {
          library[key] = {
            valid: this._resolveAPIPayload(tc.apiDetails, ctx),
            invalid: { field: null, missing: true },
            malformed: '{ broken json }',
          };
        }
      });

    return library;
  }

  // ── Environment Overrides ─────────────────────────────────────────────────

  /**
   * @private
   */
  _buildEnvironmentOverrides(globalCtx) {
    return {
      staging: {
        baseURL: process.env.AUT_BASE_URL || globalCtx.baseURL,
        logLevel: 'debug',
        slowMo: 100,
      },
      uat: {
        baseURL: (process.env.AUT_BASE_URL || '').replace('staging', 'uat'),
        logLevel: 'info',
        slowMo: 0,
      },
      production: {
        baseURL: (process.env.AUT_BASE_URL || '').replace('staging', 'production'),
        logLevel: 'warn',
        slowMo: 0,
        note: 'Production tests must use read-only or dedicated test accounts',
      },
    };
  }

  // ── Data Injection into Test Cases ────────────────────────────────────────

  /**
   * Injects resolved data values back into test case steps.
   * @private
   */
  _injectDataIntoTestCases(testCases, perTCData) {
    return testCases.map((tc) => {
      const tcData = perTCData[tc.key];
      if (!tcData) return tc;

      const steps = (tc.testSteps || []).map((step) => {
        let testData = step.testData || '';

        // Replace all placeholders in the testData field with resolved values
        testData = testData.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (match) => {
          const entry = tcData.inputs[match];
          if (!entry) return match;
          if (entry.sensitive || entry.source === 'runtime') return match; // Keep runtime refs as-is
          return String(entry.value);
        });

        return { ...step, testData };
      });

      return {
        ...tc,
        testSteps: steps,
        resolvedData: tcData,
        dataManifestId: `tdm_ref_${tc.key}`,
      };
    });
  }

  // ── Manifest Builder ──────────────────────────────────────────────────────

  /**
   * @private
   */
  _buildManifest({
    projectId, globalCtx, perTCData, apiPayloadLibrary,
    environmentOverrides, unresolved, sensitiveRefs, totalTCs,
    totalReviewed, approvedCount, excludedCount, excludedTestCases,
    sourceReviewId, requirementValues,
  }: any) {
    const resolvedCount = Object.values(perTCData)
      .reduce((sum: number, tc: any) => sum + Object.values(tc.inputs)
        .filter((i: any) => i.source !== 'unresolved').length, 0);

    const unresolvedCount = unresolved.length;

    return {
      manifestId: `tdm_${Date.now()}`,
      projectId,
      /** Agent 03 review this data was generated from — used to detect stale manifests */
      sourceReviewId: sourceReviewId || null,
      generatedAt: new Date().toISOString(),
      seed: globalCtx.seed,
      environment: FRAMEWORK_CONFIG.environment,
      totalTCs: approvedCount ?? totalTCs,
      totalReviewed: totalReviewed ?? totalTCs,
      approvedCount: approvedCount ?? totalTCs,
      excludedCount: excludedCount ?? 0,
      excludedTestCases: excludedTestCases || [],
      resolvedCount,
      unresolvedCount,

      /** Values taken from the requirement; written to the flat fixture by FixtureSync */
      requirementValues: requirementValues || {},
      globalFixtures: globalCtx.globalFixtures,
      perTCData,
      boundaryLibrary: BOUNDARY_LIBRARY,
      apiPayloadLibrary,
      environmentOverrides,

      sensitiveDataVault: {
        note: 'Sensitive values are stored as references. Actual values loaded from CI secrets at runtime.',
        refs: sensitiveRefs,
      },

      unresolvedPlaceholders: unresolved,
    };
  }

  // ── Memory Operations ─────────────────────────────────────────────────────

  /**
   * Loads previously resolved placeholder patterns from memory.
   * @private
   */
  _loadMemoryPatterns(memoryContext) {
    return memoryContext.testDataPatterns || {};
  }

  /**
   * Stores generated placeholder resolutions to memory for future reuse.
   * @private
   */
  async _persistPatternsToMemory(perTCData) {
    const patterns = {};

    for (const tcData of Object.values(perTCData)) {
      for (const [ph, entry] of Object.entries(tcData.inputs)) {
        if (entry.source === 'generated' && !entry.sensitive) {
          const key = ph.replace(/^\{\{|\}\}$/g, '');
          patterns[key] = entry.value;
        }
      }
    }

    // Store patterns in memory via a cycle record supplement
    this._logger.info('Persisting test data patterns to memory', {
      patternCount: Object.keys(patterns).length,
    });

    // Patterns stored as improvement context for next run
    await memoryEngine.addImprovementRule({
      id: 'RULE-04-DATA-PATTERNS',
      description: 'Test data patterns from this run for reuse',
      appliesTo: STAGE_ID,
      action: 'REUSE_DATA_PATTERNS',
      data: patterns,
      addedAt: new Date().toISOString(),
    });
  }

  // ── Utility Helpers ───────────────────────────────────────────────────────

  /**
   * Creates a deterministic 8-char hex seed from a string.
   * @private
   */
  _makeSeed(input) {
    return crypto.createHash('md5').update(input).digest('hex').slice(0, 8);
  }

  /** @private */
  _inferDataType(key, value) {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (value === RUNTIME_SENTINEL) return 'runtime-ref';
    if (/email/i.test(key)) return 'email';
    if (/url|baseurl/i.test(key)) return 'url';
    if (/phone/i.test(key)) return 'phone';
    if (/date/i.test(key)) return 'date';
    if (/amount|price|cost/i.test(key)) return 'currency';
    if (typeof value === 'string' && value.startsWith('{')) return 'json';
    return 'string';
  }

  /** @private */
  _findPlaceholderStep(tc, ph) {
    return (tc.testSteps || []).findIndex(
      (s) => [s.description, s.testData, s.expectedResult].some((f) => f?.includes(ph)),
    ) + 1;
  }

  /** @private */
  _buildSummary(manifest: any) {
    return {
      totalTCs: manifest.totalTCs,
      totalReviewed: manifest.totalReviewed || manifest.totalTCs,
      approvedTCs: manifest.approvedCount || manifest.totalTCs,
      excludedTCs: manifest.excludedCount || 0,
      resolvedCount: manifest.resolvedCount,
      unresolvedCount: manifest.unresolvedCount,
      sensitiveRefs: manifest.sensitiveDataVault.refs.length,
      apiPayloads: Object.keys(manifest.apiPayloadLibrary).length,
      environment: manifest.environment,
    };
  }

  /** @private */
  _buildApprovalSummary(manifest: any) {
    return {
      'Approved TCs': manifest.approvedCount || manifest.totalTCs,
      'Excluded TCs': manifest.excludedCount || 0,
      'Resolved Placeholders': manifest.resolvedCount,
      Unresolved: manifest.unresolvedCount,
      'Runtime-Only Refs': manifest.sensitiveDataVault.refs.length,
      'API Payload Library': `${Object.keys(manifest.apiPayloadLibrary).length} endpoints`,
      Environment: manifest.environment,
      'Boundary Library': 'Included (strings + numbers)',
    };
  }

  /** @private */
  _buildAgentResult(output, warnings, durationMs) {
    return {
      agentId: STAGE_ID,
      stageNumber: '04',
      stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED,
      output,
      clarifications: [],
      warnings,
      memoryUpdate: {
        testDataPatterns: output.manifest.resolvedCount,
      },
      timestamp: new Date().toISOString(),
      durationMs,
      approvalStatus: 'PENDING',
      approvalComment: '',
    };
  }

  /** @private */
  _saveToDisk(manifest, enrichedTestCases) {
    const outDir = path.resolve(__dirname, '../../reports/json');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const ts = Date.now();
    fs.writeFileSync(
      path.join(outDir, `test-data-manifest-${ts}.json`),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(outDir, `enriched-test-cases-${ts}.json`),
      JSON.stringify(enrichedTestCases, null, 2),
      'utf-8',
    );

    // Flat key-value fixture for Playwright via the shared builder (requirement values come from manifest.requirementValues)
    const fixturesDir = path.resolve(__dirname, '../../tests/fixtures');
    if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });

    const flatTestData = buildFlatTestData(manifest);
    fs.writeFileSync(
      path.join(fixturesDir, 'test-data.json'),
      JSON.stringify(flatTestData, null, 2),
      'utf-8',
    );

    this._logger.info('Test data saved to disk (flat fixtures synced)', { outDir, fixturesDir, keysCount: Object.keys(flatTestData).length });
  }

  /**
   * Extracts explicit test data from requirement specifications.
   * Priority Rule 0: requirement data takes absolute priority over synthetic generation.
   * @private
   */
  _extractRequirementData(analysis: any): Record<string, string> {
    const data: Record<string, string> = {
      baseURL: FRAMEWORK_CONFIG.playwright.baseURL || 'https://www.saucedemo.com/',
      password: 'secret_sauce',
      standardUsername: 'standard_user',
      lockedOutUsername: 'locked_out_user',
      problemUsername: 'problem_user',
      performanceGlitchUsername: 'performance_glitch_user',
      errorUsername: 'error_user',
      visualUsername: 'visual_user',
      errorInvalidCredentials: 'Epic sadface: Username and password do not match any user in this service',
      errorLockedOut: 'Epic sadface: Sorry, this user has been locked out.',
      errorUsernameRequired: 'Epic sadface: Username is required',
      errorPasswordRequired: 'Epic sadface: Password is required',
      usernameMaxLength: '255',
      passwordMaxLength: '512',
    };

    // Extract from analysis if available
    if (analysis && Array.isArray(analysis.features)) {
      for (const f of analysis.features) {
        for (const s of (f.userStories || [])) {
          if (Array.isArray(s.testUserAccounts)) {
            for (const acc of s.testUserAccounts) {
              if (acc.username === 'standard_user') data.standardUsername = acc.username;
              if (acc.username === 'locked_out_user') data.lockedOutUsername = acc.username;
              if (acc.password) data.password = acc.password;
            }
          }
        }
      }
    }

    // Also scan requirement file across all possible locations
    const reqCandidates = [
      path.resolve(process.cwd(), 'requirement.md'),
      path.resolve(process.cwd(), 'requirements/requirement.md'),
      path.resolve(process.cwd(), '../requirement.md'),
      path.resolve(__dirname, '../../requirement.md'),
      path.resolve(__dirname, '../../requirements/requirement.md'),
    ];

    for (const reqPath of reqCandidates) {
      if (fs.existsSync(reqPath) && fs.statSync(reqPath).isFile()) {
        try {
          const content = fs.readFileSync(reqPath, 'utf-8');
          if (content.includes('standard_user')) data.standardUsername = 'standard_user';
          if (content.includes('locked_out_user')) data.lockedOutUsername = 'locked_out_user';
          if (content.includes('problem_user')) data.problemUsername = 'problem_user';
          if (content.includes('performance_glitch_user')) data.performanceGlitchUsername = 'performance_glitch_user';
          if (content.includes('error_user')) data.errorUsername = 'error_user';
          if (content.includes('visual_user')) data.visualUsername = 'visual_user';
          if (content.includes('secret_sauce')) data.password = 'secret_sauce';

          const urlMatch = content.match(/https?:\/\/[^\s\)\"\'`]+/i);
          if (urlMatch) data.baseURL = urlMatch[0];

          this._logger.info('Requirement data extracted from file in data generator', { path: reqPath });
          break;
        } catch {
          // ignore read error
        }
      }
    }

    return data;
  }

  /** @private */
  _loadSkill() {
    try { return fs.readFileSync(SKILL_PATH, 'utf-8'); } catch { return ''; }
  }
}

// ─── JWT Utility (expired token stub) ────────────────────────────────────────

/**
 * Builds a structurally valid but expired JWT (for negative auth tests).
 * @returns {string} Expired JWT string
 */
function _buildExpiredJWT() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'aria_test_user',
    iat: Math.floor(Date.now() / 1000) - 7200, // issued 2h ago
    exp: Math.floor(Date.now() / 1000) - 3600, // expired 1h ago
  })).toString('base64url');
  const sig = 'ARIA_TEST_INVALID_SIGNATURE';
  return `${header}.${payload}.${sig}`;
}

// ─── Export & CLI ─────────────────────────────────────────────────────────────

export { TestDataGeneratorAgent };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const opts: any = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') continue;
      if (arg.startsWith('--')) {
        const [key, val] = arg.slice(2).split('=');
        if (val !== undefined) {
          opts[key] = val;
        } else if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
          opts[key] = args[i + 1];
          i++;
        } else {
          opts[key] = true;
        }
      }
    }

    let activeProjectId = opts.project;
    if (!activeProjectId) {
      try {
        const stateDb = stateManager.getDatabase();
        const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
        if (latestRun?.project_id) {
          activeProjectId = latestRun.project_id;
        }
      } catch (_) {}
    }
    activeProjectId = activeProjectId || FRAMEWORK_CONFIG.projectId;

    await stateManager.initialize(activeProjectId);
    await memoryEngine.initialize(activeProjectId);

    const agent = new TestDataGeneratorAgent();
    const reviewedTestCases = await stateManager.getPipelineArtifact('reviewedTestCases');
    const analyzedRequirements = await stateManager.getPipelineArtifact('analyzedRequirements');

    if (!reviewedTestCases) {
      console.error(`❌ No reviewed test cases found for project "${activeProjectId}". Run Agent 03 first.`);
      process.exit(1);
    }

    const result = await agent.run({ reviewedTestCases, analyzedRequirements });
    console.log(`\n✅ Agent 04 complete — Resolved: ${result.output.manifest.resolvedCount}, Unresolved: ${result.output.manifest.unresolvedCount}`);
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })();
}
