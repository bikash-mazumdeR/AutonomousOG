'use strict';

/**
 * @fileoverview Gherkin rendering and BDD feature-file synchronisation for Agent 02.
 * The JSON test cases are the source of truth; .feature files are a deterministic, human-readable
 * projection that the Agent 01/02/03 UI servers re-sync after edits and approvals.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isTestCaseSelected, GherkinKeyword, REVIEW_STATUS } from '../../core/types';
import { projectPaths } from '../../core/aut/projectPaths';
import { loadAutProfile } from '../../core/aut/AutProfile';
import { bareFeatureName } from '../../core/aut/requirementScope';

/** Feature file tags for test cases excluded from automation at review. */
const REVIEW_STATUS_TAGS: Readonly<Record<string, string>> = Object.freeze({
  [REVIEW_STATUS.HELD]: '@held',
  [REVIEW_STATUS.MANUAL]: '@manual',
});
import { TC_TYPE, TYPE_TAGS } from './constants';

const GHERKIN_KEYWORDS: readonly GherkinKeyword[] = ['Given', 'When', 'Then', 'And', 'But'];
const ACTION_KEYWORDS: ReadonlySet<string> = new Set(['Given', 'When']);
const UNMAPPED_STORY_ID = 'UNMAPPED';
const DEFAULT_FEATURE_FOLDER = 'General';
const FEATURE_FILE_SUFFIX = ' Feature';
const APP_NAME_SEPARATOR = '- ';

/** One rendered Gherkin line. */
export interface GherkinStepLine {
  keyword: GherkinKeyword;
  text: string;
}

interface StoryContext {
  feature: any | null;
  story: any | null;
}

interface FeaturePartition {
  name: string;
  suffix: string;
  titleSuffix: string;
  matches: (type: string) => boolean;
}

const isType = (type: string, expected: string) => type.toLowerCase() === expected.toLowerCase();

const PARTITIONS: readonly FeaturePartition[] = [
  {
    name: 'UI', suffix: '', titleSuffix: '', matches: (type) => !isType(type, TC_TYPE.API) && !isType(type, TC_TYPE.PERFORMANCE),
  },
  {
    name: 'API', suffix: '-api', titleSuffix: ' — API', matches: (type) => isType(type, TC_TYPE.API),
  },
  {
    name: 'Performance', suffix: '-perf', titleSuffix: ' — Performance', matches: (type) => isType(type, TC_TYPE.PERFORMANCE),
  },
];

function normalizeKeyword(keyword: unknown): GherkinKeyword {
  const raw = String(keyword || '').trim();
  const capitalised = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return (GHERKIN_KEYWORDS as readonly string[]).includes(capitalised) ? capitalised as GherkinKeyword : 'When';
}

function expectationLines(expected: unknown): GherkinStepLine[] {
  return String(expected || '').split('\n').map((line) => line.trim()).filter(Boolean)
    .map((text, idx) => ({ keyword: idx === 0 ? 'Then' : 'And', text }));
}

/**
 * Converts a test case's steps into Gherkin lines. Lossless for Agent 02 output:
 * action → optional "And with test data" → Then (+ And for additional assertions).
 * @param {any} tc
 * @returns {GherkinStepLine[]}
 */
export function convertTestStepsToGherkin(tc: any): GherkinStepLine[] {
  const lines: GherkinStepLine[] = [];
  for (const step of tc?.testSteps || []) {
    const keyword = normalizeKeyword(step.keyword);
    const description = String(step.description || '').trim();
    const expected = String(step.expectedResult || '').trim();
    if (!ACTION_KEYWORDS.has(keyword)) {
      // Assertion-only step added via the UI editor (Then/And/But).
      lines.push({ keyword, text: description || expected });
      if (description && expected && expected !== description) lines.push({ keyword: 'And', text: expected });
      continue;
    }
    lines.push({ keyword, text: description });
    const testData = String(step.testData || '').trim();
    if (testData) lines.push({ keyword: 'And', text: `with test data "${testData}"` });
    lines.push(...expectationLines(expected));
  }
  return lines;
}

