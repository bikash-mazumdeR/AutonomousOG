# LEARNINGS: Automation Contract Reviewer (Agent 06)
## Version: 2.0.0

Generic, application-agnostic lessons. They refine the review in `skills/code-review.md` and never contradict the
Agent 05 contract (no skips, soft or conditional assertions, try/catch, positional or multi-selector locators, or
hard waits). Application-specific notes do not belong here.

---

## 1. Negative tests must assert the failure, not the success state
When a test's steps use invalid, missing or boundary data, check that its assertions verify the error or rejection
the step expects. A negative test that asserts a success navigation or a success-only element is a defect — cite the
line and the expected result it contradicts.

## 2. Assertions verify the step they are mapped to
An assertion whose value differs from the approved expected result (different text, URL path, count or colour) is a
genuine defect, even when it would make the test pass against the current application. Report it; never suggest
adapting the expectation to observed behaviour.

## 3. Visual expectations target the element the test case names
If a step specifies the styling of a container (for example an alert's background colour), the assertion must target
that container and that CSS property, using the exact value from the test case — not the text colour of a child.

## 4. Unimplemented behaviour fails visibly
Tests for behaviour the application does not implement must fail, or be held or excluded during test case review in
Agent 03. Never recommend skipping, fixme or obsolete tagging to make a run pass.
