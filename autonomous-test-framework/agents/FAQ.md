# ARIA Autonomous Testing Framework — Frequently Asked Questions (FAQ)

---

### Table of Contents
1. [General & Pipeline Concepts](#1-general--pipeline-concepts)
2. [Approval Gates & Human-in-the-Loop](#2-approval-gates--human-in-the-loop)
3. [Docker & Containerization](#3-docker--containerization)
4. [State Management & Project Runs](#4-state-management--project-runs)
5. [Troubleshooting & Common Errors](#5-troubleshooting--common-errors)

---

### 1. General & Pipeline Concepts

#### Q: How do I run the full 11-stage autonomous testing pipeline?
Run the start command with requirements and a project name:
```bash
npm run pipeline:start -- --requirements=./requirements.md --project=MyProject
```

#### Q: Can I run individual agents independently?
Yes! Every agent can be run standalone via npm:
```bash
npm run agent:01  # Requirement Deep Analyzer
npm run agent:02  # Test Case Generator
npm run agent:03  # Test Case Reviewer
npm run agent:04  # Test Data Generator
npm run agent:05  # Playwright Script Generator
npm run agent:06  # Automation Code Reviewer
npm run agent:07  # Test Runner (Playwright & K6)
npm run agent:08  # Bug Reporter (Jira)
npm run agent:09  # Report Generator (Email)
npm run agent:10  # Auto Healer
npm run agent:11  # Retest Agent
```

#### Q: How do I launch the Web Dashboard?
```bash
npm run pipeline:dashboard
```
Then open your browser at `http://localhost:3000`.

#### Q: How do I monitor pipeline status in real-time?
```bash
npm run pipeline:status:watch
```

---

### 2. Approval Gates & Human-in-the-Loop

#### Q: What should I enter when prompted at the Approval Gate?
When an agent completes a stage, the pipeline pauses for human review:
- `APPROVED` / `PROCEED` / `GO` / `YES` &rarr; Signs off on the stage output and triggers the next agent.
- `REJECTED — <reason>` &rarr; Rejects the stage and instructs the agent (or predecessor) to self-heal.
- `SHOW OUTPUT` &rarr; Displays the full JSON payload, scores, or review findings.
- `HELP` &rarr; Lists all available gate commands.

#### Q: Can I approve stages via API/Webhook instead of typing in the terminal?
Yes! The approval gate listens on port `8080` (or `APPROVAL_WEBHOOK_PORT`):
```bash
# Approve
curl -X POST http://localhost:8080/approve \
  -H "Content-Type: application/json" \
  -d '{"stageId": "07-test-runner", "comment": "Verified and signed off"}'

# Reject
curl -X POST http://localhost:8080/reject \
  -H "Content-Type: application/json" \
  -d '{"stageId": "06-automation-reviewer", "comment": "Fix selector on TC-005"}'
```

#### Q: How do I disable manual approval gates for CI/CD runs?
In your `.env` file, set:
```env
FRAMEWORK_APPROVAL_MODE=auto
```
This automatically approves all stages without terminal prompts or pauses.

---

### 3. Docker & Containerization

#### Q: How do I build and execute the framework inside Docker?
```bash
docker compose up --build
```

#### Q: How do I interact with the Approval Gate when running inside Docker?
You have two options:
1. **Interactive Terminal**: Run `docker compose run --rm -p 8080:8080 -p 3000:3000 aria-framework` or attach to the running container (`docker attach aria-framework`).
2. **Webhook API**: Send a `POST` request to `http://localhost:8080/approve` from your host terminal or postman.

#### Q: Where are generated files and reports stored when using Docker?
All key state and artifacts are mapped to the host via volumes:
- `./reports` &rarr; Playwright HTML/JSON reports, failure screenshots, network logs, and K6 metrics.
- `./.state` &rarr; SQLite `pipeline-state.db` and LanceDB vector store.
- `./tests` &rarr; Generated Playwright `.spec.ts` files, Page Objects, and test fixtures.
- `./core/project-memory` &rarr; Persistent memory file (`memory.json`).

---

### 4. State Management & Project Runs

#### Q: How does ARIA remember previous runs and avoid re-testing?
ARIA uses a two-tier storage model:
1. **SQLite Database (`.state/pipeline-state.db`)**: Stores exact pipeline stages, approvals, and artifacts with thread-safe Mutex locks.
2. **LanceDB Vector Store (`.state/lancedb`)**: Semantic embeddings of bug patterns, locator changes, and flaky tests for RAG querying.

#### Q: How do I completely reset the pipeline to start clean?
```bash
npm run pipeline:reset
```
This clears the SQLite stage records and resets the pipeline state for a new run.

---

### 5. Troubleshooting & Common Errors

#### Q: Error: "No reviewed scripts found. Run Agent 06 first."
- **Cause**: Agent 07 requires reviewed scripts produced by Agent 06. If you started Agent 07 standalone without running Agent 06, or under a different project name, no approved scripts were found.
- **Solution**: Run `npm run agent:06` first to review and approve the scripts. Agent 07 also automatically looks up the latest active run in `.state/pipeline-state.db` and checks `reports/json/code-review-*.json` on disk.

#### Q: How do I verify framework dependencies and health?
```bash
npm run framework:validate
```
This verifies Node version, API keys, database connectivity, Jira MCP, and Gmail SMTP settings.

#### Q: How do I run framework unit tests?
```bash
npm run test:unit
```
Executes all 59 Jest unit tests covering StateManager, ApprovalGate, MemoryEngine, ThreadManager, and agents.
