# Agent 05 — Generic UI Learnings (application-agnostic)

These lessons apply to every application. Application-specific notes belong in
`projects/<project>/learnings/agent05-ui.md`. No lesson may weaken, skip or make an assertion conditional.

## 1. Follow the step order; assert initial states first
When a step checks a component state (enabled, masked, empty), assert it before performing actions that change it.
```ts
await featurePage.openStart();
await expect(featurePage.submitButton).toBeEnabled();
await featurePage.usernameInput.fill(data.validUsername);
await expect(featurePage.submitButton).toBeEnabled();
await featurePage.submitButton.click();
```

## 2. Web-first assertions only
Never read a boolean and assert it (`expect(await x.isVisible()).toBe(true)`). Assert the locator directly so
Playwright auto-waits: `await expect(featurePage.resultsPanel).toBeVisible();`.

## 3. Real concurrency uses separate browser contexts
Simultaneous-session steps need `browser.newContext()` per session and `Promise.all` for the actions; a sequential
flow with a "concurrent" comment does not test concurrency.

## 4. Fill every other mandatory field in single-field negative tests
When a step targets one field's validation, populate the other required fields with their bound valid data so
the validation under test is the one that fires.

## 5. Input acceptance is asserted on the field
When the expected result is that a field accepts a value, assert `toHaveValue(...)` on that field instead of
running an unrelated end-to-end flow.

## 6. A mismatch is a genuine failure
If the application might render something different from the approved expected result, still assert the
approved value. Never accept alternative values, never skip, never adapt the expectation to observed behaviour.

## 7. Reloads need no manual waits
`page.reload()` already waits for the load event; follow it with web-first assertions, not load-state waits.

## 8. Call only the flows listed for the test case in `applicableFlows`
`applicableFlows` is the only permission to call a `kind: "flow"` page-object member. A flow's description
("verified by …") lists every test case whose discovery run matched its action sequence — including test cases for
which the flow is NOT applicable (for example because a step inside it has expected results that must be asserted
between its actions). When `applicableFlows` does not cover a step, perform that step's actions with the element
members, in step order, and assert the step's expected results right after them. Calling an unlisted flow blocks the
test case.
```ts
// applicableFlows lists only loginFlow for step 3
await featurePage.usernameInput.fill(data.unregisteredUsername);   // step 2: element members
await featurePage.passwordInput.fill(data.invalidPassword);
await featurePage.loginButton.click();
await expect(featurePage.errorElement).toContainText('…');
await featurePage.loginFlow({ username: data.validUsername, password: data.validPassword }); // step 3: listed flow
```

## 9. Hedged values are not assertable — return NEEDS_CONTEXT
A value qualified as "recommended", "e.g.", "such as", "approximately", "about", "or similar" or "if applicable"
is an example, not an expected result. Do not assert the example value (for a colour, a size, a count or a timing)
and do not pick a CSS property the step does not name ("styled in red" names no property). Return NEEDS_CONTEXT
`{ "kind": "EXPECTED_RESULT" }` quoting the hedged wording.

## 10. Never substitute a similar element
When an expected result names an element the page contract does not list (for example an "error icon"), return
NEEDS_CONTEXT `{ "kind": "LOCATOR" }`. Never assert a different element instead — a button, a container or an image
with another role or accessible name (e.g. a "Dismiss error" button is not an error icon) — and never drop the
assertion. An icon has no text of its own: text attached to an icon in a step belongs to the message beside it.

## 11. Identical steps get identical outcomes
Test cases whose steps and expected results are the same (apart from their data) must receive the same decision
and the same assertions. If one of them needs context for a hedged value or a missing element, all of them do.

## 12. Run-together expected results
An expected result in which several assertions are joined without a separator (e.g. "… in an alert boxthe error
message container …") has lost its line breaks. Treat each clause as a separate expected result only when its
boundaries are unmistakable; otherwise return NEEDS_CONTEXT `{ "kind": "EXPECTED_RESULT" }` asking for one
expected result per line.
