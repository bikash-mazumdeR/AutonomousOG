# SKILL: Test Data Generator
## Agent ID: 04-test-data-generator
## Version: 3.0.0
## Classification: Core — Critical Path

---

## 🎯 SKILL PURPOSE

Resolve every `{{placeholder}}` in the approved test cases (Agent 03) to a value the tests can use — **without guessing
anything that must match the application**. What cannot be resolved is asked as a clarification, never invented.

Implementation: `agents/04-test-data-generator/valuePolicy.ts` (policy), `placeholderIntent.ts` (classification),
`dataClarifications.ts` (questions), `testDataEdits.ts` (UI edits).

---

## 🧠 VALUE CLASSES

Every placeholder name is split into words and classified:

| Class | Meaning | Example names | May come from |
|---|---|---|---|
| GROUNDED | Must match the application under test | `productName`, `existingEmail`, `errorMessage`, `usernameMaxLength`, `userRole`, `validBaseURL` | Human answer, requirement, AUT profile — never generated, never from memory |
| RUNTIME | Real credential or secret | `validUsername`, `validPassword`, `authToken`, `apiKey` | An environment variable reference only — the value is never stored |
| GENERATABLE | Synthetic input that need not exist | `invalidPassword`, `unknownUsername`, `expiredJwtToken`, `invalidEmail`, `firstName`, `validEmail`, `longString` | Also memory and deterministic generation |

- Expected texts and limits (`message`, `error`, `text`, `length`, `max`, …) are always GROUNDED.
- Deliberately wrong, arbitrary or letter-case-variant credentials are GENERATABLE test inputs, not secrets.
- Anything not recognised is GROUNDED: it is asked, not guessed.

---

## 📐 RESOLUTION ORDER

1. **Human answer** to an Agent 04 clarification, or an earlier Agent 04 UI override of the same, unchanged test case
   (matched by test case hash). For a RUNTIME placeholder the answer must be an environment variable name.
2. **Requirement** — Agent 01 `testDataValues` of the test case's user story, else its feature, else the whole
   requirement. Conflicting values are asked, never picked. A credential stated in the requirement becomes an
   environment variable reference.
3. **AUT profile** — `baseUrlEnv` for base URL placeholders; `auth.credentialEnvVars` / `secretsEnvVars` for credentials.
   A single documented endpoint resolves endpoint placeholders.
4. **Memory, then generation** — GENERATABLE placeholders only, seeded by project and test case key so reruns are stable.
5. **Unresolved** — recorded in the manifest and asked.

Credential storage is a project setting: a project whose AUT profile sets `auth.credentialStorage: "fixture"` (a public
test application whose credentials are not secret) treats credentials as GROUNDED — stated or answered values are
written to the fixture, and they are still never generated. The default, `"env"`, keeps them as environment variable
references.

Environment variable names: the AUT profile's declared name, otherwise the convention `ARIA_<PLACEHOLDER_IN_SNAKE_CASE>`
(`validPassword` → `ARIA_VALID_PASSWORD`). A variable that is neither declared nor set raises an ENVIRONMENT question.

---

## ❓ CLARIFICATIONS

- One question per unresolved placeholder, shared by every test case that uses it, owned by Agent 04.
- RUNTIME: "Which environment variable holds {{name}}?" — answered with a variable name.
- GROUNDED: "What value should {{name}} have?" — answered with the exact value.
- Questions retire automatically once the value resolves, including Agent 05's unresolved-binding questions.
- Editing a value in the Agent 04 UI answers the matching open questions.

---

## ✏️ HUMAN EDITS (Agent 04 UI)

Every edit updates the manifest **and** the enriched test case Agent 05 binds from (`resolvedData.inputs`), recounts,
and re-syncs the flat fixture:

- `single_tc` — `{ tcKey, inputs: { placeholder: value } }`
- `global` — `{ globalFixtures: { placeholder: value } }`, applied to every test case using the placeholder
- `full_flat` — the edited fixture: `<TCKEY>_<name>` keys change one test case, root keys change all, boundary constants are ignored

A credential edit must be an environment variable name; a literal credential is refused.

---

## 📤 OUTPUT

- `manifest.perTCData[tcKey].inputs["{{name}}"]` → `{ value, type, sensitive, source, note, valueClass, envVar?, origin? }`
  - `source`: `clarification | user_override | requirement | memory | generated | runtime | unresolved`
  - Runtime entries: `value = "LOADED_FROM_ENV_AT_RUNTIME"`, `envVar` names the variable, `origin` names the source that chose it
- `manifest.requirementValues` — non-credential values the requirement states
- `manifest.runtimeBindings`, `sensitiveDataVault.refs` — environment variable references
- `manifest.unresolvedPlaceholders`, `pendingClarifications`, `environmentIssues`
- Flat fixture (`tests/fixtures/test-data.json`): shared values at the root, `<TCKEY>_<name>` otherwise, and generic
  `string*` / `number*` boundary constants. Runtime and unresolved values are never written.

---

## 🧪 SYNTHETIC VALUES (GENERATABLE only)

| Intent | Value |
|---|---|
| Wrong / unknown username | `aria_unknown_user_{seed}` |
| Wrong password | `Aria_Wrong_{seed}!` |
| Any / sample credential | `aria_sample_user_{seed}` / `Aria_Sample_{seed}!` |
| Letter-case variant username | Case-flipped requirement username (asked when the requirement states none) |
| Email / invalid email | `aria_test_{seed}@example.test` / `notanemail.nodomain` |
| First / last / full name | Seeded synthetic names |
| Invalid phone / amount / payload / date | `INVALID-PHONE-ABC` / `-1` / `{ broken json }` / yesterday |
| Expired token | A structurally valid JWT that expired an hour ago |
| Boundary (long, special, unicode, whitespace, SQL injection, XSS) | Generic boundary strings |

No application URLs, accounts, passwords or messages belong in this skill or in Agent 04.

---

## ✅ QUALITY CHECKLIST

- [ ] No GROUNDED value was generated or taken from memory
- [ ] No credential or secret value is stored anywhere — only environment variable names
- [ ] Every unresolved placeholder has an open clarification
- [ ] UI edits are reflected in `enrichedZephyrExport` `resolvedData`
