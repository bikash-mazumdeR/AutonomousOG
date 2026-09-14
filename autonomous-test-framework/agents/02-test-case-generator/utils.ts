'use strict';

/**
 * @fileoverview Gherkin rendering and BDD feature-file synchronisation for Agent 02.
 * The JSON test cases are the source of truth; .feature files are a deterministic, human-readable
 * projection that the Agent 01/02/03 UI servers re-sync after edits and approvals.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isTestCaseSelected, GherkinKeyword } from '../../core/types';
import { TC_TYPE, TYPE_TAGS } from './constants';

const FEATURES_DIR = path.resolve(__dirname, '../../tests/features');
const GHERKIN_KEYWORDS: readonly GherkinKeyword[] = ['Given', 'When', 'Then', 'And', 'But'];
const ACTION_KEYWORDS: ReadonlySet<string> = new Set(['Given', 'When']);
const UNMAPPED_STORY_ID = 'UNMAPPED';
const DEFAULT_FEATURE_FOLDER = 'General Features';

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

function groupByStory(testCases: any[]): Map<string, any[]> {
  const groups = new Map<string, any[]>();
  for (const tc of testCases) {
    const storyId = String(tc.userStoryId || UNMAPPED_STORY_ID);
    groups.set(storyId, [...(groups.get(storyId) || []), tc]);
  }
  return groups;
}

function findStoryContext(analysis: any, storyId: string): StoryContext {
  for (const feature of analysis?.features || []) {
    const story = (feature.userStories || []).find((s: any) => s.id === storyId);
    if (story) return { feature, story };
  }
  return { feature: null, story: null };
}

/**
 * Finds the folder/file already holding this story's feature file. feature.name is regenerated
 * by Agent 01 on every run, so only the storyId prefix is a stable identity.
 */
function findExistingStoryFile(storyId: string): { dir: string; fileName: string } | null {
  if (!fs.existsSync(FEATURES_DIR)) return null;
  const isStoryFile = (file: string) => file.endsWith('.feature') && file.startsWith(`${storyId}-`);
  for (const entry of fs.readdirSync(FEATURES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(FEATURES_DIR, entry.name);
    const matches = fs.readdirSync(dir).filter(isStoryFile).sort((a, b) => a.length - b.length);
    if (matches.length > 0) return { dir, fileName: matches[0] };
  }
  return null;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolveStoryFile(storyId: string, ctx: StoryContext): { dir: string; baseName: string } {
  const existing = findExistingStoryFile(storyId);
  if (existing) {
    return { dir: existing.dir, baseName: existing.fileName.replace(/\.feature$/i, '').replace(/-(api|perf)$/i, '') };
  }
  const folder = String(ctx.feature?.name || DEFAULT_FEATURE_FOLDER).replace(/[/\\?%*:|"<>]/g, '-').trim();
  const dir = path.join(FEATURES_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, baseName: `${storyId}-${slugify(ctx.story?.title || ctx.feature?.name || 'feature')}` };
}

function renderFeatureFile(ctx: StoryContext, storyId: string, titleSuffix: string, testCases: any[]): string {
  const { feature, story } = ctx;
  const storyTitle = story ? `${storyId} ${story.title || ''}`.trim() : storyId;
  const title = feature?.name ? `${feature.name} — ${storyTitle}` : storyTitle;
  const narrative = story?.role && story?.goal
    ? [`  As a ${story.role}`, `  I want to ${story.goal}`, ...(story.benefit ? [`  So that ${String(story.benefit).replace(/\.+$/, '')}`] : [])]
    : [];
  return [`Feature: ${title}${titleSuffix}`, ...narrative, '', ...testCases.map((tc) => `${buildGherkinScenarioText(tc)}\n`)].join('\n');
}

/**
 * Writes one .feature file per story partition (UI / API / Performance) with strict 1:1
 * scenario ↔ test case parity. Deselected test cases are tagged @obsolete; partition files
 * that no longer have test cases are removed.
 * @param {any} analysis - analyzedRequirements artifact (for feature/story narrative)
 * @param {any[]} testCases
 * @param {any} [logger]
 * @returns {string[]} Written file paths
 */
export function syncFeatureFiles(analysis: any, testCases: any[], logger?: any): string[] {
  fs.mkdirSync(FEATURES_DIR, { recursive: true });
  const savedPaths: string[] = [];
  for (const [storyId, storyTCs] of groupByStory(testCases || [])) {
    const ctx = findStoryContext(analysis, storyId);
    const target = resolveStoryFile(storyId, ctx);
    for (const partition of PARTITIONS) {
      const filePath = path.join(target.dir, `${target.baseName}${partition.suffix}.feature`);
      const partitionTCs = storyTCs.filter((tc) => partition.matches(String(tc.type || '')));
      if (partitionTCs.length === 0) {
        if (partition.suffix && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        continue;
      }
      fs.writeFileSync(filePath, renderFeatureFile(ctx, storyId, partition.titleSuffix, partitionTCs), 'utf-8');
      savedPaths.push(filePath);
      logger?.info(`Feature file synced: [${partition.name}]`, { filePath, storyId, scenariosCount: partitionTCs.length });
    }
  }
  return savedPaths;
}
