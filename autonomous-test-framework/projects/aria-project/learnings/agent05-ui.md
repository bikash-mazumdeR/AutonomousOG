# Project notes — ARIA Project (Swag Labs) · Agent 05 UI

These notes apply ONLY to this project. They have LOWER authority than the approved test case and
the verified page contract: they never change an expected result, a test value or a locator. When a note and the
approved test case disagree, the approved test case wins.

1. Authentication is handled client-side. Logging in does not issue an HTTP POST request, so tests
   must not wait for network requests after submitting the login form; assert the resulting UI state.
2. Only pre-registered accounts can log in. Any other username/password combination produces the
   credentials-mismatch error shown on the login form.
3. Some containers are rendered as an outer wrapper and an inner element that share an id. Always use
   the unique locator recorded in the page map; never select by that shared id.
4. The login error banner has three parts in the page contract:
   - `errorElement` — the message text (role "alert"); it has a transparent background, so never assert a colour on it.
   - `errorMessageContainer` — the container that carries the banner's background colour. A step such as
     `the error message container background-color is "#E2231A"` is exact: assert
     `toHaveCSS('background-color', …)` on `errorMessageContainer` with that value.
   - `errorButton` — the "Dismiss error" button. It is not an icon; never use it for an error icon.
5. Error icons appear inside the input fields only while an error is shown: `usernameErrorIcon` (Username field) and
   `passwordErrorIcon` (Password field). "An error icon is displayed in the Username field" is asserted with
   `toBeVisible()` on `usernameErrorIcon`, and likewise for the Password field.
6. Hedged colours are still not assertable: a step that says only "styled in red" or gives a colour marked
   "recommended" / "e.g." needs an EXPECTED_RESULT clarification. An exact value with a named CSS property (note 4) is
   not hedged.
7. The error text shown by the application is "Epic sadface: …" (one word, "sadface"). "Epic sad face" is not text on
   the page; a step that uses it needs clarification rather than an assertion.
