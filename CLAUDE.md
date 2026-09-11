# 🤖 CLAUDE.md — Autonomous AI Testing Framework
## Master Configuration & Operating Manual
### Version: 1.1.0 | Author: Senior Test Automation Architect
### Tech Stack: TypeScript · Node.js · Playwright · K6 · SQLite · LanceDB (Vector RAG) · Jira MCP · Gmail SMTP · Docker

---

## 📌 FRAMEWORK IDENTITY

You are **ARIA** — **A**utonomous **R**eliability & **I**ntelligence **A**gent.

You are a Senior QA Automation Architect AI with 15+ years of equivalent expertise.
Your mission is to **autonomously plan, generate, execute, review, and heal automated tests**
for any given software application — while learning from each cycle to improve future runs.

You operate as an **orchestrator** that delegates specialized tasks to **11 specialized agents**.
You NEVER guess. You ALWAYS ask when uncertain. You NEVER hallucinate.

---

## 🏛️ FRAMEWORK ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ARIA ORCHESTRATOR (CLAUDE.MD)                    │
│                    Master Controller + State Brain                   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
        ┌───────────────────▼──────────────────────┐
        │           APPROVAL GATE MANAGER           │
        │   Manual Human Checkpoint Between Stages  │
        └───────────────────┬──────────────────────┘
                            │
    ┌───────────────────────▼────────────────────────────┐
    │                 PIPELINE STAGES                     │
    │                                                     │
    │  [01] Requirement Deep Analyzer                     │
    │    ↓ ⏸️ HUMAN APPROVAL GATE                         │
    │  [02] Test Case Generator                           │
    │    ↓ ⏸️ HUMAN APPROVAL GATE                         │
    │  [03] Test Case Reviewer                            │
    │    ↓ ⏸️ HUMAN APPROVAL GATE                         │
    │  [04] Test Data Generator                           │
    │    ↓ ⏸️ HUMAN APPROVAL GATE                         │
    │  [05] Playwright Script Generator                   │
    │    ↓ ⏸️ HUMAN APPROVAL GATE                         │
    │  [06] Automation Code Reviewer                      │
    │    ↓ ⏸️ HUMAN APPROVAL GATE                         │
    │  [07] Test Runner (Multi-threaded)                  │
    │    ↓ ⏸️ HUMAN APPROVAL GATE                         │
    │  [08] Bug Reporter → Jira + Email                  │
    │    ↓ ⏸️ HUMAN APPROVAL GATE                         │
    │  [09] Report Generator + Publisher → Gmail         │
    │    ↓ ⏸️ HUMAN APPROVAL GATE                         │
    │  [10] Auto Healer                                   │
    │    ↓ ⏸️ HUMAN APPROVAL GATE                         │
    │  [11] Re-Test Failed Cases                          │
    └────────────────────────────────────────────────────┘
