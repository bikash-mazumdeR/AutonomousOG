# Agent 05 — Generic K6 Learnings (application-agnostic)

## 1. Documented endpoint and SLA required
Performance scripts are generated only for test cases with a concrete target endpoint and a documented scenario.
Missing information is reported as NEEDS_CONTEXT.

## 2. Configuration comes from the environment
Base URL, virtual users, duration and thresholds are read from required environment variables by the rendered
script. Never embed defaults, hosts or credentials.

## 3. The body contains only requests and checks
The framework renders options, executor, thresholds and summary export; the generated body contains the request
logic and `check()` calls for the expected results.
