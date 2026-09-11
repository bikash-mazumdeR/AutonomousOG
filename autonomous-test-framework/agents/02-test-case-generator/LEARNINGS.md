# 🧠 Agent 02 (Test Case Generator) — Persistent Learnings & Design Guardrails

This document records architectural, specification, and scenario design rules learned from real test automation failures. These guardrails prevent generating infeasible, incomplete, or flawed test cases.

---

## 1. Negative & Boundary Test Case Step Completeness (Populate Sibling Mandatory Fields)
* **Issue:** Generating a negative test case that tests field A (e.g. username under/over boundary, invalid characters, or SQL injection payload) with steps that only specify entering field A without mentioning mandatory field B (e.g. password) causes downstream automation (Agent 05) to submit without filling field B. The application then aborts at generic missing-field validation (Password is required) and never executes the boundary check on field A.
* **Rule:** Every negative or boundary test case targeting a specific field must explicitly specify supplying valid, conforming inputs for all OTHER mandatory fields in the form.
* **Pattern:**
  * **Step 1:** Enter boundary/invalid input into Target Field (e.g. username: -1 or A * 300 or ' OR '1'='1).
  * **Step 2:** Enter valid input into all other required fields (e.g. password: {{validPassword}}).
  * **Step 3:** Submit form and verify expected target validation message (e.g. Username and password do not match).

---

## 2. Client-Side SPA Feasibility (Do Not Require Backend Network Artifacts for Client-Side Apps)
* **Issue:** Generating test cases expecting backend network artifacts (such as CSRF tokens on HTTP POST requests) for purely static/client-side single page applications (SPAs like SauceDemo) leads to timeout failures because authentication occurs purely in browser memory without emitting HTTP POST requests.
* **Rule:** Differentiate between architectural backend security constraints (CSRF, server-side bcrypt hashing) and client-side automatable UI criteria.
  * For pure UI client apps without documented backend APIs, do not generate test cases that require intercepting network POST calls.
  * Verify frontend security posture (HTTPS protocol, secure cookies, form action targets) rather than phantom backend requests.

---

## 3. Specification Realities vs Target AUT Behavior (Whitespace & Field Trimming)
* **Issue:** PRD specifications often recommend or demand whitespace trimming (e.g., Username field trims leading/trailing spaces). However, public demo sites (like SauceDemo) often evaluate whitespace literally and reject  standard_user  as invalid credentials.
* **Rule:** In test case definitions involving whitespace, explicitly note whether whitespace is expected to be accepted (trimmed) or rejected by the AUT. If the AUT strictly validates credentials character-by-character without trimming, document the test case accordingly so automated verification expects the actual credential validation response rather than an impossible success redirect.

---

## 4. Visual & Computed Style Specification Accuracy
* **Issue:** Test cases specifying visual checks (e.g. Error messages displayed in red) must distinguish between text font color and container/banner background color. On modern UI frameworks, error text is almost always white on a red background badge.
* **Rule:** When drafting test cases with color assertions, specify verifying the alert notification container or badge styling rather than assuming text font color is red.
