# ARIA Autonomous Testing Framework — Gemini Operating Manual

ARIA (**A**utonomous **R**eliability & **I**ntelligence **A**gent) is an AI-driven autonomous test automation framework that plans, generates, executes, reviews, and heals Playwright and K6 test suites.

---

## 📌 Project Context
- **Framework Name:** ARIA (Autonomous Reliability & Intelligence Agent)
- **Tech Stack:** TypeScript (Strict), Node.js (>=18), Playwright (1.44.0), K6, SQLite (`better-sqlite3` in WAL mode), LanceDB (Vector RAG memory), Jira MCP, Gmail SMTP, Docker, LiteLLM (optional proxy for provider-agnostic LLM routing).
- **Architecture:** 11 specialized autonomous agents orchestrated by `orchestrator.ts` or executable standalone via `npm run agent:XX`.
- **Dual Working Directory:** Commands can be run either from the repository root (via root forwarding scripts) or from `autonomous-test-framework/`.

---

## 🏛️ Core Engineering & Operational Mandates

### 1. Surgical Changes & Scoped Reads
- **Context Efficiency:** ALWAYS use `start_line` and `end_line` when reading files. Never ingest entire files unless they are <100 lines.
- **Minimal Output:** Keep conversational summaries concise and focused on rationale and verification results.

### 2. Aggressive Delegation
- Delegate multi-file modifications, speculative investigations, or repetitive tasks to subagents (`research` or `self`) to keep main session context clean.

### 3. Verification & Zero Regression Policy
- Every code change MUST be validated.
- Run `npm run test:unit` to verify that all 59 Jest unit tests remain 100% passing.
- Run `npm run framework:validate` when altering environment, database, or credentials.

### 4. State-Safe Execution & Persistence
- **Single Source of Truth:** All pipeline state MUST be accessed exclusively through `StateManager.ts` and `Database.ts`.
- **Concurrency:** Uses async `Mutex` transactions with WAL mode in SQLite (`.state/pipeline-state.db`).
- **Dynamic Project ID Resolution:** Agents must dynamically resolve the active project ID from the latest non-test run (`project_id NOT LIKE 'test-%'`) in SQLite so that standalone CLI runs cleanly locate pipeline artifacts (`reviewedScripts`, `testData`, `executionResults`).
- **RAG Vector Memory:** LanceDB (`.state/lancedb/`) stores embeddings of bug patterns, locator updates, and test cycle feedback for semantic retrieval.

### 5. Jira Workflow & MCP Mandates
- **No Resets:** Strictly forbidden to manually or automatically reset Jira bug statuses (e.g., reverting to "Fixed" for testing).
- **Fixed-Only Transitions:** Agents MUST verify a bug is in "Fixed" status before attempting any re-test transition.
- **Strict Target States:** From "Fixed", bugs can only transition to "Verified as fixed" (on pass) or "Re-Open" (on fail).
- **"Done" Block:** Strictly prohibited from transitioning any bug directly to "Done".

### 6. Agent 05 Script Quality & Generator Mandates
- **Centralized Test Data:** NEVER hardcode duplicated test data, credentials, or URLs in `.spec.ts` files. Always consume centralized fixtures from `tests/fixtures/test-data.json` and `process.env.AUT_BASE_URL`.
- **TLS Security Tests:** Verify negotiated TLS protocol/ciphers via response security details (`response.securityDetails()`), not just checking `https:` in the URL string.
- **Input Value Assertions:** For input validation test cases, explicitly assert the input element's value (`await expect(locator).toHaveValue(...)`).
- **Accessibility Checks:** For WCAG compliance, use native Playwright accessible role locators (`page.getByRole`) and automated compliance scanning. Never use deprecated `page.accessibility` APIs.

### 7. Approval Gates & Human-in-the-Loop
- In `FRAMEWORK_APPROVAL_MODE=manual` (default), agents pause at completion:
  - **Terminal Commands:** `APPROVED`, `REJECTED — <reason>`, `SHOW OUTPUT`, `HELP`.
  - **REST Webhook API (Port 8080):** `POST /approve` and `POST /reject`.
- In `FRAMEWORK_APPROVAL_MODE=auto`, human approval gates are skipped for CI/CD runs.

### 8. Docker Containerization Standards
- Multi-stage build on `mcr.microsoft.com/playwright:v1.44.0-jammy`.
- Run as unprivileged `pwuser` with full `/app` directory ownership.
- `.dockerignore` strictly excludes `node_modules`, `.state`, `.env`, and `reports`.
- Volumes persisted: `./reports`, `./.state`, `./tests`, `./core/project-memory`.
- Exposed ports: `8080` (Approval Webhook) and `3000` (ARIA Web Dashboard).

---

## 📁 Key Directories & Components
- `agents/`: 11 autonomous agent implementations (`01-requirement-analyzer` through `11-retest-agent`).
- `cli/`: Interactive CLI & monitoring tools (`dashboard.ts`, `status.ts`, `reset.ts`, `validate.ts`, `memory.ts`).
- `core/`: State management (`StateManager.ts`, `Database.ts`), Memory Engine (`MemoryEngine.ts`, `VectorStore.ts`), Approval Gate (`ApprovalGate.ts`), LLM Client (`LLMClient.ts`).
- `config/`: Master framework configuration (`framework.config.ts`).
- `tests/`: Specs (`tests/specs/`), Page Objects (`tests/pages/`), Test Data (`tests/fixtures/`), unit tests (`tests/unit/`).
- `reports/`: HTML/JSON execution reports and attachments (`screenshots/`, `network-logs/`, `console-logs/`).
- `.state/`: Persisted SQLite database (`pipeline-state.db`) and LanceDB vector store (`lancedb/`).

---

## 🤖 Gemini Added Memories
<!-- This section is for persistent facts added via /memory add or save_memory -->
- Agent 07 dynamically resolves active project ID from the latest non-test run in SQLite to ensure reviewed scripts and test data load reliably.
- Docker builds must always include build-essential tools (`python3 make g++`) and unprivileged user ownership (`chown -R pwuser:pwuser /app`) to allow SQLite WAL and test file writes.
