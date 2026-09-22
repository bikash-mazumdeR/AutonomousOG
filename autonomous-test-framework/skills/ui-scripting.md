# SKILL ADDENDUM: Mode UI (Playwright)
## Version: 4.0.0

- The body runs inside `async ({ page, featurePage, data, browser }) => { … }`.
- `featurePage` is the verified page object described by `pageContract`; use only its members.
- Start each test by navigating with the page-object `open<State>()` method that matches the test case's first step.
  Do this in every test, even if every test starts the same way.
- A precondition or first step that needs an authenticated session ("the authenticated user is on …", "the user is
  logged in") is met by the contract's `signIn()` method, or by the `open<State>()` method whose description says it
  signs in. Call it first, in every such test. The page object reads the account from the environment itself, so the
  body passes no credentials and needs no data binding for them. Never fill the sign-in form field by field to meet
  such a precondition; when the contract has neither member, the precondition is NEEDS_CONTEXT `{ "kind": "AUTH" }`.
- `visit<State>()` methods request that state's address directly — no sign-in, no action — for a step that says the
  user opens or navigates to an address (after logging out, say). What the application then shows — the state itself,
  or a redirect to the login page — is what the step asserts, with contract members and `verifiedStates`. Never use
  one to reach a state a step arrives at by acting, and never in place of `open<State>()` or `signIn()`.
- When the test case lists `preconditionActions`, they are the actions discovery performed to establish its precondition
  ("the user menu is open", "the user has logged out"). Perform exactly those, in that order, right after the opening
  navigation or sign-in and before step 1 — `await featurePage.<member>.<op>(<value>)` for each, with the `value`
  expression given, or `await featurePage.<member>()` for an `op` of `goto` — and assert nothing for them. Never add to, drop from or reorder them, and never satisfy a
  precondition another way. A precondition with no `preconditionActions` is already met by the opening navigation.
- A `locator` member whose description says it is the account identifier the session signed in with represents the
  account's email or username as the page shows it. An expected result that quotes that identifier is asserted with
  `await expect(featurePage.<member>).toBeVisible()` — never with the literal value, which is account data the
  environment provides and must never be written into a test, a fixture or an assertion.
- Steps that explicitly require simultaneous sessions: create separate contexts with `browser.newContext()`,
  build page objects with `new <pageContract.pageObject>(await context.newPage())`, act with `Promise.all`,
  and close the contexts at the end.
- Accessibility expected results: assert roles, accessible names and focus order using contract members
  (`toHaveAttribute`, `toBeFocused`, `page.keyboard.press('Tab')`) exactly as the test case states.
- Visual/style expected results: `await expect(<member>).toHaveCSS('<property>', '<value from test case>')`.
- Responsive/viewport expected results: `await page.setViewportSize({ width, height })` using the dimensions
  stated in the test case, then assert layout with contract members exactly as for any other step.
