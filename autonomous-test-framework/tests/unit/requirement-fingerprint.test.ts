/**
 * @fileoverview Agent 01 must treat a re-uploaded requirement as already processed, so the identity
 * of a requirement has to come from its content rather than its filename or upload event. These
 * cases are the change-detection rules the ingestion contract specifies.
 */

import {
  normalizeRequirement, computeRequirementFingerprint, uploadFileNameFor, isSameRequirement,
} from '../../core/requirements/requirementFingerprint';

const BASE = [
  '# Login',
  '',
  'The user can sign in with a valid username and password.',
  '',
  '## Acceptance Criteria',
  '* AC-1: Valid credentials land on the inventory page.',
  '* AC-2: Invalid credentials show an error.',
].join('\n');

describe('requirement change detection', () => {
  describe('treated as the SAME requirement', () => {
    it('ignores a re-upload of identical content', () => {
      expect(isSameRequirement(BASE, BASE)).toBe(true);
    });

    it('ignores line-ending differences', () => {
      expect(isSameRequirement(BASE, BASE.replace(/\n/g, '\r\n'))).toBe(true);
    });

    it('ignores trailing whitespace', () => {
      const padded = BASE.split('\n').map((l) => `${l}   `).join('\n');
      expect(isSameRequirement(BASE, padded)).toBe(true);
    });

    it('ignores extra blank lines between paragraphs', () => {
      expect(isSameRequirement(BASE, BASE.replace('\n\n', '\n\n\n\n'))).toBe(true);
    });

    it('ignores leading and trailing document whitespace', () => {
      expect(isSameRequirement(BASE, `\n\n  ${BASE}\n\n`)).toBe(true);
    });

    it('ignores interchangeable Markdown bullet characters', () => {
      expect(isSameRequirement(BASE, BASE.replace(/^\* /gm, '- '))).toBe(true);
      expect(isSameRequirement(BASE, BASE.replace(/^\* /gm, '+ '))).toBe(true);
    });

    it('ignores a BOM and zero-width characters from copy-paste', () => {
      expect(isSameRequirement(BASE, `﻿${BASE}`)).toBe(true);
      expect(isSameRequirement(BASE, BASE.replace('Login', 'Log​in'))).toBe(true);
    });

    it('is independent of filename — identity comes only from content', () => {
      // Same content, two different uploads: the fingerprint, and therefore the stored path, match.
      expect(uploadFileNameFor(computeRequirementFingerprint(BASE)))
        .toBe(uploadFileNameFor(computeRequirementFingerprint(`${BASE}\n`)));
    });
  });

  describe('treated as a NEW version', () => {
    it('detects modified acceptance criteria', () => {
      const changed = BASE.replace('land on the inventory page', 'land on the dashboard');
      expect(isSameRequirement(BASE, changed)).toBe(false);
    });

    it('detects an added requirement', () => {
      expect(isSameRequirement(BASE, `${BASE}\n* AC-3: Locked-out users see a lockout message.`)).toBe(false);
    });

    it('detects a removed requirement', () => {
      expect(isSameRequirement(BASE, BASE.replace('* AC-2: Invalid credentials show an error.', ''))).toBe(false);
    });

    it('detects changed business wording', () => {
      expect(isSameRequirement(BASE, BASE.replace('valid username and password', 'valid email and password'))).toBe(false);
    });

    it('preserves indentation, which carries meaning in Markdown', () => {
      // A nested bullet is a different structure, not formatting noise.
      expect(isSameRequirement(BASE, BASE.replace('* AC-2', '    * AC-2'))).toBe(false);
    });
  });

  describe('normalization and filenames', () => {
    it('produces a stable 64-char sha256 digest', () => {
      expect(computeRequirementFingerprint(BASE)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('builds a 32-hex upload filename', () => {
      expect(uploadFileNameFor(computeRequirementFingerprint(BASE))).toMatch(/^[0-9a-f]{32}\.md$/);
    });

    it('falls back to .md for an implausible extension', () => {
      const fingerprint = computeRequirementFingerprint(BASE);
      expect(uploadFileNameFor(fingerprint, '../../evil')).toMatch(/\.md$/);
      expect(uploadFileNameFor(fingerprint, '.TXT')).toMatch(/\.txt$/);
    });

    it('handles empty and nullish input without throwing', () => {
      expect(normalizeRequirement('')).toBe('');
      expect(normalizeRequirement(undefined as any)).toBe('');
      expect(computeRequirementFingerprint('')).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
