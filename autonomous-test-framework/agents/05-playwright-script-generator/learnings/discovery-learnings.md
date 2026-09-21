# Agent 05 — Generic Discovery Learnings (application-agnostic)

These lessons apply to the discovery navigation planner for every application. Actions recorded during discovery
become the verified flows every test case is generated from, so one wrong action is repeated across many tests.

## 1. Setup and navigation steps perform no element actions
A step that only opens or navigates to a page and expects elements to be displayed plans NO `fill`, `click` or
other element action. Actions that belong to a later step are never attributed to it.
- Wrong: step 1 "the user navigates to the login page" → `fill usernameInput ""`, then step 2 fills it again.
- Right: step 1 → no actions; step 2 → `fill usernameInput`, `fill passwordInput`, `click loginButton`.
A phantom action changes the recorded action sequence, so identical test cases stop matching each other and a
bogus flow (e.g. one that fills the same field twice) is published to the page object.

## 2. Every action belongs to the step whose action text describes it
Set `stepIndex` to the step that describes the interaction. Never move a value written in a later step (a username,
a password) to an earlier step.

## 3. Never fill an empty literal
`{ "literal": "" }` is not a value from the test case. "Clears the X field and enters Y" is ONE action:
`fill X` with Y (`fill` replaces the existing content). A step that only says "clears the X field" with no
following value needs an explicit empty value in the test case; otherwise return `NOT_ACHIEVABLE` with the reason.

## 4. Same described interactions, same actions
Test cases whose steps describe the same interactions must produce exactly the same action list, element by
element and step by step, so that they share one verified flow.

## 5. Never plan a credential as a literal
Rule 3 allows `{ "literal": … }` for text that appears verbatim in the test case. A working credential is the
exception: when the step presents the literal as the value the application must accept — a valid, registered or
working email, password, token or key — it is an unbound credential, not test text. Do not plan it. Set
`stopReason: "NOT_ACHIEVABLE"` and name the step and the field in `detail`, so the value is bound to an environment
variable upstream. A planned credential literal is typed into the real application, then copied into the page map,
into the arguments of every flow built from that action sequence and into every spec generated from it.
- Wrong: `{ "element": "emailInput", "op": "fill", "value": { "literal": "someone@example.com" } }` for a step that
  calls that address the registered one.
- Right: `stopReason: "NOT_ACHIEVABLE"`, `detail: "step 2 gives the registered email as a literal; it needs a binding"`.
A literal the test case supplies as invalid, throwaway or arbitrary text for a negative case is ordinary test data —
plan it as before.
