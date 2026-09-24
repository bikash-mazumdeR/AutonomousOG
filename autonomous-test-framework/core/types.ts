/**
 * @fileoverview Global Type Definitions for the ARIA Framework.
 * Provides strongly-typed domain interfaces for the entire pipeline.
 *
 * @module Types
 * @version 2.0.0
 */

// ─── Stage & Approval Status ──────────────────────────────────────────────────

export type StageStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'AWAITING' | 'APPROVED' | 'REJECTED' | 'FAILED' | 'SKIPPED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

// ─── LLM & Token Tracking ────────────────────────────────────────────────────

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** @deprecated Use estimatedCostUSD. Kept for backward compatibility — same value as estimatedCostUSD. */
  estimatedCost: number;
  estimatedCostUSD: number;
  estimatedCostINR: number;
  /** USD→INR rate applied to produce estimatedCostINR. */
  exchangeRate: number;
}

// ─── Pipeline Domain Types ────────────────────────────────────────────────────

export interface StageError {
  message: string;
  stack?: string;
  code: string;
}

export interface Clarification {
  id: string;
  stageId: string;
  question: string;
  status: 'PENDING' | 'ANSWERED';
  askedAt: string;
  answer: string | null;
  answeredAt?: string;
}

export interface ErrorEntry {
  stageId?: string;
  message: string;
  timestamp: string;
}

export interface WarningEntry {
  stageId?: string;
  message: string;
  timestamp: string;
}

// ─── Test Case & Execution ────────────────────────────────────────────────────

/** Gherkin keyword stored on a test step (Agent 02 emits only Given/When; UI edits may use Then/And). */
export type GherkinKeyword = 'Given' | 'When' | 'Then' | 'And' | 'But';

/** One Zephyr-style step: a Gherkin action paired with its observable expected result(s). */
export interface TestStep {
  keyword?: GherkinKeyword;
  description: string;
  testData: string;
  /** One or more assertions separated by "\n" (first renders as Then, the rest as And). */
  expectedResult: string;
  [key: string]: any;
}

/** API request details — present only on type "API" test cases. */
export interface ApiDetails {
  method: string;
  endpoint: string;
  requestBody: Record<string, any> | any[] | null;
  expectedStatusCode: number;
}

/** K6 scenario reference — present only on type "Performance" test cases. */
export interface PerformanceRef {
  scenario: string;
  targetEndpoint: string;
}

/** Test case as produced by Agent 02 and enriched by Agents 03/04. */
export interface TestCase {
  key: string;
  name: string;
  objective: string;
  precondition: string;
  type: string;
  priority: string;
  labels: string[];
  featureId: string;
  userStoryId: string;
  /** Story-local requirement ids this test verifies, e.g. ["AC-2", "BR-1"]. */
  requirementRefs: string[];
  testSteps: TestStep[];
  apiDetails?: ApiDetails;
  performanceRef?: PerformanceRef;
  hash: string;
  /** false when the user excluded the test case during Agent 02 approval. */
  selected: boolean;
  /**
   * Open Agent 01 questions about a criterion this test case covers. Agent 03 holds the test case while its
   * clarification is open, since the behaviour it tests is still undecided.
   */
  openQuestions?: Array<{ ambiguityId: string; question: string; clarificationId?: string }>;
  [key: string]: any;
}

/** Inputs and runtime facts behind one Agent 02 generation, used to explain count changes between runs. */
export interface GenerationMeta {
  /** Agent 01 input fingerprint ('' for analyses produced before fingerprinting). */
  requirementsFingerprint: string;
  analysisFingerprint: string;
  /** Skill + learnings + memory rules/feedback injected into the prompt. */
  promptFingerprint: string;
  excludedTypes: string[];
  storyCount: number;
  modelsUsed: string[];
  attemptsByStory: Record<string, number>;
}

/** Pipeline artifact persisted by Agent 02 under the "testCases" key. */
export interface TestCasesArtifact {
  zephyrExport: {
    totalTestCases: number;
    testCases: TestCase[];
    generationMeta?: GenerationMeta;
  };
}

/** Legacy exclusion marker written by pre-3.0 artifacts; still honoured when reading. */
export const LEGACY_OBSOLETE_STATUS = 'OBSOLETE';

/**
 * Whether a test case is in the user-selected scope.
 * Tolerates legacy artifacts that marked exclusion via status/isObsolete.
 * @param {Partial<TestCase> | null | undefined} tc
 * @returns {boolean}
 */
