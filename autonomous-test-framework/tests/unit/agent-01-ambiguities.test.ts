/**
 * @fileoverview Unit tests for Agent 01 ambiguity normalisation and clarification requests.
 */

import { clarificationRequestFor, normalizeAmbiguities } from '../../agents/01-requirement-analyzer/ambiguities';

describe('Agent 01 ambiguities', () => {
  it('fills ids, feature ids and categories and makes the blocking flag a real boolean', () => {
    const [urlQuestion] = normalizeAmbiguities([{ question: 'Which URL path does the user land on?', category: 'page_url', blockingTestGeneration: 'true' }], [{ id: 'F-01' }]);
    expect(urlQuestion).toMatchObject({
      id: 'AMB-01', featureId: 'F-01', category: 'PAGE_URL', blockingTestGeneration: true,
    });
    const [fallback] = normalizeAmbiguities([{ description: 'The error wording is not stated', category: 'unknown' }], []);
    expect(fallback).toMatchObject({ category: 'REQUIREMENT', question: 'The error wording is not stated', blockingTestGeneration: false });
    expect(normalizeAmbiguities([{ id: 'AMB-09' }, null], [])).toEqual([]);
  });

  it('builds a clarification owned by Agent 01 that deduplicates rewordings of the same question', () => {
    const [ambiguity] = normalizeAmbiguities([{
      id: 'AMB-03', featureId: 'F-01', userStoryId: 'US-01', category: 'TEST_VALUE', question: 'Is a 255-character username accepted?',
    }], []);
    const request = clarificationRequestFor(ambiguity, 'fingerprint-1');
    expect(request).toMatchObject({
      sourceStage: '01-requirement-analyzer',
      owningStage: '01-requirement-analyzer',
      kind: 'DATA',
      ruleId: 'AMBIGUITY_TEST_VALUE',
      featureId: 'F-01',
      requirementRef: 'US-01',
      subjectHash: 'fingerprint-1',
      context: { ambiguityId: 'AMB-03' },
    });
    expect(clarificationRequestFor({ ...ambiguity, question: 'is a 255 character username accepted' }, 'fingerprint-2').subject).toBe(request.subject);
  });
});
