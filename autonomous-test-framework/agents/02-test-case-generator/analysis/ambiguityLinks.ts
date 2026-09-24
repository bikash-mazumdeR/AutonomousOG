'use strict';

/**
 * @fileoverview Links open Agent 01 ambiguities to the test cases they leave undecided. The prompt tells the model to
 * skip behaviour an open ambiguity leaves undecided, but a test case covering an ambiguous criterion is still generated;
 * recording the open question on it lets Agent 03 hold it until the question is answered, instead of trusting a guess.
 */

import { TestCase } from '../../../core/types';
import { NormalizedFeature, NormalizedStory, OpenAmbiguity } from './normalizeAnalysis';

const CATEGORY_PREFIX = /^\s*\[@?[a-z0-9_-]+\]\s*/i;

/** Lower-case words only, so the criterion Agent 01 quoted matches the one Agent 02 normalised. */
function criterionKey(text: string): string {
  return String(text || '').replace(CATEGORY_PREFIX, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The acceptance criteria of a story each open ambiguity is about, matched on the criterion text Agent 01 quoted.
 * An ambiguity that names no criterion, or one this story does not have, links to nothing.
 * @param {NormalizedFeature} feature
 * @param {NormalizedStory} story
 * @param {OpenAmbiguity[]} ambiguities - Non-blocking open ambiguities
 * @returns {Map<string, OpenAmbiguity[]>} Criterion id (e.g. "AC-3") → the open ambiguities about it
 */
export function ambiguousCriteria(feature: NormalizedFeature, story: NormalizedStory, ambiguities: OpenAmbiguity[]): Map<string, OpenAmbiguity[]> {
  const byCriterion = new Map<string, OpenAmbiguity[]>();
  const relevant = ambiguities.filter((amb) => (!amb.featureId || amb.featureId === feature.id)
    && (!amb.userStoryId || amb.userStoryId === story.id) && amb.criterionText);
  for (const amb of relevant) {
    const key = criterionKey(amb.criterionText as string);
    const criterion = story.acceptanceCriteria.find((ac) => {
      const acKey = criterionKey(ac.text);
      return Boolean(key && acKey) && (acKey === key || acKey.includes(key) || key.includes(acKey));
    });
    if (criterion) byCriterion.set(criterion.id, [...(byCriterion.get(criterion.id) || []), amb]);
  }
  return byCriterion;
}

/**
 * Records on each test case the open questions its covered criteria depend on, and reports them for the gate.
 * Updates the test cases in place.
 * @param {TestCase[]} testCases
 * @param {NormalizedFeature[]} features
 * @param {OpenAmbiguity[]} ambiguities - Non-blocking open ambiguities
 * @returns {string[]} One warning per open question that leaves generated test cases undecided
 */
export function linkOpenAmbiguities(testCases: TestCase[], features: NormalizedFeature[], ambiguities: OpenAmbiguity[]): string[] {
  const warnings: string[] = [];
  for (const feature of features) {
    for (const story of feature.userStories) {
      const byCriterion = ambiguousCriteria(feature, story, ambiguities);
      const storyTCs = testCases.filter((tc) => tc.featureId === feature.id && tc.userStoryId === story.id);
      for (const [criterionId, open] of byCriterion) {
        const covering = storyTCs.filter((tc) => tc.requirementRefs.includes(criterionId));
        if (covering.length === 0) continue;
        for (const tc of covering) {
          const known = new Set((tc.openQuestions || []).map((q) => q.ambiguityId));
          tc.openQuestions = [...(tc.openQuestions || []), ...open.filter((amb) => !known.has(amb.id)).map((amb) => ({
            ambiguityId: amb.id, question: amb.question, ...(amb.clarificationId ? { clarificationId: amb.clarificationId } : {}),
          }))];
        }
        open.forEach((amb) => warnings.push(`[${feature.id}/${story.id}] ${amb.id} is still open and leaves ${criterionId} undecided; `
          + `${covering.map((tc) => tc.key).join(', ')} cover it and ${amb.clarificationId
            ? 'are held at review until it is answered'
            : 'must be checked by hand — the analysis records no clarification to hold them on'}: "${amb.question}"`));
      }
    }
  }
  return warnings;
}
