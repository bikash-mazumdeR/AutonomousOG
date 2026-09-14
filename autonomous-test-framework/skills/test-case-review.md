# SKILL: Test Case Reviewer
## Agent ID: 03-test-case-reviewer
## Version: 1.0.0
## Classification: Core — Critical Path

---

## 🎯 SKILL PURPOSE

Perform a structured, multi-dimensional quality review of all test cases
produced by Agent 02. The reviewer acts as a **Senior QA Lead** performing
a peer review — catching gaps, duplicates, ambiguous steps, missing coverage,
and traceability violations before test cases are approved for execution.

The output is an **annotated, scored, and corrected** Zephyr export ready
for Agent 04 (Test Data Generator).

---

## 🧠 REVIEW DIMENSIONS

### Dimension 1: Completeness Review
```
For EVERY test case verify:
□ name is concise, action-oriented, and unique
□ objective clearly states WHAT is being verified
□ precondition is specific and testable
□ at least 2 test steps present
□ every step has a non-empty expectedResult
□ no step uses vague language ("verify it works", "check something")
□ testData is populated (or explicitly marked N/A)
□ featureId and userStoryId are valid
□ requirementRefs (AC-N / BR-N) exist on the user story
```

### Dimension 2: Coverage Adequacy Review
```
For EVERY feature/user story verify:
□ ≥1 positive TC exists
□ ≥1 negative TC exists
□ ≥1 edge TC exists (for CRITICAL/HIGH risk)
□ API TCs exist only for documented endpoints and use the documented status codes
□ No acceptance criterion is orphaned (no TC lists it in requirementRefs)
□ CRITICAL features have smoke-labelled TCs
□ State transitions each have a TC
```

### Dimension 3: Duplicate Detection
```
Flag as DUPLICATE if:
□ Same name (case-insensitive)
□ Same hash (identical step content)
□ >80% step overlap with another TC in same folder
Action: Mark DUPLICATE, keep highest-quality version, remove other
```

### Dimension 4: Step Quality Review
```
Each step is scored 1–5:
5 = Specific action + exact data + measurable expected result
4 = Specific action + placeholder data + measurable result
3 = Generic action + placeholder + vague result
2 = Vague action + missing data + vague result
1 = Unusable — rewrites required

Steps scoring ≤2 are REWRITTEN by this agent.
Steps scoring 3 are FLAGGED with a recommendation.
```

### Dimension 5: Data Placeholder Validation
```
Valid placeholders: {{camelCaseVar}} format only
Invalid (flag for correction):
□ <variable> (angle bracket format)
□ [value] (bracket format)
□ "your value here" (literal English)
□ blank/empty where data is clearly needed
□ hardcoded PII (real emails, real passwords)
```

### Dimension 6: API Test Case Review
```
For every API TC verify:
□ method matches the operation (GET for read, POST for create, etc.)
□ expectedStatusCode is realistic (not just 200 for everything)
□ requestBody structure is logical
□ endpoint and expectedStatusCode come from the documented integration point / requirement
□ negative API TCs don't share same expectedStatusCode as positive
□ Auth (401) and RBAC (403) tests exist only when the requirements document them
```

### Dimension 7: Performance TC Review
```
For every Performance TC verify:
□ scenario is one of: load | stress | spike | soak
□ targetEndpoint is not '{{targetEndpoint}}' (must be resolved or flagged)
□ VUs, duration and thresholds come from the global K6_CONFIG (not stored per TC)
```

### Dimension 8: Traceability Review
```
□ Every TC links to a valid featureId (exists in requirements)
□ Every TC links to a valid userStoryId (exists in requirements)
□ No TC is created for a userStory that was MANUAL_ONLY
□ Orphaned TCs (no traceability) → flagged as ORPHANED
```

---

## 📤 OUTPUT SCHEMA

```json
{
  "reviewId":       "tc_review_{{timestamp}}",
  "reviewedAt":     "ISO8601",
  "reviewedBy":     "ARIA-Agent-03",
  "originalCount":  0,
  "approvedCount":  0,
  "rejectedCount":  0,
  "rewrittenCount": 0,
  "duplicatesRemoved": 0,

  "reviewedTestCases": [ /* Annotated ZephyrTestCase objects */ ],

  "reviewAnnotations": [
    {
      "tcKey":       "TC-001",
      "dimension":   "COMPLETENESS | COVERAGE | DUPLICATE | STEP_QUALITY | DATA | API | PERFORMANCE | TRACEABILITY",
      "severity":    "BLOCKER | MAJOR | MINOR | INFO",
      "finding":     "string — what was found",
      "action":      "REJECTED | REWRITTEN | FLAGGED | PASSED",
      "suggestion":  "string — how to fix"
    }
  ],

  "coverageMatrix": {
    "features": [
      {
        "featureId":   "F001",
        "featureName": "string",
        "riskLevel":   "CRITICAL",
        "positiveCount": 0,
        "negativeCount": 0,
        "edgeCount":     0,
        "apiCount":      0,
        "perfCount":     0,
        "hasSmoke":      false,
        "coverageScore": 0,
        "status":        "ADEQUATE | PARTIAL | INSUFFICIENT"
      }
    ]
  },

  "qualityScore": {
    "overall":       0,
    "completeness":  0,
    "coverage":      0,
    "stepQuality":   0,
    "traceability":  0,
    "dataQuality":   0,
    "grade":         "A | B | C | D | F"
  },

  "recommendations": ["string"],
  "blockers":        ["string"]
}
```

---

## 📊 QUALITY SCORING

```
Overall Score = weighted average of dimensions:
  Completeness  × 0.25
  Coverage      × 0.25
  Step Quality  × 0.20
  Traceability  × 0.15
  Data Quality  × 0.15

Grade mapping:
  A: 90–100  → Ready for test data generation
  B: 75–89   → Approved with minor warnings
  C: 60–74   → Approved with significant warnings — requires revisit after Agent 04
  D: 40–59   → Rejected — major rework required
  F: 0–39    → Rejected — regenerate test cases
```

---

## 🚦 REVIEW DECISION RULES

| Condition | Decision |
|---|---|
| Grade A or B | APPROVE — proceed to Agent 04 |
| Grade C | APPROVE WITH WARNINGS — flag for human review |
| Grade D or F | REJECT — return to Agent 02 with findings |
| Any BLOCKER finding | Always REJECT regardless of score |
| >30% TCs rewritten | Human must review rewrites |
| Coverage gaps on CRITICAL features | Always BLOCKER |

---

## 🚫 AGENT LIMITATIONS

1. Does NOT regenerate test cases from scratch — only reviews and rewrites steps
2. Does NOT change the test type or folder structure
3. Does NOT resolve unresolved ACs — flags them
4. Does NOT hallucinate expected results — uses "REQUIRES CLARIFICATION" marker

---

## ✅ REVIEW COMPLETION CHECKLIST

- [ ] All 8 review dimensions applied to every TC
- [ ] Duplicate hash check completed
- [ ] Coverage matrix built for every feature
- [ ] Quality score calculated and graded
- [ ] All BLOCKER findings listed separately
- [ ] Rewritten steps are marked with [REWRITTEN-BY-AGENT-03]
- [ ] reviewedTestCases has same or fewer TCs than input (duplicates removed)

---

## 🔄 MEMORY INTEGRATION

Before review:
1. Load `rejectionFeedback` for stage `03-test-case-reviewer` → detect recurring patterns
2. Load `improvementRules` → apply known corrections automatically

After review:
1. Record findings as `improvementRules` for Agent 02 → prevents recurrence
2. Store quality score trend in memory → track improvement over runs
