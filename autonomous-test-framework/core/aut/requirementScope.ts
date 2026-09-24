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

/** Trailing words a requirement title adds to a feature name ("Profile Feature", "Login Requirements"). */
const FEATURE_NAME_NOISE = /\s+(feature|module|requirements?( document)?|prd)$/i;

/**
 * The bare feature a feature name refers to, e.g. "Profile Feature" -> "Profile" and
 * "Logout Feature – Acme Portal" -> "Logout". Agent 01 copies the feature name from the requirement
 * document's own title, so its wording varies from one document to the next; every generated file
 * name is built from this instead so it stays standard.
 * @param {unknown} featureName - Analysis feature name
 * @returns {string} Bare name, or '' when nothing usable remains
 */
export function bareFeatureName(featureName: unknown): string {
  let name = String(featureName || '').trim().replace(/^(prd|requirements?( document)?)\s*[–—:-]\s*/i, '');
  name = name.split(/\s+[–—-]\s+/)[0];
  while (FEATURE_NAME_NOISE.test(name)) name = name.replace(FEATURE_NAME_NOISE, '');
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
}

/**
 * Standard file stem for every feature of a requirement: the bare feature name in PascalCase, so
 * "Profile Feature" yields Profile.spec.ts, ProfilePage.ts and page-maps/Profile.json. A stem two
 * features would share is left out, and those features fall back to the scoped feature key.
 * @param {any} analysis - analyzedRequirements artifact
 * @returns {Map<string, string>} featureId -> stem
 */
export function featureStemsOf(analysis: any): Map<string, string> {
  const stems = new Map<string, string>();
  const features = (analysis?.features || []).filter((f: any) => f?.id);
  const stemOf = (f: any) => toSpecStem(bareFeatureName(f.name));
  for (const feature of features) {
    const stem = stemOf(feature);
    if (stem && features.filter((f: any) => stemOf(f) === stem).length === 1) stems.set(String(feature.id), stem);
  }
  return stems;
}
