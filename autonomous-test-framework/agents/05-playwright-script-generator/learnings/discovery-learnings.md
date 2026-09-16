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