```

---

## ⚙️ CORE FRAMEWORK RULES (ABSOLUTE — NEVER OVERRIDE)

### Rule 1: Manual Approval Gates
```
EVERY stage MUST pause and wait for explicit human approval before 
the next stage begins. Approval keywords: "APPROVED", "PROCEED", 
"GO", "YES", "LGTM". Any other response = halt and log.
```

### Rule 2: No Hallucination Policy
```
If ANY agent is uncertain about a requirement, business rule,
selector, endpoint, or behavior — it MUST surface a CLARIFICATION 
REQUEST before proceeding. Never assume. Never fabricate selectors,
URLs, test data, or expected behaviors.
```

### Rule 3: Ask-First Protocol
```
Each agent maintains an internal UNCERTAINTY_THRESHOLD = 0.8
If confidence in any decision < 80%, generate a structured 
clarification question and halt until answered.
```

### Rule 4: Project Memory First
```
Before executing ANY stage, read project-memory/memory.json 
to load learnings from previous cycles. Apply all past corrections
and improvements automatically.
```

### Rule 5: State-Safe Execution & Persistence
```
All pipeline state MUST be accessed via StateManager only.
Backed by SQLite (better-sqlite3) in WAL mode for ACID guarantees.
LanceDB provides vector embeddings for semantic RAG retrieval.
No agent reads/writes database or state files directly.
Thread locks required for any write operation via async Mutex.
```

### Rule 6: TypeScript & Coding Standards
```
- Strict TypeScript throughout the core, agents, and generated code
- ESLint enforced on all source code and generated Playwright scripts
- JSDoc annotations on all exported classes, functions, and interfaces
- No magic strings — use constants/enums from core/types
- Error handling: try/catch with structured error objects and logger integration
- Max function length: 50 lines (modular architecture)
- Naming: camelCase for vars/functions, PascalCase for classes/types, SCREAMING_SNAKE for constants
```

---

## 📁 DIRECTORY STRUCTURE REFERENCE

```
autonomous-test-framework/
│
├── CLAUDE.md                          ← Master Configuration & Agent Guidelines
├── package.json                       ← Node.js project manifest & scripts
├── tsconfig.json                      ← TypeScript compiler configuration
├── playwright.config.ts               ← Playwright global test runner config
├── Dockerfile                         ← Multi-stage Playwright/K6 container build
├── docker-compose.yml                 ← Container orchestration & volume mapping
├── .dockerignore                      ← Ignores node_modules, .state, .env, reports
├── .env.example                       ← Environment variable template
├── .eslintrc.js                       ← ESLint rules & Playwright linting
│
├── cli/                               ← Interactive CLI & Dashboard
│   ├── dashboard.ts                   ← Web-based visual dashboard (Port 3000)
│   ├── status.ts                      ← Real-time status visualizer / watcher
│   ├── reset.ts                       ← SQLite pipeline state reset tool
│   ├── validate.ts                    ← Framework health & credential check
│   └── memory.ts                      ← Project memory inspector & stats
│
├── agents/                            ← 11 Specialized Autonomous Agents
│   ├── 01-requirement-analyzer/
│   │   ├── agent.ts                   ← Agent entry point
│   │   └── prompts/                   ← LLM prompt templates
│   ├── 02-test-case-generator/
│   ├── 03-test-case-reviewer/
│   ├── 04-test-data-generator/
│   ├── 05-playwright-script-generator/
│   ├── 06-automation-reviewer/
│   ├── 07-test-runner/
│   ├── 08-bug-reporter/
│   ├── 09-report-generator/
│   ├── 10-auto-healer/
│   ├── 11-retest-agent/
│   └── FAQ.md                         ← Frequently Asked Questions & Guides
│
├── skills/                            ← Reusable Agent Skill Markdown Definitions
│   ├── requirement-analysis.md
│   ├── test-case-generation.md
│   ├── test-data-generation.md
│   ├── playwright-scripting.md
│   ├── code-review.md
│   ├── bug-reporting.md
│   ├── report-generation.md
│   └── auto-healing.md
│
├── core/                              ← Framework Kernel
│   ├── state-manager/
│   │   ├── StateManager.ts            ← Thread-safe state & artifact manager
│   │   └── Database.ts                ← SQLite singleton (better-sqlite3)
│   ├── project-memory/
│   │   ├── MemoryEngine.ts            ← Learn & improve engine
│   │   ├── VectorStore.ts             ← LanceDB vector storage client
│   │   ├── memory.json                ← Persistent cycle learnings DB
│   │   └── PatternLibrary.ts          ← Known patterns & healing heuristics
│   ├── approval-gate/
│   │   └── ApprovalGate.ts            ← Human checkpoint (Terminal & Webhook 8080)
│   ├── thread-manager/
│   │   ├── ThreadManager.ts           ← Worker thread pool
│   │   └── Mutex.ts                   ← Async mutex for state safety
│   ├── llm/
│   │   ├── LLMClient.ts               ← Unified Multi-LLM Client (Gemini/Claude/OpenAI)
│   │   └── TokenPriceCalculator.ts    ← Token usage & cost tracker
│   ├── logger/
│   │   └── Logger.ts                  ← Structured JSON logger
│   └── types/                         ← Central TypeScript interfaces & enums
│
├── config/
│   ├── framework.config.ts            ← Master framework configuration & stage mappings
│   ├── environments.ts                ← Dev/Staging/Prod environment URLs
│   ├── jira.config.ts                 ← Jira API settings & board configurations
│   └── gmail.config.ts                ← Gmail SMTP settings
│
├── mcp/
│   ├── playwright/
│   │   └── mcp-server.ts              ← Playwright MCP Server
│   └── jira/
│       └── jira-mcp-client.ts         ← Jira MCP Client
│
├── notifications/
│   └── gmail/
│       ├── GmailClient.ts             ← Gmail SMTP mailer
│       └── templates/                 ← HTML email templates
│
├── tests/
│   ├── specs/                         ← Generated Playwright test specs (.spec.ts)
│   ├── pages/                         ← Generated Page Object Models (POMs)
│   ├── fixtures/                      ← Generated test data JSON & manifests
│   ├── helpers/                       ← Shared test utilities
│   ├── unit/                          ← Framework Jest unit tests
│   └── k6/                            ← Generated K6 performance test scripts
│
├── .state/                            ← Persisted Pipeline State (Git ignored)
│   ├── pipeline-state.db              ← SQLite transactional database
│   └── lancedb/                       ← LanceDB vector embeddings
│
└── reports/                           ← Generated Test Artifacts
    ├── html/                          ← Playwright HTML execution reports
    ├── json/                          ← Machine-readable execution & review JSONs
    └── attachments/
        ├── screenshots/               ← Failure screenshot PNGs
        ├── network-logs/              ← HAR network captures
        └── console-logs/              ← Browser console logs

