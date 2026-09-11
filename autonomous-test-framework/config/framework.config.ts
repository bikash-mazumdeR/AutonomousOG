/**
 * @fileoverview Master Framework Configuration for the ARIA Framework.
 * All tunable parameters, pipeline definitions, and environment mappings.
 *
 * @module framework.config
 * @version 1.0.0
 */

require('dotenv').config();

// ─── Pipeline Stage Registry ──────────────────────────────────────────────────

/**
 * Ordered list of all pipeline stages.
 * @type {Array<PipelineStage>}
 */
const PIPELINE_STAGES = [
  {
    id: '01-requirement-analyzer',
    name: 'Requirement Deep Analyzer',
    agentPath: './agents/01-requirement-analyzer/agent.js',
    skillPath: './skills/requirement-analysis.md',
    nextStage: '02-test-case-generator',
    description: 'Analyzes requirements and extracts business logic, flows, and edge cases.',
    inputs: ['requirements'],
    outputs: ['analyzedRequirements'],
    critical: true,
  },
  {
    id: '02-test-case-generator',
    name: 'Test Case Generator',
    agentPath: './agents/02-test-case-generator/agent.js',
    skillPath: './skills/test-case-generation.md',
    nextStage: '03-test-case-reviewer',
    description: 'Generates Positive, Negative, Edge, API & Performance test cases.',
    inputs: ['analyzedRequirements'],
    outputs: ['testCases'],
    critical: true,
  },
  {
    id: '03-test-case-reviewer',
    name: 'Test Case Reviewer',
    agentPath: './agents/03-test-case-reviewer/agent.js',
    skillPath: './skills/test-case-review.md',
    nextStage: '04-test-data-generator',
    description: 'Reviews test cases for completeness, coverage, and accuracy.',
    inputs: ['testCases', 'analyzedRequirements'],
    outputs: ['reviewedTestCases'],
    critical: true,
  },
  {
    id: '04-test-data-generator',
    name: 'Test Data Generator',
    agentPath: './agents/04-test-data-generator/agent.js',
    skillPath: './skills/test-data-generation.md',
    nextStage: '05-playwright-script-generator',
    description: 'Generates realistic, boundary-aware test data for all test cases.',
    inputs: ['reviewedTestCases', 'analyzedRequirements'],
    outputs: ['testData'],
    critical: false,
  },
  {
    id: '05-playwright-script-generator',
    name: 'Playwright Script Generator',
    agentPath: './agents/05-playwright-script-generator/agent.js',
    skillPath: './skills/playwright-scripting.md',
    nextStage: '06-automation-reviewer',
    description: 'Generates production-grade Playwright test scripts from test cases.',
    inputs: ['reviewedTestCases', 'testData'],
    outputs: ['playwrightScripts'],
    critical: true,
  },
  {
    id: '06-automation-reviewer',
    name: 'Automation Code Reviewer',
    agentPath: './agents/06-automation-reviewer/agent.js',
    skillPath: './skills/code-review.md',
    nextStage: '07-test-runner',
    description: 'Reviews generated Playwright scripts for quality, coverage & best practices.',
    inputs: ['playwrightScripts'],
    outputs: ['reviewedScripts'],
    critical: true,
  },
  {
    id: '07-test-runner',
    name: 'Test Runner',
    agentPath: './agents/07-test-runner/agent.js',
    skillPath: null,
    nextStage: '08-bug-reporter',
    description: 'Executes Playwright tests in multi-threaded mode and collects results.',
    inputs: ['reviewedScripts', 'testData'],
    outputs: ['executionResults'],
    critical: true,
  },
  {
    id: '08-bug-reporter',
    name: 'Bug Reporter',
    agentPath: './agents/08-bug-reporter/agent.js',
    skillPath: './skills/bug-reporting.md',
    nextStage: '09-report-generator',
    description: 'Creates Jira issues and emails for all failures with full attachments.',
    inputs: ['executionResults'],
    outputs: ['bugReports'],
    critical: false,
  },
  {
    id: '09-report-generator',
    name: 'Report Generator & Publisher',
    agentPath: './agents/09-report-generator/agent.js',
    skillPath: './skills/report-generation.md',
    nextStage: '10-auto-healer',
    description: 'Generates HTML/JSON reports and sends email via Gmail SMTP.',
    inputs: ['executionResults', 'bugReports'],
    outputs: ['publishedReports'],
    critical: false,
  },
  {
    id: '10-auto-healer',
    name: 'Auto Healer',
    agentPath: './agents/10-auto-healer/agent.js',
    skillPath: './skills/auto-healing.md',
    nextStage: '11-retest-agent',
    description: 'Analyzes failures, heals broken selectors, and patches failing tests.',
    inputs: ['executionResults'],
    outputs: ['healingPatches'],
    critical: false,
  },
  {
    id: '11-retest-agent',
    name: 'Re-Test Failed Cases',
    agentPath: './agents/11-retest-agent/agent.js',
    skillPath: null,
    nextStage: null,
    description: 'Re-runs healed tests and generates final pass/fail delta report.',
    inputs: ['healingPatches', 'executionResults'],
    outputs: ['retestResults'],
    critical: false,
  },
];

