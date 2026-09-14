/**
 * @fileoverview Unit tests for the Agent 04 test data freshness check, which keeps manifests from an
 * earlier review or pipeline run from being shown, edited or approved.
 */

import {
  approvedTestCaseKeys,
  assessTestDataFreshness,
  loadCurrentTestData,
} from '../../core/state-manager/TestDataFreshness';

describe('Agent 04 test data freshness', () => {
  const review = {
    reviewId: 'review-2',
    reviewedZephyrExport: {
      testCases: [
        { key: 'TC-001' },
        { key: 'TC-002', reviewStatus: 'REJECTED' },
        { key: 'TC-003', selected: false },
        { key: 'TC-004' },
      ],
    },
  };
  const artifact = (overrides: Record<string, any> = {}) => ({
    manifest: { manifestId: 'tdm_1', sourceReviewId: 'review-2', perTCData: { 'TC-001': {}, 'TC-004': {} }, ...overrides },
  });
  const completed = { status: 'COMPLETED' };

  it('lists only approved and selected test case keys', () => {
    expect(approvedTestCaseKeys(review)).toEqual(['TC-001', 'TC-004']);
  });

  it('accepts data generated for the current review by a completed stage', () => {
    expect(assessTestDataFreshness(artifact(), review, completed)).toEqual({ current: true, reason: '' });
  });

  it('rejects data when Agent 04 has not run in the current pipeline run', () => {
    const result = assessTestDataFreshness(artifact(), review, { status: 'PENDING' });
    expect(result.current).toBe(false);
    expect(result.reason).toContain('PENDING');
  });

  it('rejects data generated from a different review', () => {
    const result = assessTestDataFreshness(artifact({ sourceReviewId: 'review-1' }), review, completed);
    expect(result.current).toBe(false);
    expect(result.reason).toContain('review-1');
  });

  it('rejects legacy manifests whose test cases differ from the current review', () => {
    const legacy = artifact({ sourceReviewId: undefined, perTCData: { 'TC-001': {}, 'TC-021': {} } });
    expect(assessTestDataFreshness(legacy, review, completed).current).toBe(false);
  });

  it('reports missing test data', () => {
    expect(assessTestDataFreshness(null, review, completed).current).toBe(false);
  });

  it('withholds stale data when loading from state', async () => {
    const fakeStateManager = {
      get: async () => ({ status: 'PENDING' }),
      getPipelineArtifact: async (key: string) => (key === 'testData' ? artifact() : review),
    };
    const loaded = await loadCurrentTestData(fakeStateManager);
    expect(loaded.testData).toBeNull();
    expect(loaded.stored).toBeTruthy();
    expect(loaded.freshness.current).toBe(false);
  });
});
