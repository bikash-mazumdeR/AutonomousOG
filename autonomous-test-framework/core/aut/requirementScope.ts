'use strict';

/**
 * @fileoverview Requirement scope — the identity of the requirement a run is generating for.
 *
 * Agent 01 numbers features, stories and test cases from the start of every requirement document, so
 * a project's second requirement reuses F-01 / US-01 / TC-001. Those ids are unique inside a
 * requirement and ambiguous across a project, which made each new requirement's generated files land
 * on the previous one's. Prefixing every generated artifact with this scope keeps the ids intact while
 * making the file names unique per requirement.
 *
 * @module RequirementScope
 */

/** Used when an analysis carries neither a feature name nor a fingerprint. */
export const DEFAULT_SCOPE = 'requirement';

/**
 * Folder- and filename-safe slug.
 * @param {string} text
 * @returns {string}
 */
function slugify(text: string): string {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The scope slug for an analyzedRequirements artifact, e.g. "login" or "logout".
 * Derived from the feature name so generated files stay readable, and from the requirement
 * fingerprint when the analysis names no feature.
 * @param {any} analysis - analyzedRequirements artifact
 * @returns {string}
 */
export function requirementScope(analysis: any): string {
  const featureName = (analysis?.features || []).map((f: any) => f?.name).find((name: any) => slugify(name));
  return slugify(featureName) || slugify(analysis?.requirementFingerprint || '').slice(0, 12) || DEFAULT_SCOPE;
}

/**
 * Scoped identity for one feature of a requirement, e.g. "logout-F-01". Used for file names only;
 * the unscoped featureId stays in test titles, page maps and reports.
 * @param {string} scope - From requirementScope()
 * @param {string} featureId - Analysis feature id, e.g. "F-01"
 * @returns {string}
 */
export function scopedFeatureKey(scope: string, featureId: string): string {
  const key = slugify(scope);
  return key ? `${key}-${featureId}` : String(featureId);
}

/**
 * A caller-supplied name for this requirement's generated files, normalised to a safe stem.
 * Lets a run name its spec and page object explicitly ("Logout" -> Logout.spec.ts, LogoutPage.ts)
 * instead of inheriting the feature name Agent 01 happened to write.
 * @param {string} name - Requested name, e.g. from --spec-name
 * @returns {string} Safe file stem, or '' when nothing usable was supplied
 */
export function toSpecStem(name: string): string {
  return String(name || '').trim().replace(/[^A-Za-z0-9]+/g, ' ').trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}
