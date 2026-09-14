# Project notes — ARIA Project (Swag Labs) · Agent 05 UI

These notes apply ONLY to this project. They have LOWER authority than the approved test case and
the verified page contract: they never change an expected result, a test value or a locator.

1. Authentication is handled client-side. Logging in does not issue an HTTP POST request, so tests
   must not wait for network requests after submitting the login form; assert the resulting UI state.
2. Only pre-registered accounts can log in. Any other username/password combination produces the
   credentials-mismatch error shown on the login form.
3. Some containers are rendered as an outer wrapper and an inner element that share an id. Always use
   the unique locator recorded in the page map; never select by that shared id.
4. The login error banner styles the colour on its container element. When a test case states an error
   colour, assert the property the test case names on the element the page contract identifies — and
   assert the colour value exactly as written in the test case (a different rendered colour is a
   genuine failure to report, not a value to accept).
