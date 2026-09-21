# Project notes — Nexolvi (Nexo Desk admin) · Agent 05 UI

These notes apply ONLY to this project. They have LOWER authority than the approved test case and
the verified page contract: they never change an expected result, a test value or a locator. When a note and the
approved test case disagree, the approved test case wins.

1. Sign-in is asynchronous and slow: the form posts to `https://api.nexolvi.ai/auth/login`, which takes roughly
   2–5 seconds to answer. While it is in flight the button becomes `signingInButton` with the text "Signing in…".
   That is a TRANSIENT state, never an end state. Do not capture it as the result of the sign-in step, do not bind
   locators from it, and do not report "no progress" while it is showing — the state that follows is the Nexo Desk
   Dashboard (valid credentials) or the login page carrying the "Login failed" alert (invalid credentials).
2. The Sign In button is disabled until BOTH the Email and Password fields hold at least one character. Any plan that
   clicks Sign In must fill both fields first; a click on the disabled button cannot advance discovery.
3. Valid credentials are never literals. They are read from the environment through the AUT profile
   (`validEmail` → `NEXOLVI_EMAIL`, `validPassword` → `NEXOLVI_PASSWORD`). A test body must reference the fixture's
   runtime binding; it must never inline the email address or the password, and it must never substitute a synthetic
   value for them — only the real account reaches the dashboard.
4. The password visibility toggle is a button whose accessible name states its NEXT action: "Show password" while the
   password is masked, and the name changes once the password is revealed. Use the locator recorded for the state you
   are in rather than reusing the masked state's locator after the toggle; assert masking with the input's `type`
   attribute (`password` vs `text`), not by reading the value.
5. Failed sign-in renders the exact text "Login failed" in the page DOM — it is not a browser dialog, so it is never
   asserted with a dialog handler. The same message is shown for all three invalid combinations (bad email, bad
   password, both), so the message text alone does not distinguish them. The message lives in a `div[role="alert"]`
   that carries NO accessible name, so discovery cannot identify it on its own; it is supplied by the AUT profile as
   the declared locator `loginErrorAlert`. Assert the message on that member.
6. After a failed sign-in the user stays on the login page; the dashboard is reached only by a successful sign-in.

## Known gaps from the 2026-09-18 run (run_1789744461502)

Nine test cases ended NEEDS_CONTEXT. Causes and resolutions, so the same gaps are not re-reported as new findings:

| Test case | Reported | Cause | Resolution |
| --- | --- | --- | --- |
| TC-001, TC-005 | STATE — no progress; state shows "Signing in…" | Two causes. (a) Discovery settled on DOM quiet (400 ms) while the sign-in request was still in flight. (b) **The test account is rejected**: `POST /auth/login` with the documented credentials answers HTTP 401, so a successful sign-in never happens and the dashboard cannot be reached by anyone | (a) fixed in `discovery/domDiscovery.ts`: `settle()` now counts in-flight requests directly. (b) BLOCKED — needs working credentials in `NEXOLVI_EMAIL` / `NEXOLVI_PASSWORD`; no framework change can reach a state the application refuses to enter |
| TC-003, TC-004, TC-012 | DATA — `ARIA_VALID_PASSWORD` not set | Agent 04 ran before the AUT profile declared `auth.credentialEnvVars`, so it bound `{{validPassword}}` to the conventional name instead of `NEXOLVI_PASSWORD` | Re-run Agent 04 with the current profile; the binding becomes `NEXOLVI_PASSWORD`, which is set |
| TC-006, TC-007, TC-008 | LOCATOR — no page contract member for the "Login failed" message | Two causes, both now addressed: the post-response state was never captured (same settle bug), and the alert carries no accessible name, so `candidateLocators` produced no candidate for it | Fixed by the `settle()` change plus the declared locator `loginErrorAlert` (`div[role="alert"]`) in the AUT profile |
| TC-002 | DATA — `{{placeholder}}` has no resolved value | The approved test case carries the literal token `{{placeholder}}` in its `testData` field — a template artifact from Agent 02 that Agent 03 passed. The step ("enters at least one character in each field") needs no test data | Correct the test case: clear that `testData` field, or give it a real named placeholder |

## Findings from reviewing `tests/projects/nexolvi/specs/Login.spec.ts` (2026-09-18)

7. **The dashboard is served at the same address as the login page.** Signing in successfully leaves the browser at
   `/` — Nexo Desk swaps the view without changing the route. So a URL is never evidence of which state the
   application is in: `await expect(page).toHaveURL('/')` holds on the login page AND on the dashboard, and an
   expected result phrased as "remains on the login page at <base url>" cannot be asserted with the URL alone.
   Prove the login state with a login-form member (`welcomeToNexolviHeading`, `signInButton`) or with
   `loginErrorAlert`, and prove the dashboard with `dashboardHeading`. See generic UI learnings 14 and 15.
8. **Both states share one entry in the page map.** Because both render at `/`, discovery recorded the login form
   and the post-login shell (`dashboardHeading`, `nexolviLogoImage`, the product buttons, `bButton`) as one state
   named `start`, so every `(state: start)` comment in `LoginPage.ts` is wrong for the dashboard members, and
   `verifiedStates[*].urlPath` is `/` for every step of every test case. Treat the state annotation of those
   members as unverified; never derive a URL assertion from them.
9. **Credentials reached the spec as literals, and one of them changed what the test covers.** In the approved
   test cases, TC-007 step 2 gives the account email as literal text and TC-006 step 2 gives `'admin'` as the
   "valid password"; neither was tokenised by Agent 04, so both were inlined into the spec. The literal email is
   the real `NEXOLVI_EMAIL` value — a credential committed to the repository. The literal password is NOT the
   `NEXOLVI_PASSWORD` value, so TC-006 submits an invalid email with an invalid password: it stops covering AC-5
   and becomes a duplicate of TC-008. Fix the test cases to use `{{validEmail}}` / `{{validPassword}}`; per
   generic UI learning 13 and discovery learning 5, such a step is now NEEDS_CONTEXT / NOT_ACHIEVABLE rather than
   an inlined literal.
10. **A test that does not authenticate must not spend the real credentials.** TC-003, TC-004, TC-011 and TC-012
    only check masking, the eye toggle and the disabled Sign In button, yet their approved bindings are
    `{{validPassword}}` / `{{validEmail}}`, so the spec fills `env('NEXOLVI_PASSWORD')` / `env('NEXOLVI_EMAIL')`.
    That puts the production password into traces and screenshots of tests that never sign in, and makes those
    four tests unrunnable wherever the secrets are not provisioned. The binding is Agent 02/04's to change
    (`{{anyPassword}}` / `{{anyEmail}}`); Agent 05 follows whatever the approved test case binds.