export function isTestCaseSelected(tc: Partial<TestCase> | null | undefined): boolean {
  return Boolean(tc) && tc!.selected !== false && tc!.status !== LEGACY_OBSOLETE_STATUS && !tc!.isObsolete;
}

/**
 * Sets the selection flag and clears legacy exclusion markers so the flag is authoritative.
 * @param {Partial<TestCase>} tc
 * @param {boolean} selected
 */
export function setTestCaseSelected(tc: Partial<TestCase>, selected: boolean): void {
  tc.selected = selected;
  delete tc.isObsolete;
  if (tc.status === LEGACY_OBSOLETE_STATUS) delete tc.status;
}

/** @enum {string} Agent 03 review outcome of a test case. */
export const REVIEW_STATUS = Object.freeze({
  PASSED: 'PASSED',
  FLAGGED: 'FLAGGED',
  /** Set by the Agent 03 UI when a reviewer rewrote steps. */
  REWRITTEN: 'REWRITTEN',
  REJECTED: 'REJECTED',
  /** Not automatable until open clarifications are answered. */
  HELD: 'HELD',
  MANUAL: 'MANUAL',
  EXCLUDED: 'EXCLUDED',
} as const);

const AUTOMATABLE_REVIEW_STATUSES: ReadonlySet<string> = new Set([REVIEW_STATUS.PASSED, REVIEW_STATUS.FLAGGED, REVIEW_STATUS.REWRITTEN]);

/**
 * Whether a reviewed test case may proceed to test data and automation: selected, and passed (or flagged) in review.
 * Held, manual, rejected and excluded test cases never proceed, even with automatic approval.
 * @param {Partial<TestCase> | null | undefined} tc
 * @returns {boolean}
 */
export function isAutomationApproved(tc: Partial<TestCase> | null | undefined): boolean {
  return isTestCaseSelected(tc) && AUTOMATABLE_REVIEW_STATUSES.has(String(tc!.reviewStatus || REVIEW_STATUS.PASSED));
}

/**
 * Why a reviewed test case does not proceed to automation.
 * @param {Partial<TestCase> | null | undefined} tc
 * @returns {string}
 */
export function reviewExclusionReason(tc: Partial<TestCase> | null | undefined): string {
  switch (tc?.reviewStatus) {
    case REVIEW_STATUS.REJECTED: return 'Rejected in Agent 03 review';
    case REVIEW_STATUS.HELD: return 'Held in Agent 03 — awaiting clarification';
    case REVIEW_STATUS.MANUAL: return 'Manual test case';
    default: return 'Excluded by user selection';
  }
}

export interface TestResult {
  tcKey: string;
  title: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  durationMs?: number;
  error?: StageError;
  retries?: number;
  screenshotPath?: string;
  [key: string]: any;
}

export interface ExecutionSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  durationMs: number;
  browser?: string;
  [key: string]: any;
}

export interface ExecutionResults {
  runId: string;
  summary: ExecutionSummary;
  passedTests: TestResult[];
  failedTests: TestResult[];
  flakyTests?: TestResult[];
  k6Results?: Record<string, any>[];
  [key: string]: any;
}

// ─── Bug Reporting ────────────────────────────────────────────────────────────

export interface BugReport {
  title: string;
  severity: string;
  labels: string[];
  description: string;
  environment: Record<string, any>;
  tcKey?: string;
  hash?: string;
  jiraKey?: string;
  skipped?: boolean;
  updated?: boolean;
  [key: string]: any;
}

export interface BugReportOutput {
  reportId: string;
  reportedAt: string;
  totalFailures: number;
  bugsCreated: number;
  bugsUpdated?: number;
  duplicatesSkipped?: number;
  bugReports: BugReport[];
  environment: string;
  summary: ExecutionSummary;
  [key: string]: any;
}

// ─── Reports & Healing ────────────────────────────────────────────────────────

export interface PublishedReport {
  reportId: string;
  generatedAt: string;
  htmlReportPath: string;
  emailSent: boolean;
  summary: ExecutionSummary;
  [key: string]: any;
}

export interface HealingPatch {
  tcKey: string;
  filePath: string;
  patchType: string;
  originalCode?: string;
  patchedCode?: string;
  healingStrategy: string;
  [key: string]: any;
}

export interface AnalyzedRequirement {
  category: string;
  requirements: Record<string, any>[];
  gherkinFeatures?: string[];
  [key: string]: any;
}

