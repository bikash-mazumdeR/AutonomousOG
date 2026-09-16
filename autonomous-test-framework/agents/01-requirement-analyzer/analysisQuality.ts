'use strict';

/**
 * @fileoverview Deterministic quality checks on Agent 01's LLM analysis:
 *  - story structure: one analysed user story per user story the document defines, keeping the document's story id
 *  - test data traceability: every test data value's sourceRef points at a criterion or rule containing that value
 *  - duplication: the same acceptance criterion repeated within or across stories
 * Structural issues are fed back to the LLM once; everything else is corrected or surfaced as a warning.
 */

/** A user story the requirement document itself defines. */
export interface SourceStory {
  /** Story id as written, e.g. "SL-AUTH-001"; absent for a narrative without an id. */
  id?: string;
}

/** Outcome of the quality checks. */
export interface AnalysisQualityResult {
  /** Structural problems worth one corrective LLM round. */
  issues: string[];
  /** Non-blocking findings shown at the approval gate. */
  warnings: string[];
}

const STORY_ID_LINE = /^[\s#>*_-]*Story\s*ID[*_\s]*:[*_\s]*([A-Za-z][A-Za-z0-9._-]*\d[A-Za-z0-9._-]*)/gim;
const NARRATIVE_ROLE = /^[\s>*_-]*As\s+an?\b/i;
const NARRATIVE_WANT = /\bI\s+(?:want|need|would like)\b/i;
const NARRATIVE_WINDOW_LINES = 3;
const REF_PATTERN = /^(AC|BR)-(\d+)$/i;
const CATEGORY_PREFIX = /^\s*\[@?[a-z0-9_-]+\]\s*/i;

const textOf = (item: any): string => String(typeof item === 'string' ? item : item?.description ?? item?.text ?? '');
const storiesOf = (report: any): any[] => (report?.features || []).flatMap((f: any) => f?.userStories || []);

/**
 * Finds the user stories a requirement document defines: explicit "Story ID:" lines, or else
 * "As a … I want …" narratives.
 * @param {string} rawRequirements
 * @returns {SourceStory[]}
 */
export function detectSourceStories(rawRequirements: string): SourceStory[] {
  const text = String(rawRequirements || '');
  const ids = [...new Set([...text.matchAll(STORY_ID_LINE)].map((m) => m[1]))];
  if (ids.length > 0) return ids.map((id) => ({ id }));
  const lines = text.split(/\r?\n/);
  return lines
    .map((line, idx) => NARRATIVE_ROLE.test(line)
      && NARRATIVE_WANT.test(lines.slice(idx, idx + NARRATIVE_WINDOW_LINES + 1).join(' ')))
    .filter(Boolean)
    .map(() => ({}));
}

/**
 * Checks that the analysis has exactly one user story per source story, each carrying its source id.
 * @param {any} report
 * @param {SourceStory[]} source
 * @returns {string[]} Issues (empty when the structure matches or the document defines no stories)
 */
export function checkStoryStructure(report: any, source: SourceStory[]): string[] {
  if (source.length === 0) return [];
  const stories = storiesOf(report);
  const issues: string[] = [];
  const sourceIds = source.map((s) => s.id).filter(Boolean) as string[];
  if (stories.length !== source.length) {
    issues.push(`The document defines ${source.length} user stor${source.length === 1 ? 'y' : 'ies'}`
      + `${sourceIds.length ? ` (${sourceIds.join(', ')})` : ''} but the analysis has ${stories.length}. Create exactly one user story per `
      + 'story the document defines; numbered flows, sections, personas and test accounts are acceptance criteria of that story, not new stories.');
  }
  if (sourceIds.length === 0) return issues;
  const analysed = stories.map((s) => String(s?.sourceStoryId || '').trim());
  const missing = sourceIds.filter((id) => !analysed.includes(id));
  const unknown = [...new Set(analysed.filter((id) => id && !sourceIds.includes(id)))];
  if (missing.length) issues.push(`No user story carries "sourceStoryId" for: ${missing.join(', ')}. Copy the document's story id exactly.`);
  if (unknown.length) issues.push(`"sourceStoryId" values not defined in the document: ${unknown.join(', ')}.`);
  return issues;
}

function refItems(story: any): Record<'AC' | 'BR', string[]> {
  return {
    AC: (story?.acceptanceCriteria || []).map(textOf),
    BR: (story?.businessRules || []).map(textOf),
  };
}

function findContainingRef(items: Record<'AC' | 'BR', string[]>, value: string): string | null {
  const needle = value.toLowerCase();
  for (const kind of ['AC', 'BR'] as const) {
    const index = items[kind].findIndex((text) => text.toLowerCase().includes(needle));
    if (index !== -1) return `${kind}-${index + 1}`;
  }
  return null;
}

/**
 * Points each test data value's sourceRef at the first criterion or rule that actually contains the value.
 * Updates the report in place.
 * @param {any} report
 * @returns {string[]} Warnings describing corrections and values found nowhere
 */
export function fixTestDataSourceRefs(report: any): string[] {
  const warnings: string[] = [];
  for (const story of storiesOf(report)) {
    const items = refItems(story);
    for (const data of story?.testDataValues || []) {
      const value = typeof data?.value === 'string' ? data.value.trim() : '';
      if (!value || data.sensitive === true) continue;
      const ref = String(data.sourceRef || '').trim().match(REF_PATTERN);
      const referenced = ref ? items[ref[1].toUpperCase() as 'AC' | 'BR'][Number(ref[2]) - 1] : undefined;
      if (referenced && referenced.toLowerCase().includes(value.toLowerCase())) continue;
      const found = findContainingRef(items, value);
      if (found) {
        warnings.push(`[${story.id}] Test data "${data.name}" referenced ${data.sourceRef || 'nothing'} but "${value}" appears in ${found} — corrected.`);
        data.sourceRef = found;
      } else {
        warnings.push(`[${story.id}] Test data "${data.name}" value "${value}" does not appear in any acceptance criterion or business rule of the story.`);
      }
    }
  }
  return warnings;
}

const normalizeCriterion = (text: string): string => text.replace(CATEGORY_PREFIX, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Lists acceptance criteria that repeat verbatim (ignoring category, case and punctuation) within or across stories.
 * @param {any} report
 * @returns {string[]}
 */
export function findDuplicateCriteria(report: any): string[] {
  const seen = new Map<string, string>();
  const warnings: string[] = [];
  for (const story of storiesOf(report)) {
    (story?.acceptanceCriteria || []).map(textOf).forEach((text: string, idx: number) => {
      const key = normalizeCriterion(text);
      if (!key) return;
      const location = `${story.id} AC-${idx + 1}`;
      const first = seen.get(key);
      if (first) warnings.push(`${location} repeats ${first}: "${text.replace(CATEGORY_PREFIX, '').slice(0, 100)}"`);
      else seen.set(key, location);
    });
  }
  return warnings;
}

/**
 * Runs every quality check. Test data references are corrected in place.
 * @param {any} report
 * @param {string} rawRequirements
 * @returns {AnalysisQualityResult}
 */
export function assessAnalysisQuality(report: any, rawRequirements: string): AnalysisQualityResult {
  return {
    issues: checkStoryStructure(report, detectSourceStories(rawRequirements)),
    warnings: [...fixTestDataSourceRefs(report), ...findDuplicateCriteria(report)],
  };
}