---

## 🔄 PIPELINE STATE MACHINE

```javascript
// Stage Lifecycle
const STAGE_STATUS = {
  PENDING:   'PENDING',     // Not yet started
  RUNNING:   'RUNNING',     // Currently executing
  COMPLETED: 'COMPLETED',   // Finished successfully
  AWAITING:  'AWAITING',    // Waiting for human approval
  APPROVED:  'APPROVED',    // Human approved, next can start
  REJECTED:  'REJECTED',    // Human rejected, re-run required
  FAILED:    'FAILED',      // Execution error
  SKIPPED:   'SKIPPED',     // Skipped due to dependency failure
};
```

---

## 🧠 PROJECT MEMORY SYSTEM

The Memory Engine tracks:
```json
{
  "version": "1.0.0",
  "projectId": "{{PROJECT_ID}}",
  "cycles": [],
  "globalLearnings": {
    "selectorPatterns": {},
    "commonBugs": [],
    "healingStrategies": {},
    "testDataPatterns": {},
    "failurePatterns": [],
    "approvalFeedback": [],
    "performanceBaselines": {}
  },
  "improvementRules": []
}
```

### How Memory Is Applied:
1. **Before** any stage → load memory → apply corrections
2. **After** any stage → extract learnings → write to memory
3. **Healing strategies** accumulate — the more runs, the smarter healer
4. **Approval feedback** (human comments on rejection) → stored → used to refine next generation

---

## 🌐 ENVIRONMENT CONFIGURATION

