# SKILL ADDENDUM: Mode K6 (performance)
## Version: 4.0.0

- Return in `body` ONLY the statements of the k6 default function: the HTTP request(s) to the test case's
  `performance.targetEndpoint` and `check()` calls for the expected results.
- Build URLs as `` `${BASE_URL}<targetEndpoint>` `` — `BASE_URL`, imports (`http`, `check`), options, the
  executor (derived from `performance.scenario`), thresholds, environment validation and `handleSummary` are
  rendered by the framework.
- Secrets and runtime values: `requireEnv('<ENV_VAR>')` with names from the data bindings. No fallback values.
- No Playwright APIs, no `expect`, no `sleep` unless the test case specifies think time.
- Missing SLA or endpoint → NEEDS_CONTEXT `{ "kind": "SLA" | "ENDPOINT" }`. `stepAssertions` list the `check()`
  statements per step.