function toTag(value: unknown): string {
  return `@${String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/**
 * Builds the ordered tag list for a scenario: type, requirement refs, labels, API/K6 details, key, obsolete.
 * @param {any} tc
 * @returns {string[]}
 */
export function buildScenarioTags(tc: any): string[] {
  const tags = [toTag(tc.type || TC_TYPE.POSITIVE)];
  (tc.requirementRefs || []).forEach((ref: string) => tags.push(toTag(ref)));
  (tc.labels || []).forEach((label: string) => {
    const tag = toTag(label);
    if (!Object.prototype.hasOwnProperty.call(TYPE_TAGS, tag.slice(1))) tags.push(tag);
  });
  if (tc.apiDetails?.method) tags.push(toTag(`method-${tc.apiDetails.method}`));
  if (tc.apiDetails?.expectedStatusCode) tags.push(toTag(`status-${tc.apiDetails.expectedStatusCode}`));
  if (tc.performanceRef?.scenario) tags.push(toTag(tc.performanceRef.scenario));
  if (tc.key) tags.push(toTag(tc.key));
  if (!isTestCaseSelected(tc)) tags.push('@obsolete');
  if (REVIEW_STATUS_TAGS[tc.reviewStatus]) tags.push(REVIEW_STATUS_TAGS[tc.reviewStatus]);
  return [...new Set(tags)];
}

/**
 * Builds the complete Gherkin scenario text for a test case, as saved in .feature files.
 * @param {any} tc
 * @returns {string}
 */
export function buildGherkinScenarioText(tc: any): string {
  const title = String(tc.name || tc.objective || tc.key || '').trim();
  return [
    `  ${buildScenarioTags(tc).join(' ')}`,
    `  Scenario: [${tc.key}] ${title}`,
    ...convertTestStepsToGherkin(tc).map((line) => `    ${line.keyword} ${line.text}`),
  ].join('\n');
}

interface FeatureGroup {
  feature: any | null;
  stories: Array<{ storyId: string; story: any | null; testCases: any[] }>;
}

function findStoryContext(analysis: any, storyId: string): StoryContext {
  for (const feature of analysis?.features || []) {
    const story = (feature.userStories || []).find((s: any) => s.id === storyId);
    if (story) return { feature, story };
  }
  return { feature: null, story: null };
}

/** Groups test cases by the feature their story belongs to, keeping story order within a feature. */
function groupByFeature(analysis: any, testCases: any[]): FeatureGroup[] {
  const groups = new Map<string, FeatureGroup>();
  for (const tc of testCases) {
    const storyId = String(tc.userStoryId || UNMAPPED_STORY_ID);
    const { feature, story } = findStoryContext(analysis, storyId);
    const key = String(feature?.id || UNMAPPED_STORY_ID);
    const group = groups.get(key) || { feature, stories: [] };
    const entry = group.stories.find((s) => s.storyId === storyId);
    if (entry) entry.testCases.push(tc);
    else group.stories.push({ storyId, story, testCases: [tc] });
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Feature folder name: the bare feature, e.g. "Profile Feature" → "Profile".
 * @param {unknown} featureName
 * @returns {string}
 */
export function featureFolderName(featureName: unknown): string {
  return bareFeatureName(featureName) || DEFAULT_FEATURE_FOLDER;
}

/**
 * Standard feature file base name: "<Feature> Feature- <App>", e.g. "Profile Feature- Nexo".
 * @param {string} folder - Result of featureFolderName
 * @param {string} appName - Application short name
 * @returns {string}
 */
export function featureFileBaseName(folder: string, appName: string): string {
  return `${folder}${FEATURE_FILE_SUFFIX}${APP_NAME_SEPARATOR}${appName}`;
}

/** The application's short name from its AUT profile; the project id when it has no profile. */
function resolveAppShortName(projectId: string): string {
  try {
    const profile = loadAutProfile(projectId);
    return (profile.shortName || '').trim() || profile.displayName.trim().split(/\s+/)[0];
  } catch {
    return projectId;
  }
}

function storyNarrative(story: any, indent: string): string[] {
  if (!story?.role || !story?.goal) return [];
  return [
    `${indent}As a ${story.role}`,
    `${indent}I want to ${story.goal}`,
    ...(story.benefit ? [`${indent}So that ${String(story.benefit).replace(/\.+$/, '')}`] : []),
  ];
}

function storyHeading(storyId: string, story: any): string {
  return story ? `${storyId} ${story.title || ''}`.trim() : storyId;
}

/**
 * Renders one feature file. A single-story feature keeps the story narrative under the Feature line;
 * a feature with several stories gives each its own Gherkin `Rule:` block.
 */
function renderFeatureFile(group: FeatureGroup, titleSuffix: string): string {
  const { feature, stories } = group;
  const scenarios = (testCases: any[]) => testCases.map((tc) => `${buildGherkinScenarioText(tc)}\n`);
  if (stories.length === 1) {
    const [{ storyId, story, testCases }] = stories;
    const heading = storyHeading(storyId, story);
    const title = feature?.name ? `${feature.name} — ${heading}` : heading;
    return [`Feature: ${title}${titleSuffix}`, ...storyNarrative(story, '  '), '', ...scenarios(testCases)].join('\n');
  }
  const rules = stories.flatMap(({ storyId, story, testCases }) => [
    `  Rule: ${storyHeading(storyId, story)}`, ...storyNarrative(story, '    '), '', ...scenarios(testCases),
  ]);
  return [`Feature: ${feature?.name || DEFAULT_FEATURE_FOLDER}${titleSuffix}`, '', ...rules].join('\n');
}

function writePartition(group: FeatureGroup, filePath: string, partition: FeaturePartition, logger?: any): boolean {
  const stories = group.stories
    .map((s) => ({ ...s, testCases: s.testCases.filter((tc) => partition.matches(String(tc.type || ''))) }))
    .filter((s) => s.testCases.length > 0);
  if (stories.length === 0) {
    if (partition.suffix && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return false;
  }
  fs.writeFileSync(filePath, renderFeatureFile({ feature: group.feature, stories }, partition.titleSuffix), 'utf-8');
  const scenariosCount = stories.reduce((sum, s) => sum + s.testCases.length, 0);
  logger?.info(`Feature file synced: [${partition.name}]`, { filePath, featureId: group.feature?.id, scenariosCount });
  return true;
}

/**
 * Writes one .feature file per feature partition (UI / API / Performance) with strict 1:1
 * scenario ↔ test case parity. Deselected test cases are tagged @obsolete; partition files
 * that no longer have test cases are removed.
 *
 * Naming is fixed so every requirement produces the same shape:
 *   features/<Feature>/<Feature> Feature- <App>.feature   (e.g. features/Profile/Profile Feature- Nexo.feature)
 *
 * Files land under the project's own generated-test root, never in a shared folder, so a feature
 * uploaded for one application cannot appear among another application's features.
 *
 * @param {string} projectId - Project the requirement belongs to
 * @param {any} analysis - analyzedRequirements artifact (for feature/story narrative)
 * @param {any[]} testCases
 * @param {any} [logger]
 * @returns {string[]} Written file paths
 */
export function syncFeatureFiles(projectId: string, analysis: any, testCases: any[], logger?: any): string[] {
  const featuresDir = projectPaths(projectId).featuresDir;
  const appName = resolveAppShortName(projectId);
  const savedPaths: string[] = [];
  for (const group of groupByFeature(analysis, testCases || [])) {
    const folder = featureFolderName(group.feature?.name);
    const dir = path.join(featuresDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    for (const partition of PARTITIONS) {
      const filePath = path.join(dir, `${featureFileBaseName(folder, appName)}${partition.suffix}.feature`);
      if (writePartition(group, filePath, partition, logger)) savedPaths.push(filePath);
    }
  }
  return savedPaths;
}
