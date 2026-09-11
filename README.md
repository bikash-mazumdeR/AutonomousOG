# ARIA — Autonomous Reliability & Intelligence Agent

ARIA is an AI-driven autonomous test automation framework built on top of Playwright, K6, Jira, and Gmail. It utilizes 11 specialized autonomous agents, an 11-stage pipeline, human-in-the-loop approval gates, and a semantic memory engine to completely automate the testing lifecycle from requirement analysis to automated execution, bug reporting, and self-healing test maintenance.

## Key Features

- **11-Agent Autonomous Pipeline**: Orchestrates agents spanning the entire testing lifecycle:
  1. Requirement Deep Analyzer
  2. Test Case Generator
  3. Test Case Reviewer
  4. Test Data Generator
  5. Playwright Script Generator
  6. Automation Code Reviewer
  7. Test Runner (Multi-threaded)
  8. Bug Reporter (Jira integration)
  9. Report Generator (Email notifications)
  10. Auto Healer
  11. Retest Agent
- **Human-in-the-Loop Approval Gates**: Ensure automated behavior can be overseen and paused at critical pipeline stages, natively integrating with CLI and webhooks.
- **RAG-Powered Memory Engine**: Leverages embedded LanceDB vector storage and SQLite State Management to retain history across cycles, track flakiness, record test data patterns, and prevent redundant bug reporting.
- **LLM Agnostic**: Supports Anthropic Claude, OpenAI, and Google Gemini, utilizing context summarization strategies for large payloads.
- **Auto-Healing**: Features a dedicated Auto-Healer agent capable of analyzing pipeline failures and fixing script logic or locators in real-time.
- **Comprehensive Infrastructure**: Built-in rules for script linting, integrated unit testing with Jest, Docker compatibility, and fully integrated GitHub Actions CI/CD workflows.

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

## Setup & Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd aria-autonomous-testing-framework
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   Copy `.env.example` to `.env` and fill in the necessary API keys and credentials.
   ```bash
   cp .env.example .env
   ```

## Running the Framework

Commands can be run either from the **root directory** or from within the **`autonomous-test-framework/`** subdirectory.

### CLI Commands

- **Start Pipeline**: Run the complete 11-stage pipeline via the Orchestrator.
  ```bash
  npm run pipeline:start -- --requirements=./requirements.md --project=MyProject
  ```
- **Pipeline Dashboard**: Start the web-based monitoring dashboard (defaults to port `3000`).
  ```bash
  npm run pipeline:dashboard
  ```
- **Terminal Status Visualizer**: Check real-time pipeline status.
  ```bash
  npm run pipeline:status:watch
  ```
- **Agent Standalone Runs**: You can trigger specific agents manually:
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
- **Reset Pipeline**: Reset SQLite state and start fresh.
  ```bash
  npm run pipeline:reset
  ```
- **Validate Framework**: Check system health, connectivity, and configuration.
  ```bash
  npm run framework:validate
  ```
- **Run Unit Tests**: Execute all Jest unit tests.
  ```bash
  npm run test:unit
  ```

---

## Docker & Containerized Execution

ARIA is fully containerized using multi-stage Docker builds based on `mcr.microsoft.com/playwright:v1.44.0-jammy`.

### Running with Docker Compose

1. **Start the pipeline in Docker**:
   ```bash
   docker compose up --build
   ```
2. **Access Services**:
   - **ARIA Web Dashboard**: `http://localhost:3000`
   - **Approval Webhook API**: `http://localhost:8080`
3. **Persisted Volumes**:
   - `./reports` &rarr; Test results, execution JSON, attachments, HTML reports
   - `./.state` &rarr; Persistent SQLite state database (`pipeline-state.db`) & LanceDB vector store
   - `./tests` &rarr; Generated Playwright spec files, Page Object Models (POMs), and test data
   - `./core/project-memory` &rarr; Persistent learning memory store

---

## Human-in-the-Loop Approval Gates

ARIA includes mandatory human sign-off gates between critical stages when `FRAMEWORK_APPROVAL_MODE=manual` (default).

- **Terminal Interaction**:
  - `APPROVED` / `PROCEED` / `GO` / `YES` &rarr; Approve stage and proceed to the next
  - `REJECTED — <reason>` &rarr; Reject stage with actionable feedback
  - `SHOW OUTPUT` &rarr; View detailed stage payload and artifacts
  - `HELP` &rarr; Display available gate commands
- **Webhook API**:
  - Approve: `POST http://localhost:8080/approve` with body `{"stageId": "<stage-id>", "comment": "Approved"}`
  - Reject: `POST http://localhost:8080/reject` with body `{"stageId": "<stage-id>", "comment": "<reason>"}`
- **CI / Automated Mode**:
  - Set `FRAMEWORK_APPROVAL_MODE=auto` in `.env` to skip human gates in CI/CD pipelines.

---

## Architecture

ARIA implements a deterministic Directed Acyclic Graph (DAG) state machine using `better-sqlite3` and `Mutex` locks to orchestrate its stages asynchronously without race conditions. Each Agent strictly performs a single functional role and interacts with a centralized `MemoryEngine` ensuring the framework grows smarter over time by capturing user feedback and runtime errors. 

## Documentation

- Check `CLAUDE.md` for a comprehensive overview of agent specifications, internal schemas, and architecture rules.
- View `IMPROVEMENT_PLAN.md` for the historical project progression.
- View the `.logs/` and `reports/` directories for detailed outputs of individual pipeline runs.

## License
MIT