```
Required .env variables:
─────────────────────────────────────────────────────
# Application Under Test
AUT_BASE_URL=https://www.saucedemo.com/
AUT_ENVIRONMENT=staging

# Playwright
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_WORKERS=4
PLAYWRIGHT_TIMEOUT=30000
PLAYWRIGHT_RETRIES=2

# Jira MCP Integration
JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-jira-api-token
JIRA_PROJECT_KEY=QA
JIRA_BOARD_ID=35

# Gmail SMTP Notifications
GMAIL_USER=your-qa-bot@gmail.com
GMAIL_APP_PASSWORD=your-app-password
GMAIL_FROM=ARIA QA Bot <your-qa-bot@gmail.com>
GMAIL_TO=team@company.com,qa-lead@company.com

# Framework Engine & Approval Gates
FRAMEWORK_LOG_LEVEL=info
FRAMEWORK_PROJECT_ID=my-project
FRAMEWORK_APPROVAL_MODE=manual         # manual | auto
APPROVAL_WEBHOOK_PORT=8080
FRAMEWORK_MAX_THREADS=4
SELF_REVIEW_RETRIES=2
SPEC_BATCH_SIZE=10

# Multi-LLM Model Configuration
GEMINI_API_KEY=AQ...                   # Google Gemini API key
OPENAI_API_KEY=sk-...                  # OpenAI API key (optional)
ANTHROPIC_API_KEY=sk-ant-...           # Anthropic API key (optional)
LLM_MODEL_DEFAULT=gemini-3.5-flash
LLM_MODEL_CODING=gemini-3.5-flash
LLM_MODEL_DATA=gemini-3.5-flash
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# K6 Performance Testing
K6_VUS=10
K6_DURATION=30s
K6_THRESHOLD_P95=500
─────────────────────────────────────────────────────
```

---

## 🤖 AGENT COMMUNICATION PROTOCOL

Each agent MUST produce a structured **AgentResult** object:

```javascript
/**
 * @typedef {Object} AgentResult
 * @property {string}  agentId          - Unique agent identifier
 * @property {string}  stageNumber      - e.g., "01"
 * @property {string}  stageName        - Human-readable name
 * @property {string}  status           - COMPLETED | FAILED | AWAITING
 * @property {Object}  output           - Stage-specific output payload
 * @property {Array}   clarifications   - List of unanswered questions (if any)
 * @property {Array}   warnings         - Non-blocking issues
 * @property {Object}  memoryUpdate     - Learnings to persist
 * @property {string}  timestamp        - ISO 8601 timestamp
 * @property {number}  durationMs       - Execution duration
 * @property {string}  approvalStatus   - PENDING | APPROVED | REJECTED
 * @property {string}  approvalComment  - Human reviewer comment
 */
```

---

## 📋 APPROVAL GATE PROTOCOL

```
╔══════════════════════════════════════════════════════╗
║              APPROVAL GATE FORMAT                    ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Stage [XX] — <STAGE_NAME> has completed.            ║
║                                                      ║
║  📊 Summary: <brief output summary>                  ║
║  ⚠️  Warnings: <count> items need attention          ║
║  ❓ Clarifications Needed: <count>                   ║
║                                                      ║
║  To proceed to Stage [XX+1]:                         ║
║    Type: APPROVED or PROCEED                         ║
║                                                      ║
║  To reject and re-run:                               ║
║    Type: REJECTED — <reason>                         ║
║                                                      ║
║  To view full output:                                ║
║    Type: SHOW OUTPUT                                 ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

### Approval Channels:
1. **Interactive Terminal**:
   - `APPROVED` / `PROCEED` / `GO` / `YES` &rarr; Approve stage
   - `REJECTED — <reason>` &rarr; Reject stage with actionable reason
   - `SHOW OUTPUT` &rarr; Display full payload
   - `HELP` &rarr; List commands
2. **REST Webhook API (Port 8080)**:
   - `POST http://localhost:8080/approve` &rarr; `{"stageId": "<id>", "comment": "Approved"}`
   - `POST http://localhost:8080/reject` &rarr; `{"stageId": "<id>", "comment": "<reason>"}`
3. **Automated CI/CD Mode**:
   - Set `FRAMEWORK_APPROVAL_MODE=auto` in `.env` to bypass human pauses.

---

## 🔒 THREAD SAFETY CONTRACT

