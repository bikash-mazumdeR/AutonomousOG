# 🧠 Agent 05 (API Script Generator) — Persistent Learnings & Design Guardrails

This document records architectural, design, and implementation lessons learned from API test generation and execution failures. These guardrails are strictly enforced during Playwright API spec generation.

---

## 1. Concrete API Endpoints Required (Gate Against Synthetic /api/auth or 404s)
* **Issue:** Previously, test generators fabricated speculative REST endpoints (e.g. `${testData.baseURL}/api/auth` or `/api/users/login`) for purely client-side single-page applications that had no server-side API or documented API documentation. This produced unavoidable HTTP 404 failures during test execution and forced downstream healers to disguise or drop tests.
* **Rule:** Strictly verify that concrete API routes and backend specifications are documented before generating `*-api.spec.ts` files.
* **Why:** In static frontends (e.g. SauceDemo), generating mock API tests produces fragile/hallucinated specs that fail or provide false coverage.
  * If the test requirements lack concrete HTTP paths or contain ambiguous placeholders (e.g., `"Not specified"`, `"unknown"`, `"/api"`), do not hallucinate endpoints.
  * API tests must never be generated for static frontends or frontend-only web applications.
* **Pattern:**
  ```javascript
  // ❌ Prohibited — Speculative endpoint guessing:
  const res = await request.post(`${testData.baseURL}/api/auth/login`, { data });

  // ✅ Mandatory — Target only documented, verified API routes:
  const res = await request.post(`${testData.baseURL}/api/v1/authenticate`, {
    data: {
      username: testData.standardUsername,
      password: testData.password,
    },
    headers: { 'Content-Type': 'application/json' },
  });
  ```

---

## 2. Flat testData for API Payloads, Direct Status and JSON Validation
* **Issue:** Using nested paths (e.g. `testData.global.baseURL` or `testData.perTC.F001.payload`) creates runtime `undefined` dereference errors. Furthermore, using browser-oriented assertion wrappers or unhandled promise resolutions causes uninformative error traces on API failure.
* **Rule:** Use flat `testData` properties directly (`testData.baseURL`, `testData.standardUsername`). Validate responses using direct status checks, response duration assertions, and explicit JSON body property checks.
* **Pattern:**
  ```javascript
  // Flat testData references and explicit response assertions
  test('TC-API-001: [API] Verify token generation on valid credentials', async ({ request }) => {
    const startTime = Date.now();
    const response = await request.post(`${testData.baseURL}/api/v1/auth`, {
      data: {
        username: testData.standardUsername,
        password: testData.password,
      },
      headers: { 'Content-Type': 'application/json' },
    });

    const duration = Date.now() - startTime;

    // Direct status and SLA verification
    expect(response.status()).toBe(200);
    expect(duration).toBeLessThan(1000);

    // Deep JSON structure verification
    const data = await response.json();
    expect(data).toHaveProperty('token');
    expect(typeof data.token).toBe('string');
    expect(data.token.length).toBeGreaterThan(0);
  });
  ```
