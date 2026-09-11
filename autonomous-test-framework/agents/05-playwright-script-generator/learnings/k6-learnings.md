# 🧠 Agent 05 (K6 Performance Script Generator) — Persistent Learnings & Design Guardrails

This document records architectural, design, and implementation lessons learned from K6 performance testing and script execution. These guardrails are strictly enforced during K6 script generation.

---

## 1. Concrete Target Endpoints & SLA Requirements
* **Issue:** Generating K6 performance tests against UI routes (e.g. `http.get('https://example.com/login.html')`) without quantitative SLA targets produces irrelevant load tests, excessive bandwidth consumption, and false performance failures on static assets.
* **Rule:** Before generating K6 scripts (`tests/k6/{FID}-{tcKey}-perf.js`), ensure:
  1. The target HTTP endpoint is explicitly defined and supports programmatic load generation.
  2. Quantitative performance SLAs (e.g., target VUs, iterations, duration, P95 latency limit) are documented in the test case requirements.
  3. If quantitative thresholds or API routes are absent, do not synthesize speculative performance tests.
* **Pattern:**
  ```javascript
  // Target verified API endpoints with realistic load configuration
  const BASE_URL = __ENV.AUT_BASE_URL || 'http://localhost:3000';

  export default function () {
    const res = http.get(`${BASE_URL}/api/v1/health`);
    check(res, {
      'status is 200': (r) => r.status === 200,
      'response time < 200ms': (r) => r.timings.duration < 200,
    });
    sleep(1);
  }
  ```

---

## 2. Dynamic ENV Threshold Configs & Structured Summary Reporting
* **Issue:** Hardcoding performance thresholds (e.g. `p(95)<500`) directly in script options prevents dynamic adjustments across environments (e.g., local dev vs staging vs CI runners). Additionally, lacking machine-readable summary output prevents Agent 08 (Report Generator) from parsing test results.
* **Rule:**
  1. Always parameterize scenario options and thresholds via `__ENV` with safe default fallbacks (`__ENV.K6_VUS`, `__ENV.K6_DURATION`, `__ENV.K6_THRESHOLD_P95`).
  2. Implement `handleSummary(data)` exporting test results to `reports/json/k6-{tcKey}-summary.json` so downstream reporting agents can ingest structured performance metrics.
  3. Never import Playwright modules or browser APIs into K6 scripts.
* **Pattern:**
  ```javascript
  export const options = {
    scenarios: {
      load_test: {
        executor: 'constant-vus',
        vus:      parseInt(__ENV.K6_VUS, 10) || 10,
        duration: __ENV.K6_DURATION || '30s',
      },
    },
    thresholds: {
      http_req_duration: [`p(95)<${__ENV.K6_THRESHOLD_P95 || 500}`],
      http_req_failed:   ['rate<0.01'],
    },
  };

  export function handleSummary(data) {
    return {
      'reports/json/k6-{tcKey}-summary.json': JSON.stringify(data, null, 2),
      stdout: `Execution complete. P95: ${data.metrics.http_req_duration?.values['p(95)']}ms\n`,
    };
  }
  ```
