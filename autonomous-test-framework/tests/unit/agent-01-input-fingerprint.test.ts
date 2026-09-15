import { computeInputFingerprint, findReusableAnalysis, AnalysisInputs } from '../../agents/01-requirement-analyzer/inputFingerprint';

const inputs = (overrides: Partial<AnalysisInputs> = {}): AnalysisInputs => ({
  rawRequirements: '# Login\nUsers log in with a username and password.',
  skill: 'skill',
  resolvedClarifications: [],
  improvementRules: [],
  ...overrides,
});

describe('Agent 01 — input fingerprint', () => {
  it('is stable for identical inputs and ignores line-ending differences', () => {
    const crlf = inputs({ rawRequirements: '# Login\r\nUsers log in with a username and password.' });
    expect(computeInputFingerprint(inputs())).toBe(computeInputFingerprint(inputs()));
    expect(computeInputFingerprint(crlf)).toBe(computeInputFingerprint(inputs()));
  });

  it('changes when requirements, skill or answered clarifications change', () => {
    const base = computeInputFingerprint(inputs());
    expect(computeInputFingerprint(inputs({ rawRequirements: '# Login\nUsers sign in.' }))).not.toBe(base);
    expect(computeInputFingerprint(inputs({ skill: 'updated skill' }))).not.toBe(base);
    expect(computeInputFingerprint(inputs({ resolvedClarifications: [{ question: 'Trim username?', answer: 'No' }] }))).not.toBe(base);
  });

  it('does not depend on the order of answers or rules', () => {
    const answers = [{ question: 'Trim username?', answer: 'No' }, { question: 'Landing path?', answer: '/home' }];
    expect(computeInputFingerprint(inputs({ resolvedClarifications: answers })))
      .toBe(computeInputFingerprint(inputs({ resolvedClarifications: [...answers].reverse() })));
  });

  it('ignores volatile memory bookkeeping fields', () => {
    const rule = { id: 'RULE-1', description: 'Strict gate', activeCount: 0, addedAt: '2026-09-10' };
    expect(computeInputFingerprint(inputs({ improvementRules: [rule] })))
      .toBe(computeInputFingerprint(inputs({ improvementRules: [{ ...rule, activeCount: 9, addedAt: '2026-09-15' }] })));
  });

  it('reuses only a matching, non-empty previous analysis as a deep copy', () => {
    const fingerprint = computeInputFingerprint(inputs());
    const previous = { inputFingerprint: fingerprint, features: [{ id: 'F-01', userStories: [] }] };
    const reused = findReusableAnalysis(previous, fingerprint);
    expect(reused).toEqual(previous);
    expect(reused).not.toBe(previous);
    expect(findReusableAnalysis({ ...previous, inputFingerprint: 'different' }, fingerprint)).toBeNull();
    expect(findReusableAnalysis({ inputFingerprint: fingerprint, features: [] }, fingerprint)).toBeNull();
    expect(findReusableAnalysis(null, fingerprint)).toBeNull();
  });
});