// ─── Playwright Configuration ─────────────────────────────────────────────────

const PLAYWRIGHT_CONFIG = {
  baseURL: process.env.AUT_BASE_URL || 'http://localhost:3000',
  headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
  workers: parseInt(process.env.PLAYWRIGHT_WORKERS || '2', 10),
  timeout: parseInt(process.env.PLAYWRIGHT_TIMEOUT || '30000', 10),
  retries: parseInt(process.env.PLAYWRIGHT_RETRIES || '2', 10),
  screenshotMode: 'only-on-failure',
  videoMode: 'retain-on-failure',
  traceMode: 'on-first-retry',
  browsers: ['chromium'],
  outputDir: './reports/attachments',
  screenshotDir: './reports/attachments/screenshots',
  networkLogDir: './reports/attachments/network-logs',
  consoleLogDir: './reports/attachments/console-logs',
};

// ─── K6 Performance Configuration ────────────────────────────────────────────

const K6_CONFIG = {
  vus: parseInt(process.env.K6_VUS || '10', 10),
  duration: process.env.K6_DURATION || '30s',
  thresholds: {
    http_req_duration: [`p(95)<${process.env.K6_THRESHOLD_P95 || 500}`],
    http_req_failed: ['rate<0.01'],
  },
  outputFormats: ['json', 'html'],
};

// ─── Jira Configuration ───────────────────────────────────────────────────────

const JIRA_CONFIG = {
  baseUrl: process.env.JIRA_BASE_URL || '',
  email: process.env.JIRA_EMAIL || '',
  apiToken: process.env.JIRA_API_TOKEN || '',
  projectKey: process.env.JIRA_PROJECT_KEY || 'QA',
  boardId: process.env.JIRA_BOARD_ID || '',
  issueTypes: {
    bug: 'Bug',
    task: 'Task',
    story: 'Story',
  },
  customFields: {
    severity: 'customfield_10100',
    testEnv: 'customfield_10101',
  },
  labels: {
    ui: 'UI',
    functional: 'Functional',
    api: 'API',
    performance: 'Performance',
    autoGenerated: 'ARIA-AutoGenerated',
  },
};

// ─── Gmail Configuration ──────────────────────────────────────────────────────

const GMAIL_CONFIG = {
  user: (process.env.GMAIL_USER || '').trim(),
  appPassword: (process.env.GMAIL_APP_PASSWORD || '').trim().replace(/\s/g, ''),
  from: (process.env.GMAIL_FROM || '').trim(),
  to: (process.env.GMAIL_TO || '').split(',').map((e) => e.trim()),
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  secure: false,
};

// ─── Framework Configuration ──────────────────────────────────────────────────