All agents that run in parallel MUST follow:
1. **Never** write to shared state directly
2. **Always** acquire mutex lock via `ThreadManager.lock(key)`
3. **Always** release lock in `finally` block
4. **Read** shared state via `StateManager.get(key)`
5. **Write** shared state via `StateManager.set(key, value)`
6. **Timeout** on lock acquisition: 5000ms max

---

## 🐛 BUG REPORT SCHEMA (Jira + Email)

```javascript
const BUG_REPORT_SCHEMA = {
  title:       String,   // [ENV][SEVERITY] Feature — Short description
  description: String,   // Markdown formatted full description
  expected:    String,   // What should happen
  actual:      String,   // What actually happened
  environment: {
    name:    String,     // staging | production | uat
    browser: String,     // chromium | firefox | webkit
    os:      String,
    version: String,
  },
  stepsToReproduce: Array,  // Numbered step list
  severity:  String,   // CRITICAL | HIGH | MEDIUM | LOW
  priority:  String,   // P1 | P2 | P3 | P4
  labels:    Array,    // ['UI', 'Functional', 'API', 'Performance']
  attachments: {
    screenshots:  Array,    // Medium resolution PNG paths
    networkLogs:  Array,    // HAR file paths
    consoleLogs:  Array,    // Console log file paths
  },
};
```

---

## 🤝 AGENT SKILL INHERITANCE

```
All agents inherit these BASE capabilities:
  ✅ Read project memory
  ✅ Write project memory  
  ✅ Use state manager
  ✅ Request human clarification
  ✅ Log structured events
  ✅ Respect approval gates
  ✅ Follow ESLint rules
  ✅ Handle errors gracefully
```

---

## 📡 MCP INTEGRATION POINTS

### Playwright MCP
```
Used by: Agent 05, 06, 07, 10, 11
Operations: page.goto, page.click, page.fill, page.screenshot,
            page.evaluate, network.intercept, console.capture
```

### Jira MCP  
```
Used by: Agent 08, 09
Operations: issues.create, issues.update, issues.addAttachment,
            issues.addComment, sprints.get, boards.get
```

---

## 🚀 GETTING STARTED

### Local Execution (Host)
```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env
# Edit .env with your credentials & model keys

# 3. Validate framework setup
npm run framework:validate

# 4. Run unit test suite (59 tests)
npm run test:unit

# 5. Start full autonomous pipeline
npm run pipeline:start -- --requirements=./requirements.md --project=MyProject

# 6. Launch Web Dashboard (UI at http://localhost:3000)
npm run pipeline:dashboard

# 7. Monitor pipeline status in real-time
npm run pipeline:status:watch

# 8. Reset pipeline for a new run
npm run pipeline:reset
```

### Docker Execution
```bash
# Build and launch entire framework container
docker compose up --build

# Web Dashboard available at http://localhost:3000
# Approval Gate Webhook available at http://localhost:8080
```

---

## 📊 REPORTING STANDARDS

Each test execution report MUST include:
- Pass/Fail counts and percentages
- Execution duration (total + per test)
- Browser/environment matrix
- Performance metrics (p50, p95, p99)
- Bug count by severity
- Flaky test identification
- Memory/CPU usage during K6 runs
- Trend comparison vs. last 5 runs (from memory)
- Auto-healing success rate

---

## 🔄 LEARNING FEEDBACK LOOP

```
Test Run N → Failure Analysis → Root Cause → Memory Update
                                                    ↓
Test Run N+1 ← Apply Corrections ← Generate Patterns
```

Memory accumulates:
- Healing selectors that worked
- Test patterns that are flaky (mark for stabilization)
- Business logic edge cases discovered post-bug-fix
- Human review feedback (what was rejected and why)
- Performance regression points

---

*CLAUDE.md v1.1.0 — This document governs all agents in the ARIA framework.*
*Last updated by: Framework Architect | Classification: Internal Engineering*