// ─── Agent Result ─────────────────────────────────────────────────────────────

export interface AgentResult {
  agentId: string;
  stageNumber: string;
  stageName: string;
  status: StageStatus;
  output: Record<string, any>;
  clarifications?: Clarification[];
  warnings: string[];
  memoryUpdate?: Record<string, any>;
  timestamp: string;
  durationMs: number;
  approvalStatus: ApprovalStatus;
  approvalComment?: string;
  usage?: TokenUsage;
  /** Set when the stage short-circuited because its input was already processed. */
  duplicate?: boolean;
  /** Content hash of the ingested requirement, for stages that key on requirement identity. */
  requirementFingerprint?: string;
}

// ─── Stage State ──────────────────────────────────────────────────────────────

export interface StageState {
  status: StageStatus;
  output: Record<string, any> | null;
  approval: ApprovalStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  approvedAt?: string;
  rejectionReason?: string;
  approvalComment?: string;
  rejectedAt?: string;
  failedAt?: string;
  error?: StageError | null;
  usage?: TokenUsage;
}

// ─── Pipeline Artifacts ───────────────────────────────────────────────────────

/** Agent 05 outcome for one approved (or excluded) test case. */
export interface AutomationTestCaseResult {
  tcKey: string;
  status: 'GENERATED' | 'NEEDS_CONTEXT' | 'BLOCKED' | 'EXCLUDED';
  /** Framework-root-relative file containing the generated test. */
  file?: string;
  testTitle?: string;
  stepAssertions?: Array<{ stepIndex: number; assertions: string[] }>;
  /** Statements the spec runs in beforeEach before this test's body. */
  sharedSetup?: string[];
  /** Assertions whose value came from a discovery-verified state rather than the test case text. */
  provenance?: Array<{ stepIndex: number; assertion: string; state: string; urlPath: string }>;
  /** Missing information, with the stage it was asked of and the clarification id once written back. */
  missing?: Array<{
    kind: string; detail: string; ruleId?: string; stepIndex?: number; subject?: string; owningStage?: string; clarificationId?: string;
  }>;
  reason?: string;
}

/** Pipeline artifact persisted by Agent 05 under the "playwrightScripts" key. */
export interface PlaywrightScriptsArtifact {
  projectSlug: string;
  /** reviewedTestCases.reviewId the scripts were generated from (staleness check). */
  sourceReviewId: string | null;
  specFiles: string[];
  pomFiles: string[];
  k6Files: string[];
  pageMapFiles: string[];
  testCases: AutomationTestCaseResult[];
  warnings: string[];
  /** Clarifications written back for NEEDS_CONTEXT gaps (environment issues counted once per project). */
  clarifications?: { raised: number; environment: number; resolved: number };
}

export interface PipelineArtifacts {
  requirements: string | Record<string, any> | null;
  analyzedRequirements?: AnalyzedRequirement | null;
  /** Agent 01's exact LLM input, call-by-call token usage and cost derivation (diagnostic). */
  agent01PromptTrace?: Record<string, any> | null;
  /** Agent 02's per-story prompts, validation attempts, call-by-call token usage and cost derivation (diagnostic). */
  agent02PromptTrace?: Record<string, any> | null;
  /** Agents 03-06: LLM calls made on the latest run (or why none were), token usage and cost derivation (diagnostic). */
  agent03PromptTrace?: Record<string, any> | null;
  agent04PromptTrace?: Record<string, any> | null;
  agent05PromptTrace?: Record<string, any> | null;
  agent06PromptTrace?: Record<string, any> | null;
  testCases: TestCasesArtifact | null;
  reviewedTestCases: Record<string, any> | null;
  testData: Record<string, any> | null;
  playwrightScripts: PlaywrightScriptsArtifact | null;
  reviewedScripts: Record<string, string> | null;
  executionResults: ExecutionResults | null;
  bugReports: BugReportOutput | null;
  publishedReports: PublishedReport | null;
  healingPatches: HealingPatch[] | null;
  retestResults: ExecutionResults | null;
}

// ─── Pipeline State ───────────────────────────────────────────────────────────

export interface PipelineState {
  version: string;
  projectId: string;
  runId: string;
  startedAt: string;
  updatedAt: string;
  currentStage: string | null;
  globalStatus: string;
  stages: Record<string, StageState>;
  pipeline: Partial<PipelineArtifacts>;
  clarifications: Clarification[];
  errors: ErrorEntry[];
  warnings: WarningEntry[];
}
