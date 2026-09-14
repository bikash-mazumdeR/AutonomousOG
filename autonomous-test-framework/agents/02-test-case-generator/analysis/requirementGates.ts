'use strict';

/**
 * @fileoverview Strict requirement gates for API and K6 performance scenarios.
 * API / performance scenarios may only be generated when the analysis documents a concrete
 * HTTP endpoint (and, for performance, a quantitative threshold). Otherwise they are forbidden
 * in the prompt and rejected by the validator.
 */

import { API_INTEGRATION_TYPES } from '../constants';
import { IntegrationPoint, NormalizedStory } from './normalizeAnalysis';

/** Outcome of a gate evaluation. */
export interface GateResult {
  allowed: boolean;
  reason: string;
  /** Integration points the scenarios may target (empty when not allowed). */
  integrationPoints: IntegrationPoint[];
}

const PLACEHOLDER_ENDPOINTS: ReadonlySet<string> = new Set([
  '', 'not specified', 'unknown', 'undefined', 'none', 'n/a', 'na', 'tbd',
  '/api', '/api/endpoint', '{{targetendpoint}}', '{{apiendpoint}}',
]);

const QUANTITATIVE_THRESHOLD = new RegExp(
  '\\b\\d+(?:\\.\\d+)?\\s*(?:ms|milliseconds?|s|secs?|seconds?|vus?|virtual users?|concurrent users?|users?'
  + '|rps|tps|requests?\\s*(?:per|/)\\s*(?:second|sec|s|minute|min))\\b',
  'i',
);

/**
 * Whether an integration point documents a concrete (non-placeholder) HTTP endpoint.
 * @param {Partial<IntegrationPoint> | null | undefined} integration
 * @returns {boolean}
 */
export function hasStrictApiDetails(integration: Partial<IntegrationPoint> | null | undefined): boolean {
  const endpoint = String(integration?.endpoint ?? '').trim().toLowerCase();
  if (PLACEHOLDER_ENDPOINTS.has(endpoint)) return false;
  return endpoint.startsWith('/') || endpoint.startsWith('http://') || endpoint.startsWith('https://');
}

/**
 * Deterministic Gherkin tag for an integration point id ("INT-01" → "int-01", "INT001" → "int-001").
 * @param {string} id
 * @returns {string}
 */
export function integrationTag(id: string): string {
  const slug = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const suffix = slug.replace(/^(int|ip)-?/, '');
  return `int-${suffix || slug}`;
}

function closed(reason: string): GateResult {
  return { allowed: false, reason, integrationPoints: [] };
}

function documentedHttpEndpoints(story: NormalizedStory): IntegrationPoint[] {
  return story.integrationPoints.filter((ip) => API_INTEGRATION_TYPES.includes(ip.type) && hasStrictApiDetails(ip));
}

/**
 * API gate: story test types include API and a linked REST/GraphQL endpoint is documented.
 * @param {NormalizedStory} story
 * @returns {GateResult}
 */
export function evaluateApiGate(story: NormalizedStory): GateResult {
  if (!story.testTypes.includes('API')) return closed('the story\'s testTypes do not include API');
  const endpoints = documentedHttpEndpoints(story);
  if (endpoints.length === 0) return closed('no linked REST_API/GRAPHQL integration point documents a concrete endpoint');
  return { allowed: true, reason: `documented endpoint(s): ${endpoints.map((ip) => ip.endpoint).join(', ')}`, integrationPoints: endpoints };
}

/**
 * Performance (K6) gate: PERFORMANCE test type, a quantitative threshold in the story's
 * criteria/rules, and a documented HTTP endpoint to load.
 * @param {NormalizedStory} story
 * @returns {GateResult}
 */
export function evaluatePerformanceGate(story: NormalizedStory): GateResult {
  if (!story.testTypes.includes('PERFORMANCE')) return closed('the story\'s testTypes do not include PERFORMANCE');
  const requirementText = [...story.acceptanceCriteria, ...story.businessRules].map((item) => item.text).join(' ');
  if (!QUANTITATIVE_THRESHOLD.test(requirementText)) return closed('no quantitative SLA (latency, VUs, RPS) is documented');
  const endpoints = documentedHttpEndpoints(story);
  if (endpoints.length === 0) return closed('no linked REST_API/GRAPHQL endpoint is documented for K6 to load');
  return { allowed: true, reason: `SLA and endpoint(s) documented: ${endpoints.map((ip) => ip.endpoint).join(', ')}`, integrationPoints: endpoints };
}
