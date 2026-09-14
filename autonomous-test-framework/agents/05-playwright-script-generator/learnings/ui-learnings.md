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
