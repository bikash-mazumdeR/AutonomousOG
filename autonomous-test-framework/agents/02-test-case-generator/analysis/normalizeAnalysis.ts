'use strict';

/**
 * @fileoverview Normalises Agent 01's `analyzedRequirements` into the strict shape Agent 02 uses.
 * Agent 01 is LLM-driven, so enum casing and optional fields vary between runs
 * ("High" vs "HIGH", "[@ui] ..." criterion prefixes, missing role/benefit). Everything else in
 * Agent 02 reads only the normalised structure produced here.
 */

import {
  RISK_LEVEL, RiskLevel, TESTABILITY, REQUIREMENT_REF_PREFIX,
} from '../constants';

/** An acceptance criterion or business rule with a stable, story-local id. */
export interface RequirementItem {
  id: string;
  text: string;
  /** Category parsed from a leading "[@tag]" prefix (acceptance criteria only). */
  category: string;
}

/** Integration point with its enum type upper-cased. */
export interface IntegrationPoint {
  id: string;
  name: string;
  type: string;
  endpoint: string;
}

/** User story with every list field guaranteed. */
export interface NormalizedStory {
  id: string;
  title: string;
  role: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: RequirementItem[];
  businessRules: RequirementItem[];
  stateTransitions: string[];
  assumptions: string[];
  outOfScope: string[];
  integrationPoints: IntegrationPoint[];
  testTypes: string[];
}

/** Feature with a valid risk level and only generatable stories. */
export interface NormalizedFeature {
  id: string;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  userStories: NormalizedStory[];
}

/** Unresolved ambiguity raised by Agent 01. */
export interface OpenAmbiguity {
  id: string;
  featureId: string;
  question: string;
  blocking: boolean;
}

/** Result of normalisation. */
export interface NormalizedAnalysis {
  features: NormalizedFeature[];
  stateTransitions: unknown[];
  /** Non-blocking open ambiguities (blocking ones skip their feature). */
  openAmbiguities: OpenAmbiguity[];
  warnings: string[];
  clarifications: string[];
}

const AC_CATEGORY_PREFIX = /^\s*\[@?([a-z0-9_-]+)\]\s*/i;
const AC_CATEGORY_SUFFIX = /\s*\(@([a-z0-9_-]+)\)\s*$/i;

/**
 * Upper-cases a free-form enum value ("High" → "HIGH", "rest api" → "REST_API").
 * @param {unknown} value
 * @returns {string}
 */
