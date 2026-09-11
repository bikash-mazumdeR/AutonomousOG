# SKILL: Auto Healer
## Agent ID: 10-auto-healer
## Version: 1.0.0

## Purpose
Automatically diagnose and repair failing Playwright tests without human intervention.

## Healing Strategies (Priority Order)
1. SELECTOR_HEAL    — Replace broken locators using memory patterns or fallback chain
2. WAIT_ADJUSTMENT  — Replace hardcoded waits with smart state-based waits
3. ASSERTION_RELAX  — Relax strict assertions (toHaveText → toContainText)
4. RETRY_NETWORK    — Tag network failures for clean retry by Agent 11
5. DATA_FIX         — Add optional chaining for null/undefined data access

## Locator Fallback Chain
1. getByRole('button', { name })  ← Try first
2. getByRole('link',   { name })
3. getByLabel(name)
4. getByPlaceholder(name)
5. getByText(name)               ← Last resort

## Memory Integration
- BEFORE: Load selectorPatterns → use known-good healed selectors
- BEFORE: Load healingStrategies → apply top-10 most successful patterns
- AFTER:  Record every successful heal with successRate=0.8
- AFTER:  Record confirmed heals (passing in Agent 11 retest) with successRate=1.0

## Healing Rate Calculation
healingRate = (healed / totalFailed) × 100
Stored in memory.metrics.avgHealingRate (rolling average).

## Auto-Patch File Operations
- All patches are applied directly to the spec/POM file in tests/
- Original content is overwritten (git history preserves rollback)
- Patch action is logged to console and audit trail
