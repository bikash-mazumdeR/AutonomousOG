/**
 * @fileoverview Unit tests for Agent 04 word-based placeholder interpretation.
 */

import {
  RUNTIME_SENTINEL,
  deriveGenericValue,
  isSensitivePlaceholder,
  resolveByIntent,
  splitPlaceholderWords,
  toggleLetterCase,
} from '../../agents/04-test-data-generator/placeholderIntent';

describe('Agent 04 placeholder intent', () => {
  const values = { seed: 'ab12cd34', username: 'acme_user', password: 'hunter2' };
  const generic = { seed: 'ab12cd34', tcKey: 'TC-001', tcText: 'Login as admin' };

  it('splits camelCase placeholder names into words', () => {
    expect(splitPlaceholderWords('incorrectCaseUsername')).toEqual(['incorrect', 'case', 'username']);
    expect(splitPlaceholderWords('apiBaseURL')).toEqual(['api', 'base', 'url']);
  });

  it('matches whole words, so "valid" and "invalid" are not treated as ids', () => {
    expect(deriveGenericValue('validMandatoryInputs', generic)).toBeNull();
    expect(deriveGenericValue('invalidUsername', generic)).toBeNull();
    expect(deriveGenericValue('userId', generic)).toBe('aria_id_ab12cd34');
    expect(deriveGenericValue('userRole', generic)).toBe('admin');
    expect(deriveGenericValue('resetToken', generic)).toBe(RUNTIME_SENTINEL);
  });

  it('resolves negative, arbitrary and case-variant credentials', () => {
    expect(resolveByIntent('invalidUsername', values)?.value).toBe('aria_unknown_user_ab12cd34');
    expect(resolveByIntent('wrongPassword', values)?.value).toBe('Aria_Wrong_ab12cd34!');
    expect(resolveByIntent('anyPassword', values)?.value).toBe('Aria_Sample_ab12cd34!');
    expect(resolveByIntent('incorrectCaseUsername', values)?.value).toBe('Acme_User');
  });

  it('returns null when there is no basis for a value', () => {
    expect(resolveByIntent('incorrectCaseUsername', { seed: 'ab12cd34' })).toBeNull();
    expect(resolveByIntent('validUsername', values)).toBeNull();
    expect(resolveByIntent('searchQuery', values)).toBeNull();
    expect(toggleLetterCase('12345')).toBeNull();
  });

  it('treats real secrets as sensitive but deliberately wrong or arbitrary credentials as fixture data', () => {
    expect(isSensitivePlaceholder('validPassword')).toBe(true);
    expect(isSensitivePlaceholder('authToken')).toBe(true);
    expect(isSensitivePlaceholder('apiKey')).toBe(true);
    expect(isSensitivePlaceholder('invalidPassword')).toBe(false);
    expect(isSensitivePlaceholder('anyPassword')).toBe(false);
    expect(isSensitivePlaceholder('authorName')).toBe(false);
  });
});
