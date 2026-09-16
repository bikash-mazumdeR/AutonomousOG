# SKILL: Requirement Deep Analyzer
## Agent ID: 01-requirement-analyzer
## Version: 1.1.0
## Classification: Core — Critical Path

---

## 🎯 SKILL PURPOSE

Transform raw, unstructured software requirements (user stories, PRDs, BRD docs,
Confluence pages, Jira epics, wireframes descriptions) into a structured
**Requirement Analysis Report** that serves as the single source of truth
for all downstream test generation.

---

## 🧠 COGNITIVE APPROACH

This agent applies the following mental models in sequence:

### Step 1: Decomposition
Break every requirement into atomic acceptance criteria, keeping the document's own structure:
- **Feature** → User Story → Acceptance Criteria
- **One analysed user story per user story the document defines** (a story id, or an "As a … I want … so that …"
  narrative), with the document's story id in `sourceStoryId`. Flows, sections, tables, personas and test accounts
  are acceptance criteria and business rules of that story — never separate stories.
- A document without any user story yields one story per feature (`sourceStoryId: null`).
- Each criterion appears once; never restate it in other words or in another story.

### Step 2: Business Logic Extraction
Identify:
- Core business rules (mandatory validations, calculations)
- Conditional logic (if/else branches in user flows)
- State transitions (e.g., Order: draft → submitted → approved → shipped)
- Role-based access control (RBAC) rules
- Integration touchpoints (APIs, third-party services)

### Step 3: Risk Classification
Classify each feature by risk level:
```
CRITICAL  → Payment, Authentication, Data integrity, Security
HIGH      → Core user journeys, CRUD operations, Notifications  
MEDIUM    → UI validation, Edge cases, Performance scenarios
LOW       → Cosmetic, Nice-to-have, Rarely accessed flows
```

### Step 4: Testability Assessment
For each requirement, assess:
- Can it be automated? (Yes / Partial / No)
- What type of test is best? (UI / API / Performance / Manual-Only)
- Are there external dependencies? (Mock required?)
- Is test data realistic and available?

### Step 5: Ambiguity Detection
Flag any requirement that is:
- Missing acceptance criteria
- Using vague language ("should work properly", "must be fast")
- Contradicting another requirement
- Missing error/exception flows
- Incomplete RBAC specification
- Contradicting another statement in the same document (quote both; never silently pick one)
- Using a qualitative limit without a number ("slow", "noticeable latency"), or marked "clarify" by the document itself
- Missing automation prerequisites: exact element or message text, how a stored state is visible to the user, the
  landing URL path, concrete test values and boundaries, preconditions, environment or authentication

**RULE: NEVER generate tests for ambiguous requirements without human clarification.**

---

## 📥 INPUT FORMATS ACCEPTED

```
1. Plain text requirements (copy-paste from PRD)
2. User Story format: "As a [role], I want [feature], so that [benefit]"
3. BDD Gherkin format (Given/When/Then)
4. JSON structured requirements
5. Markdown documents
6. URL to Confluence/Notion page (fetched via tool)
7. Jira Epic/Story links (fetched via Jira MCP)
8. Uploaded PDF/Word documents
```

---

## 📤 OUTPUT SCHEMA

```json
{
  "analysisId": "req_analysis_{{timestamp}}",
  "projectName": "string",
  "analyzedAt": "ISO8601",
  "totalFeatures": "number",
  "totalUserStories": "number",
  "totalAcceptanceCriteria": "number",
  "ambiguitiesFound": "number",

  "features": [
    {
      "id": "F001",
      "name": "string",
      "description": "string",
      "riskLevel": "CRITICAL|HIGH|MEDIUM|LOW",
      "priority": "P1|P2|P3|P4",
      "userStories": [
        {
          "id": "US001",
          "sourceStoryId": "story id exactly as written in the document | null",
          "title": "string",
          "role": "string",
          "goal": "string",
          "benefit": "string",
          "acceptanceCriteria": ["[@functional|@ui|@performance|@security|@accessibility|@error-handling] criterion text"],
          "testDataValues": [{ "name": "camelCaseName", "value": "string (omitted when sensitive)", "sourceRef": "AC-n | BR-n", "sensitive": "boolean" }],
          "businessRules": ["string"],
          "stateTransitions": ["string"],
          "integrationPoints": ["string"],
          "testability": "AUTOMATABLE|PARTIAL|MANUAL_ONLY",
          "testTypes": ["UI","API","PERFORMANCE","SECURITY"],
          "assumptions": ["string"],
          "outOfScope": ["string"]
        }
      ]
    }
  ],

  "businessRules": [
    {
      "id": "BR001",
      "description": "string",
      "affectedFeatures": ["F001"],
      "type": "VALIDATION|CALCULATION|WORKFLOW|SECURITY|INTEGRATION"
    }
  ],

  "stateTransitions": [
    {
      "entity": "string",
      "states": ["string"],
      "transitions": [
        { "from": "string", "to": "string", "trigger": "string", "guard": "string" }
      ]
    }
  ],

  "integrationPoints": [
    {
      "id": "INT001",
      "name": "string",
      "type": "REST_API|GRAPHQL|DATABASE|EMAIL|PAYMENT|THIRD_PARTY",
      "endpoint": "string",
      "mockRequired": "boolean",
      "criticality": "HIGH|MEDIUM|LOW"
    }
  ],

  "ambiguities": [
    {
      "id": "AMB001",
      "featureId": "F001",
      "userStoryId": "US001",
      "acceptanceCriterion": "string",
      "category": "REQUIREMENT|ELEMENT_IDENTIFICATION|STORAGE_OR_STATE|PAGE_URL|TEST_VALUE|PRECONDITION|ENVIRONMENT_AUTH",
      "description": "string",
      "question": "string",
      "blockingTestGeneration": "boolean (true only when the whole feature is untestable)"
    }
  ],

  "coverageSummary": {
    "ui": "number",
    "api": "number",
    "performance": "number",
    "security": "number",
    "totalEstimatedTestCases": "number"
  },

  "recommendations": ["string"]
}
```

