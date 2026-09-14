# Agent 05 — Generic API Learnings (application-agnostic)

## 1. Documented endpoints only
API tests are generated only for test cases whose `api.endpoint`, `api.method` and `api.expectedStatusCode` are
concrete. Anything else is reported as NEEDS_CONTEXT — never guessed.

## 2. Exact status and documented fields
Assert the exact expected status code (not `response.ok()`), then only the response fields, values and headers the
expected results name. Do not invent response-time limits or field names.

## 3. Relative requests through the configured context
Use the injected `apiContext` with relative endpoints; hosts, base paths and authentication come from configuration.
