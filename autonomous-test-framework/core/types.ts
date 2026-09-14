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
  estimatedCost: number;
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
  [key: string]: any;
}

/** Pipeline artifact persisted by Agent 02 under the "testCases" key. */
export interface TestCasesArtifact {
  zephyrExport: {
    totalTestCases: number;
    testCases: TestCase[];
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

export interface PipelineArtifacts {
  requirements: string | Record<string, any> | null;
  analyzedRequirements?: AnalyzedRequirement | null;
  testCases: TestCasesArtifact | null;
  reviewedTestCases: Record<string, any> | null;
  testData: Record<string, any> | null;
  playwrightScripts: Record<string, string> | null;
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