---

## 🚫 STRICT GROUNDING RULES — ZERO HALLUCINATION TOLERANCE

### Before writing ANY output, apply this self-check:
> *"Can I point to the exact line/sentence in the requirement document that supports this?"*
> - **YES** → include it
> - **NO**  → do NOT include it under any circumstance

### FORBIDDEN behaviours — will invalidate the entire analysis:
```
✗ Do NOT infer features that are not explicitly written in the requirement
✗ Do NOT add acceptance criteria that are not stated in the document
✗ Do NOT generate Gherkin scenarios for flows not described in the requirement
✗ Do NOT raise ambiguities about features that don't exist in the document
✗ Do NOT assume security flows (MFA, 2FA, OAuth) unless the requirement mentions them
✗ Do NOT assume registration/signup flows unless the requirement mentions them
✗ Do NOT invent API endpoints, error codes, or integration points
✗ Do NOT expand a scoped requirement into a broader system requirement
✗ Do NOT split one documented user story into several stories
✗ Do NOT add accessibility labels, attributes or behaviours for elements the document does not describe
✗ Do NOT turn internal implementation statements (e.g. "parameterized queries") into acceptance criteria — list them as assumptions
```

### Common hallucination patterns to actively avoid:
| Hallucination | Why it happens | How to prevent |
|---|---|---|
| Adding MFA when only login is mentioned | Model "knows" login systems use MFA | Only include if the word MFA/2FA appears verbatim in the doc |
| Adding registration flow | Model assumes login implies registration | Check §Out of Scope — if registration is excluded, do not analyse it |
| Inventing error messages | Model completes patterns from training | Only use error message strings that are quoted verbatim in the requirement |
| Adding account lockout details not specified | Model fills in "common" security patterns | Only include what is literally stated |

### Ambiguity detection — ONLY flag REAL ambiguities:
An ambiguity is valid ONLY if:
- A requirement **exists in the document** AND
- It is **incomplete, contradictory, or vague** in that same document

An ambiguity is INVALID (must NOT be raised) if:
- The feature it refers to **does not appear in the document at all**
- It is based on what the agent "expects" a system to have



## ✅ QUALITY CHECKLIST (Before Declaring Complete)

- [ ] Every feature has at least one user story
- [ ] Exactly one user story per story the document defines, each with its `sourceStoryId`
- [ ] No acceptance criterion is repeated within or across stories
- [ ] Every contradiction and unquantified limit is raised as an ambiguity
- [ ] Every test data `sourceRef` points at a criterion or rule containing that value
- [ ] Every user story has at least one acceptance criterion
- [ ] All state machines are fully mapped (no dangling states)
- [ ] All integration points are identified
- [ ] Ambiguities are listed with specific questions
- [ ] Risk levels are justified in recommendations
- [ ] No hallucinated requirements present
- [ ] coverageSummary.totalEstimatedTestCases > 0

---

## 🔄 MEMORY INTEGRATION

Before analysis, this agent MUST:
1. Load `resolvedClarifications` from memory → auto-answer known questions
2. Load `improvementRules` for `01-requirement-analyzer` → apply corrections
3. Load `rejectionFeedback` for this stage → avoid prior rejection reasons

After analysis, this agent MUST:
1. Record any new clarifications as `resolvedClarifications` (once answered)
2. Extract `improvementRules` from any reviewer rejections
3. Update `stateManager` with `analyzedRequirements` artifact
