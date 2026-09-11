# LEARNINGS: Automation Code Reviewer (Agent 06)
## Version: 1.0.0

---

## 1. Pre-Execution Logical Consistency Review (Negative/Edge Assertion Contradictions)
* **Issue:** Script generators frequently generate negative or boundary tests that fill an invalid or unregistered credential/boundary string, but then copy-paste assertions expecting successful navigation (`expect(inventoryContainer).toBeVisible()` or `expect(page).toHaveURL(/inventory/)`).
* **Review Rule:** When reviewing any test titled or tagged with `[NEG]`, `[EDGE]`, `negative`, or testing boundary/invalid credentials:
  1. Inspect the test body assertions.
  2. If the test asserts `inventoryContainer.toBeVisible()` or positive page redirects instead of asserting the error banner/message, flag as **BLOCKER** (`ASSERT-003`).
  3. Suggest changing the assertion to verify `errorMessage.toBeVisible()` and `errorMessage.toContainText(...)`.

---

## 2. Playwright Strict Mode & Container Locator Hygiene
* **Issue:** Page Object getters using generic IDs (e.g. `this.page.locator('#inventory_container')`) resolve to multiple DOM elements when an application nests containers sharing the same ID, causing Playwright strict mode violations.
* **Review Rule:**
  1. Flag single `#id` locators on common container elements that lack `.first()`.
  2. Recommend using explicit data attributes (`[data-test="inventory-container"]`) with `.first()` or auto-patch to `.first()`.

---

## 3. TestId Attribute Alignment & Locator Fallbacks
* **Issue:** Single-attribute `this.page.getByTestId('username')` fails when the AUT uses `data-test="username"` and `playwright.config.ts` expects `data-testid`.
* **Review Rule:**
  1. Flag single-attribute `getByTestId` in Page Objects (`LOC-003`).
  2. Auto-patch or suggest resilient multi-attribute fallbacks:
     `this.page.locator('[data-test="username"], [data-testid="username"], #user-name')`.

---

## 4. Computed Style Background vs Font Color Verification
* **Issue:** Alert banners often display white text (`color: rgb(255, 255, 255)`) on a red background container (`background-color: rgb(226, 35, 26)`). Tests asserting `color` on the banner or evaluating on the child text node fail.
* **Review Rule:**
  1. Ensure visual alert tests inspect `el.parentElement` background color as well as `el` color.
  2. Recommend matching RGB hue channels (`bg.includes('226')`) rather than fragile single-shade equality.

---

## 5. Traceable Obsolete/Unimplemented Test Handling
* **Issue:** Tests verifying requirements that the AUT's current build does not implement (such as missing `aria-label` attributes) fail repeatedly in CI pipelines.
* **Review Rule:**
  1. Verify that tests covering confirmed missing AUT capabilities are gracefully handled using `test.skip(true, 'Obsolete: ...')` with `@obsolete` tag.
  2. Ensure the `TC Key` annotation is retained so traceability and test completeness requirements (`COMPLETENESS-001`) remain satisfied.
