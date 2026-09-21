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
- Steps that explicitly require simultaneous sessions: create separate contexts with `browser.newContext()`,
  build page objects with `new <pageContract.pageObject>(await context.newPage())`, act with `Promise.all`,
  and close the contexts at the end.
- Accessibility expected results: assert roles, accessible names and focus order using contract members
  (`toHaveAttribute`, `toBeFocused`, `page.keyboard.press('Tab')`) exactly as the test case states.
- Visual/style expected results: `await expect(<member>).toHaveCSS('<property>', '<value from test case>')`.
- Responsive/viewport expected results: `await page.setViewportSize({ width, height })` using the dimensions
  stated in the test case, then assert layout with contract members exactly as for any other step.
