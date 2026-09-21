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

## 13. A credential given as a bare literal is not a bound value
When a step supplies the value the application must accept — the text calls it a valid, registered or working
email, password, token or key — but gives it as literal text instead of a data binding, do NOT inline the literal.
Return NEEDS_CONTEXT `{ "kind": "DATA" }` naming the test case, the step and the field. Two things go wrong when
such a literal is inlined: a real credential is written into the repository, and the test silently stops covering
what its title claims — a "valid" password that is not the account's password turns a one-invalid-field case into
an all-invalid case, so it duplicates another test case and its acceptance criterion loses coverage.
```ts
// Step: "the user enters 'someone@example.com' in the Email field and {{invalidPassword}} in the Password field",
// where the same step calls that address the registered one.
// Wrong: await featurePage.signInFlow({ email: "someone@example.com", password: data.invalidPassword });
// Right: NEEDS_CONTEXT { "kind": "DATA", "detail": "TC-0xx step 2 gives the registered email as a literal; bind it" }
```
A literal the test case presents as invalid, throwaway or arbitrary ("enters 'abc' in the Search field") is ordinary
test text — use it verbatim as before.

## 14. "Remains on / is not redirected" is observable only after the application has answered
`await expect(page).toHaveURL(...)` placed straight after a submit passes on its first poll, before the request that
could redirect has answered, so it holds whichever way the submission goes. Assert it only after an assertion in the
same test has observed the application's answer to that submission — the message the step expects, or the state
discovery verified for that step. When the step's expected results name no such signal, return NEEDS_CONTEXT
`{ "kind": "EXPECTED_RESULT" }` asking for the signal that the submission finished.
```ts
await featurePage.signInFlow({ email: data.invalidEmail, password: data.invalidPassword });
await expect(featurePage.loginErrorAlert).toContainText('Login failed');  // the application answered
await expect(page).toHaveURL('/');                                        // only now does "remains" mean anything
```

## 15. Assert a URL only when it can tell the outcomes apart
`verifiedStates[stepIndex].urlPath` says where the step ended, not that a different outcome would have ended
elsewhere. When the page contract lists the elements of both possible destinations under the SAME state — a
single-page application that swaps views without changing the address — that path is identical for success and
failure, so `toHaveURL` can never fail and the assertion proves nothing. Assert the element the expected result
names, because it belongs to exactly one outcome. If the expected result names only the address, return
NEEDS_CONTEXT `{ "kind": "EXPECTED_RESULT" }` asking which element proves the state.