export function toEnumValue(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function textOf(value: any): string {
  const raw = typeof value === 'string' ? value : value?.description ?? value?.text ?? value?.name ?? '';
  return String(raw).trim();
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(textOf).filter(Boolean) : [];
}

/** Splits a "[@tag] text" or "text (@tag)" criterion into category and text. */
function splitCategory(raw: string): Pick<RequirementItem, 'category' | 'text'> {
  const prefix = raw.match(AC_CATEGORY_PREFIX);
  if (prefix) return { category: prefix[1].toLowerCase(), text: raw.slice(prefix[0].length).trim() };
  const suffix = raw.match(AC_CATEGORY_SUFFIX);
  if (suffix) return { category: suffix[1].toLowerCase(), text: raw.slice(0, suffix.index).trim() };
  return { category: '', text: raw };
}

function toRequirementItems(value: unknown, prefix: string, parseCategory: boolean): RequirementItem[] {
  return toStringList(value).map((raw, idx) => ({
    id: `${prefix}-${idx + 1}`,
    ...(parseCategory ? splitCategory(raw) : { category: '', text: raw }),
  }));
}

function normalizeIntegration(raw: any): IntegrationPoint {
  return {
    id: String(raw?.id ?? '').trim(),
    name: textOf(raw?.name ?? raw?.id),
    type: toEnumValue(raw?.type),
    endpoint: String(raw?.endpoint ?? '').trim(),
  };
}

function resolveIntegrations(refs: unknown, globalById: Map<string, IntegrationPoint>): IntegrationPoint[] {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((ref) => (typeof ref === 'string' ? globalById.get(ref.trim()) : normalizeIntegration(ref)))
    .filter((ip): ip is IntegrationPoint => Boolean(ip?.id));
}

function normalizeStory(
  raw: any,
  featureId: string,
  index: number,
  globalById: Map<string, IntegrationPoint>,
  warnings: string[],
): NormalizedStory | null {
  const id = String(raw?.id ?? '').trim() || `${featureId}-US-${index + 1}`;
  const label = `[${featureId}/${id}]`;
  if (!raw?.id) warnings.push(`${label} Story has no id — assigned "${id}"`);
  if (toEnumValue(raw?.testability) === TESTABILITY.MANUAL_ONLY) {
    warnings.push(`${label} Story "${textOf(raw?.title)}" marked MANUAL_ONLY — skipped`);
    return null;
  }
  const story: NormalizedStory = {
    id,
    title: textOf(raw?.title) || id,
    role: textOf(raw?.role),
    goal: textOf(raw?.goal),
    benefit: textOf(raw?.benefit),
    acceptanceCriteria: toRequirementItems(raw?.acceptanceCriteria, REQUIREMENT_REF_PREFIX.AC, true),
    businessRules: toRequirementItems(raw?.businessRules, REQUIREMENT_REF_PREFIX.BR, false),
    stateTransitions: toStringList(raw?.stateTransitions),
    assumptions: toStringList(raw?.assumptions),
    outOfScope: toStringList(raw?.outOfScope),
    integrationPoints: resolveIntegrations(raw?.integrationPoints, globalById),
    testTypes: toStringList(raw?.testTypes).map(toEnumValue),
  };
  if (story.acceptanceCriteria.length + story.businessRules.length === 0) {
    warnings.push(`${label} Story has no acceptance criteria or business rules — skipped (nothing to test without inventing scope)`);
    return null;
  }
  return story;
}

function normalizeFeature(
  raw: any,
  index: number,
  globalById: Map<string, IntegrationPoint>,
  warnings: string[],
): NormalizedFeature {
  const id = String(raw?.id ?? '').trim() || `F-${String(index + 1).padStart(2, '0')}`;
  const riskRaw = toEnumValue(raw?.riskLevel);
  const riskLevel = (Object.prototype.hasOwnProperty.call(RISK_LEVEL, riskRaw) ? riskRaw : RISK_LEVEL.MEDIUM) as RiskLevel;
  if (riskRaw !== riskLevel) warnings.push(`[${id}] Unknown riskLevel "${raw?.riskLevel ?? ''}" — defaulting to MEDIUM`);

  const rawStories: any[] = Array.isArray(raw?.userStories) ? raw.userStories : [];
  const userStories = rawStories
    .map((story, idx) => normalizeStory(story, id, idx, globalById, warnings))
    .filter((story): story is NormalizedStory => story !== null);
  if (rawStories.length === 0) warnings.push(`[${id}] Feature has no user stories`);

  return {
    id, name: textOf(raw?.name) || id, description: textOf(raw?.description), riskLevel, userStories,
  };
}

function collectOpenAmbiguities(raw: unknown): OpenAmbiguity[] {
  const list: any[] = Array.isArray(raw) ? raw : [];
  return list
    .filter((amb) => amb && amb.resolved !== true)
    .map((amb, idx) => ({
      id: String(amb.id || `AMB-${idx + 1}`),
      featureId: String(amb.featureId || '').trim(),
      question: textOf(amb.question) || textOf(amb.description),
      blocking: String(amb.blockingTestGeneration).toLowerCase() === 'true',
    }))
    .filter((amb) => amb.question);
}

/**
 * Normalises an Agent 01 analysis report.
 * Features with an unresolved blocking ambiguity are skipped and surfaced as clarifications.
 * @param {any} raw - analyzedRequirements artifact
 * @returns {NormalizedAnalysis}
 */
export function normalizeAnalysis(raw: any): NormalizedAnalysis {
  const warnings: string[] = [];
  const clarifications: string[] = [];
  const rawIntegrations: any[] = Array.isArray(raw?.integrationPoints) ? raw.integrationPoints : [];
  const globalById = new Map(rawIntegrations.map(normalizeIntegration).filter((ip) => ip.id).map((ip) => [ip.id, ip]));
  const ambiguities = collectOpenAmbiguities(raw?.ambiguities);
  const rawFeatures: any[] = Array.isArray(raw?.features) ? raw.features : [];

  const features: NormalizedFeature[] = [];
  rawFeatures.forEach((rawFeature, idx) => {
    const feature = normalizeFeature(rawFeature, idx, globalById, warnings);
    const blocking = ambiguities.filter((amb) => amb.blocking && (!amb.featureId || amb.featureId === feature.id));
    if (blocking.length > 0) {
      clarifications.push(...blocking.map((amb) => `[${feature.id}] ${amb.question}`));
      warnings.push(`[${feature.id}] Skipped — ${blocking.length} blocking ambiguity(ies) need human clarification`);
      return;
    }
    if (feature.userStories.length > 0) features.push(feature);
  });

  return {
    features,
    stateTransitions: Array.isArray(raw?.stateTransitions) ? raw.stateTransitions : [],
    openAmbiguities: ambiguities.filter((amb) => !amb.blocking),
    warnings,
    clarifications,
  };
}