const FRAMEWORK_CONFIG = {
  projectId: process.env.FRAMEWORK_PROJECT_ID || 'default',
  logLevel: process.env.FRAMEWORK_LOG_LEVEL || 'info',
  approvalMode: process.env.FRAMEWORK_APPROVAL_MODE || 'manual',
  approvalWebhookPort: parseInt(process.env.APPROVAL_WEBHOOK_PORT || '8080', 10),
  maxThreads: parseInt(process.env.FRAMEWORK_MAX_THREADS || '4', 10),
  environment: process.env.AUT_ENVIRONMENT || 'staging',
  uncertaintyThreshold: 0.80, // Agents ask if confidence < 80%
  maxRetries: 2,
  selfReviewRetries: parseInt(process.env.SELF_REVIEW_RETRIES || '2', 10),
  specBatchSize: parseInt(process.env.SPEC_BATCH_SIZE || '10', 10),    // Max TCs per LLM call for spec generation
  statePath: './.state/pipeline-state.json',
  memoryPath: './core/project-memory/memory.json',
  vectorDbPath: './.state/lancedb',

  llm: {
    embedding: 'text-embedding-3-small',
    pricing: {
      'gpt-4o': { input: 0.005, output: 0.015 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'claude-3-5-sonnet-20240620': { input: 0.003, output: 0.015 },
      'gemini-2.5-pro': { input: 0.0035, output: 0.0105 },
      'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
      'gemini-flash-latest': { input: 0.000075, output: 0.0003 },
      'gemini-3.5-flash': { input: 0.000075, output: 0.0003 },
      'gemini-3.5-flash-lite': { input: 0.000075, output: 0.0003 },
      'gemini-3.6-flash': { input: 0.000075, output: 0.0003 },
      'gemini-3.7-flash': { input: 0.000075, output: 0.0003 },
      'gemini-3.8-flash': { input: 0.000075, output: 0.0003 },
      'gemini-3.1-flash-lite-preview': { input: 0.000075, output: 0.0003 },
      'gemini-3.1-flash-lite': { input: 0.000075, output: 0.0003 },
      'gemini-flash-lite-latest': { input: 0.000075, output: 0.0003 },
      'text-embedding-3-small': { input: 0.00002, output: 0.0 },
    },
    models: {
      default: {
        provider: 'gemini',
        model: process.env.LLM_MODEL_DEFAULT || 'gemini-3.5-flash',
        fallbacks: [
          { provider: 'gemini', model: 'gemini-3.6-flash' },
          { provider: 'gemini', model: 'gemini-3.7-flash' },
          { provider: 'gemini', model: 'gemini-flash-latest' },
          { provider: 'gemini', model: 'gemini-3.1-flash-lite-preview' },
          { provider: 'gemini', model: 'gemini-flash-lite-latest' },
        ],
      },
      coding: {
        provider: 'gemini',
        model: process.env.LLM_MODEL_CODING || 'gemini-3.5-flash',
        fallbacks: [
          { provider: 'gemini', model: 'gemini-3.6-flash' },
          { provider: 'gemini', model: 'gemini-3.7-flash' },
          { provider: 'gemini', model: 'gemini-flash-latest' },
          { provider: 'gemini', model: 'gemini-3.1-flash-lite-preview' },
          { provider: 'gemini', model: 'gemini-flash-lite-latest' },
        ],
      },
      data: {
        provider: 'gemini',
        model: process.env.LLM_MODEL_DATA || 'gemini-3.5-flash',
        fallbacks: [
          { provider: 'gemini', model: 'gemini-3.6-flash' },
          { provider: 'gemini', model: 'gemini-3.7-flash' },
          { provider: 'gemini', model: 'gemini-flash-latest' },
          { provider: 'gemini', model: 'gemini-3.1-flash-lite-preview' },
          { provider: 'gemini', model: 'gemini-flash-lite-latest' },
        ],
      },
      vision: {
        provider: 'openai',
        model: 'gpt-4o',
        fallbacks: [],
      },
      large: {
        provider: 'gemini',
        model: process.env.LLM_MODEL_DEFAULT || 'gemini-3.5-flash',
        fallbacks: [
          { provider: 'gemini', model: 'gemini-3.6-flash' },
          { provider: 'gemini', model: 'gemini-3.7-flash' },
          { provider: 'gemini', model: 'gemini-flash-latest' },
          { provider: 'gemini', model: 'gemini-3.1-flash-lite-preview' },
          { provider: 'gemini', model: 'gemini-flash-lite-latest' },
        ],
      },
    },
    // Mapping of stage ID to model profile
    stageMapping: {
      '01-requirement-analyzer': 'large', // Use Gemini for massive context
      '02-test-case-generator': 'default',
      '03-test-case-reviewer': 'default',
      '04-test-data-generator': 'data',
      '05-playwright-script-generator': 'coding', // Use Claude for best code gen
      '06-automation-reviewer': 'coding',
      '08-bug-reporter': 'default',
      '09-report-generator': 'data',
      '10-auto-healer': 'coding',
    },
  },

  pipeline: PIPELINE_STAGES,
  playwright: PLAYWRIGHT_CONFIG,
  k6: K6_CONFIG,
  jira: JIRA_CONFIG,
  gmail: GMAIL_CONFIG,
};

export {
  FRAMEWORK_CONFIG, PIPELINE_STAGES, PLAYWRIGHT_CONFIG, K6_CONFIG, JIRA_CONFIG, GMAIL_CONFIG,
};
