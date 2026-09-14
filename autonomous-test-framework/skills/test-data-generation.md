# SKILL: Test Data Generator
## Agent ID: 04-test-data-generator
## Version: 2.0.0
## Classification: Core — Critical Path

---

## 🎯 SKILL PURPOSE

Transform the reviewed test case suite (output of Agent 03) into a
**lightweight, flat JSON test data manifest** where every `{{placeholder}}`
is resolved to a single concrete attribute-value pair — no nesting, no metadata wrappers.

---

## 🧠 DATA GENERATION RULES

### Rule 0: Requirement Document Data Takes Absolute Priority 🚫 NO GENERATION IF DATA EXISTS
**This rule is NON-NEGOTIABLE and must be applied BEFORE any generation step.**

#### Step 1 — Extract first, generate last
Read the requirement document in full and build an **extraction map** of every
explicit data value found. This includes:
- Credential tables (usernames, passwords, account types)
- URL / endpoint values
- Error message strings
- Field constraints (min length, max length, allowed characters)
- Any inline example values (`e.g. "standard_user"`, `` `secret_sauce` ``)
- Data tables in any section (user stories, ACs, constraints, annexures)

#### Step 2 — Use requirement data directly
For every TC field, check the extraction map first:
```
IF field value exists in extraction map → USE IT EXACTLY, do not alter, do not "improve"
IF field value does NOT exist in extraction map → GENERATE a synthetic value
```

#### Step 3 — FORBIDDEN behaviours (will cause test failures)
```
✗ NEVER generate a username if the requirement lists usernames
✗ NEVER generate a password if the requirement states the password
✗ NEVER generate a base URL if the requirement states the application URL
✗ NEVER generate an error message string — always copy it verbatim from the requirement
✗ NEVER prefix requirement-provided values with "aria_" or "test_"
✗ NEVER substitute a requirement value with a seeded/generated one
```

**Example — correct behaviour:**
Requirement states: `standard_user / secret_sauce`
→ Output MUST be: `"username": "standard_user"`, `"password": "secret_sauce"`
→ Output MUST NOT be: `"username": "aria_user_f5014ffa"`, `"password": "AriaAdmin@f5014ffa!"`

### Rule 1: Realistic Over Random
Use realistic-looking values — real name formats, valid email structures, proper phone patterns.
Never use `test123`, `foo`, `bar`, `aaa`, or `xxx` as values.

### Rule 2: Deterministic Seeds
Derive a seed from `projectId + tcKey` so the same TC always produces the same data (reproducible failures).

### Rule 3: Placeholder Resolution Priority
```
0. Requirement document          (explicit values from specs, ACs, user stories) ← HIGHEST
1. Memory → resolvedTestDataPatterns   (reuse known-good values)
2. TC context                          (login TC → credentials)
3. Data type profile                   (email → valid email format)
4. Flag as UNRESOLVED if type unknown
```


### Rule 4: Boundary Values for Edge TCs
```
MIN_BOUNDARY   → exact minimum (from AC or default 1)
MAX_BOUNDARY   → exact maximum (from AC or default 255)
UNDER_MIN      → minimum - 1
OVER_MAX       → maximum + 1
ZERO_VALUE     → 0 or ""
LONG_STRING    → 1001-character string
SPECIAL_CHARS  → "#%&<>!@$^*()"
UNICODE        → "🚀 中文 العربية Ñ"
```

### Rule 5: Security Markers (safe payloads for negative TCs)
```
SQL_INJECT → "' OR '1'='1'; DROP TABLE users;--"
XSS        → "<script>alert('aria-xss-test')</script>"
```

### Rule 6: No Real PII
Use synthetic data only. Prefix sensitive synthetic values with `aria_` or `test_`.

### Rule 7: Runtime Secrets Stay Out
Tokens, API keys, and OAuth credentials MUST use the literal string `LOADED_FROM_ENV_AT_RUNTIME`.

### Rule 8: No Duplicates — Read Before Write ⚡
**BEFORE generating any data, load the existing `test-data.json` file.**
- If a key already exists in `test-data.json` with the same value → **skip it, do not re-emit it**.
- If the same value appears across multiple TCs (e.g., same `baseURL`, same `password`) →
  **promote it to `globalFixtures` once** and reference the key name in TC data — do NOT repeat the literal value per TC.
- Never output the same key-value pair twice anywhere in the file.
- Only append genuinely new keys that are absent from the existing file.

```
DEDUPLICATION LOGIC:
  1. Load existing test-data.json into memory
  2. For each value to emit:
     a. If key exists AND value matches → SKIP
     b. If key exists AND value differs → APPEND with a new unique key name
     c. If value is shared by 3+ TCs     → MOVE to globalFixtures
     d. If key is brand new               → APPEND
  3. Write only the net-new entries back to the file
```

---

## 📥 PLACEHOLDER → VALUE CATALOGUE

