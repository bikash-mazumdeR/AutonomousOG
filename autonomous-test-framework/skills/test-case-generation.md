# SKILL: Gherkin Test Case Generator

Generate a comprehensive BDD Gherkin `.feature` test suite from analyzed requirements.
Output must be a valid Gherkin feature file only. No JSON, no markdown code block fences unless requested.

## GHERKIN STRUCTURE & TAGGING CONVENTION
Every scenario must be tagged with test type, priority, TC key, and functional labels:

```gherkin
Feature: {Feature Name}
  As a {role},
  I want to {goal}
  So that {benefit}.

  Background:
    Given {system precondition}

  @{type} @{priority} @tc-{key} @{labels}
  Scenario: [{TC-KEY}] {Concise action-oriented test title}
    Given {precondition or setup step}
    When {action performed by user or client}
    And with test data "{testData or {{placeholder}}}"
    Then {verifiable expected result}
```

## MANDATORY TAG TAXONOMY
- **Type (choose 1):** `@positive`, `@negative`, `@edge`, `@api`, `@performance`
- **Priority (choose 1):** `@priority:high`, `@priority:medium`, `@priority:low`
- **TC Key (strictly sequential):** `@tc-001`, `@tc-002`, ... matching scenario title `[TC-001]`
- **Labels (0+):** `@smoke`, `@regression`, `@ui`, `@security`

## COVERAGE REQUIREMENTS
| Feature Risk | Min Positive | Min Negative | Edge | API |
|---|---|---|---|---|
| CRITICAL | 5+ | 5+ | 3+ | Per endpoint |
| HIGH | 3+ | 3+ | 2+ | Per endpoint |
| MEDIUM | 2+ | 2+ | 1+ | If applicable |
| LOW | 1+ | 1+ | 0+ | If applicable |

## TEST DESIGN MATRIX
- **Positive:** Map each Acceptance Criterion to >=1 scenario. Validate end-to-end happy path and mandatory fields.
- **Negative:** Empty/null fields, invalid formats, boundary underflow (< min), duplicate unique entries, unauthorized access (RBAC), expired tokens, SQL injection, XSS payloads, invalid HTTP methods, rate limits.
- **Edge:** Exact boundaries (min, max, min-1, max+1), empty/whitespace strings, strings > 1000 chars, special characters (#, %, &, <, >), unicode/emojis, concurrent race conditions, session timeouts.
- **API (Tag @api):** Request payload validation, status codes (200, 400, 401, 403, 404, 409, 422, 500), response schema validation. **STRICT REQUIREMENT GATE:** Generate ONLY when explicit concrete endpoints, HTTP methods, and payload schemas are documented in requirements. NEVER hallucinate endpoints or generate @api scenarios for client-side only apps.
- **Performance (Tag @performance):** Specify scenario in title (`Load`, `Stress`, `Spike`), target response time threshold in Then step. **STRICT REQUIREMENT GATE:** Generate ONLY when explicit quantitative SLA thresholds (target VUs, latency limits, RPS) and concrete endpoints are documented in requirements.

## RULES
1. Exactly one `Scenario` per test case.
2. Every scenario must have at least one `When` action and at least one `Then` assertion.
3. Dynamic test data must use `{{placeholder}}` notation (e.g., `{{validEmail}}`, `{{expiredToken}}`).
4. Total scenarios must satisfy the coverage requirements for the feature's risk level.
5. Strict Requirement Verification: NEVER invent, hallucinate, or assume backend API endpoints or performance benchmarks. If integration points lack concrete endpoints or SLA conditions are missing, omit @api and @performance scenarios entirely.

