# SKILL ADDENDUM: Mode API (Playwright request)
## Version: 4.0.0

- The body runs inside `async ({ apiContext, data }) => { … }`. `apiContext` already has the base URL and any
  configured authentication; never add hosts, ports or credentials.
- Send exactly the test case's `api.method` to the relative `api.endpoint`
  (e.g. `const response = await apiContext.post('<endpoint>', { data: data.<requestBodyFixtureKey> });`).
- Assert `expect(response.status()).toBe(<api.expectedStatusCode>)` and ONLY the response fields, values and
  headers named in the expected results.
- Never assert response time unless an SLA value appears in the test case.
- No `page`, no page objects. Authentication the input does not describe → NEEDS_CONTEXT `{ "kind": "AUTH" }`.