| Placeholder | Resolved Value |
|---|---|
| `{{validEmail}}` | `aria_test_{seed}@testdomain.io` |
| `{{validPassword}}` | Password stated in the requirement (Rule 0) — sensitive |
| `{{invalidEmail}}` | `notanemail.nodomain` |
| `{{invalidPassword}}` | `wrong_pass_001` — not sensitive (deliberately wrong) |
| `{{invalid/wrong/unknown…Username}}` | `aria_unknown_user_{seed}` |
| `{{wrong/incorrect…Password}}` | `Aria_Wrong_{seed}!` — not sensitive |
| `{{any/sample…Password}}` | `Aria_Sample_{seed}!` — not sensitive |
| `{{…Case…Username}}` | Letter-case variant of the requirement username (`acme_user` → `Acme_User`) |
| `{{validName}}` | Realistic first + last name |
| `{{validPhone}}` | `+91-9{9 random digits}` |
| `{{validDate}}` | Today in `YYYY-MM-DD` |
| `{{validFutureDate}}` | Today + 30 days |
| `{{validPastDate}}` | Today − 365 days |
| `{{validExpiredDate}}` | Today − 1 day |
| `{{validURL}}` | `https://aria-test-{seed}.example.com` |
| `{{validBaseURL}}` | Value of `AUT_BASE_URL` from config |
| `{{authToken}}` | `LOADED_FROM_ENV_AT_RUNTIME` |
| `{{expiredJwtToken}}` | `eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9.expired` |
| `{{validUsername}}` | `aria_user_{seed}` |
| `{{existingEmail}}` | `aria_existing_{seed}@testdomain.io` |
| `{{validAmount}}` | `99.99` |
| `{{invalidAmount}}` | `-1` |
| `{{maxAmount}}` | `999999.99` |
| `{{minAmount}}` | `0.01` |
| `{{validPayload}}` | Context-derived flat JSON string |
| `{{invalidPayload}}` | `{ broken:` |
| `{{lowPrivToken}}` | `LOADED_FROM_ENV_AT_RUNTIME` |
| `{{exactMinimumValue}}` | From AC or default `1` |
| `{{exactMaximumValue}}` | From AC or default `255` |
| `{{apiEndpoint}}` | Derived from integrationPoints or flagged |

---

## 📤 OUTPUT FORMAT — Flat JSON (attribute: value only)

The output is a **single JSON object** — one level deep, no nested objects, no sections.
Every entry is a plain `"key": "value"` pair.

**Key naming convention:**
- Shared values → plain key (`baseURL`, `username`, `password`)
- TC-specific values → `TC###_fieldName` (`TC001_email`, `TC003_inputValue`)
- Boundary values → `string*` / `number*` prefix (`stringMin`, `numberMax`)
- Runtime secrets → plain key with value `LOADED_FROM_ENV_AT_RUNTIME`

```json
{
  "baseURL":              "https://staging.example.com",
  "username":             "standard_user",
  "password":             "secret_sauce",
  "apiBaseURL":           "https://api.staging.example.com",
  "contentType":          "application/json",

  "TC001_email":          "aria_test_tc001@testdomain.io",
  "TC001_name":           "Jordan Blake",

  "TC002_email":          "notanemail.nodomain",
  "TC002_password":       "short",
  "TC002_expectedError":  "Invalid credentials",

  "TC003_inputValue":     "1",
  "TC003_boundary":       "MIN_BOUNDARY",

  "TC004_expiredToken":   "LOADED_FROM_ENV_AT_RUNTIME",

  "stringMin":            "A",
  "stringUnderMin":       "",
  "stringLong":           "AAAA...A (×1001)",
  "stringSpecialChars":   "#%&<>!@$^*()",
  "stringUnicode":        "🚀 中文 العربية Ñ",
  "stringWhitespace":     "   ",
  "stringSqlInject":      "' OR '1'='1'; DROP TABLE users;--",
  "stringXss":            "<script>alert('aria-xss-test')</script>",

  "numberMin":            0,
  "numberMax":            2147483647,
  "numberUnderMin":       -1,
  "numberOverMax":        2147483648,
  "numberZero":           0,
  "numberNegative":       -999,
  "numberDecimal":        0.001,
  "numberMaxDecimal":     999999999.99,

  "unresolved_1_placeholder": "{{unknownVar}}",
  "unresolved_1_reason":      "Cannot infer data type from context",
  "unresolved_1_suggestion":  "Provide value in .env or framework.config.js"
}
```

> **Rules for the single flat object:**
> - No nested `{}` inside any value — values must be strings or numbers only
> - Shared data (same value used by 3+ TCs) → one key at root, no per-TC repetition
> - Unresolved placeholders → append `unresolved_N_key`, `unresolved_N_reason`, `unresolved_N_suggestion`

---

## ✅ QUALITY CHECKLIST

- [ ] Output is a single flat JSON — zero nested objects
- [ ] Every `{{placeholder}}` resolves to a plain `"key": "value"` pair
- [ ] Shared values (baseURL, credentials) appear once at root — not repeated per TC
- [ ] TC-specific keys use `TC###_fieldName` naming convention
- [ ] Boundary values use `string*` / `number*` prefix naming
- [ ] Runtime secrets have value `LOADED_FROM_ENV_AT_RUNTIME` — never embedded
- [ ] No duplicate keys anywhere in the file
- [ ] All unresolved placeholders are listed with actionable suggestions

---

## 🔄 MEMORY INTEGRATION

**Before generation:**
1. Load `testDataPatterns` from memory → reuse known-good resolutions
2. Load `resolvedClarifications` → apply any human-confirmed boundary values

**After generation:**
1. Write all resolved values back to `testDataPatterns` in memory
2. Store boundary library for use by Auto-Healer (Agent 10)
