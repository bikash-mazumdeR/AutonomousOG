'use strict';

/**
 * @fileoverview Normalises Agent 01 ambiguities (LLM output) and turns open ones into clarifications owned by Agent 01,
 * deduplicated by feature and question wording.
 */

import { ClarificationRequest } from '../../core/clarifications/ClarificationStore';
import { OWNING_STAGE } from '../../core/readiness/ownership';
import { MissingKind } from '../../core/readiness/readinessTypes';

/** @enum {string} What an ambiguity is about. */
export const AMBIGUITY_CATEGORY = Object.freeze({
  REQUIREMENT: 'REQUIREMENT',
  ELEMENT_IDENTIFICATION: 'ELEMENT_IDENTIFICATION',
  STORAGE_OR_STATE: 'STORAGE_OR_STATE',
  PAGE_URL: 'PAGE_URL',
  TEST_VALUE: 'TEST_VALUE',
  PRECONDITION: 'PRECONDITION',
  ENVIRONMENT_AUTH: 'ENVIRONMENT_AUTH',
} as const);

const CATEGORY_KINDS: Readonly<Record<string, MissingKind>> = Object.freeze({
  [AMBIGUITY_CATEGORY.REQUIREMENT]: 'EXPECTED_RESULT',
  [AMBIGUITY_CATEGORY.ELEMENT_IDENTIFICATION]: 'LOCATOR',
  [AMBIGUITY_CATEGORY.STORAGE_OR_STATE]: 'UNASSERTABLE',
  [AMBIGUITY_CATEGORY.PAGE_URL]: 'EXPECTED_RESULT',
  [AMBIGUITY_CATEGORY.TEST_VALUE]: 'DATA',
  [AMBIGUITY_CATEGORY.PRECONDITION]: 'PRECONDITION',
  [AMBIGUITY_CATEGORY.ENVIRONMENT_AUTH]: 'AUTH',
});

const AMBIGUITY_RULE_PREFIX = 'AMBIGUITY_';

/**
 * Case-, punctuation- and whitespace-insensitive form of a question (used to match answers and deduplicate).
 * @param {string} text
 * @returns {string}
 */
export function normalizeQuestion(text: string): string {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function toCategory(value: unknown): string {
  const category = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return Object.prototype.hasOwnProperty.call(AMBIGUITY_CATEGORY, category) ? category : AMBIGUITY_CATEGORY.REQUIREMENT;
}

/**
 * Fills ids, feature ids and categories and turns `blockingTestGeneration` into a real boolean.
 * @param {any[]} raw - LLM ambiguities
 * @param {any[]} features - Analysed features (the first one is the default owner)
 * @returns {any[]}
 */
export function normalizeAmbiguities(raw: any[], features: any[]): any[] {
  const defaultFeatureId = String(features?.[0]?.id || '');
  return (raw || [])
    .filter((amb) => amb && String(amb.question || amb.description || '').trim())
    .map((amb, idx) => ({
      ...amb,
      id: String(amb.id || `AMB-${String(idx + 1).padStart(2, '0')}`),
      featureId: String(amb.featureId || defaultFeatureId),
      category: toCategory(amb.category),
      question: String(amb.question || amb.description).trim(),
      blockingTestGeneration: amb.blockingTestGeneration === true || String(amb.blockingTestGeneration).toLowerCase() === 'true',
    }));
}

/**
 * Clarification request for an open ambiguity.
 * @param {any} ambiguity - Normalised ambiguity
 * @param {string} inputFingerprint - Analysis input fingerprint (questions from other inputs become stale)
 * @returns {ClarificationRequest}
 */
export function clarificationRequestFor(ambiguity: any, inputFingerprint: string): ClarificationRequest {
  return {
    sourceStage: OWNING_STAGE.REQUIREMENTS,
    owningStage: OWNING_STAGE.REQUIREMENTS,
    kind: CATEGORY_KINDS[ambiguity.category] || CATEGORY_KINDS[AMBIGUITY_CATEGORY.REQUIREMENT],
    ruleId: `${AMBIGUITY_RULE_PREFIX}${ambiguity.category}`,
    featureId: ambiguity.featureId || undefined,
    requirementRef: ambiguity.userStoryId || undefined,
    subject: `${ambiguity.featureId || ''}|${normalizeQuestion(ambiguity.question)}`,
    question: ambiguity.question,
    context: { ambiguityId: ambiguity.id, description: ambiguity.description, acceptanceCriterion: ambiguity.acceptanceCriterion },
    subjectHash: inputFingerprint,
  };
}
