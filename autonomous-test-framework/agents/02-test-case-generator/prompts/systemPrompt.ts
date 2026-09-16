'use strict';

/**
 * @fileoverview Builds the Agent 02 system prompt (skill + learnings) for one run, removing guidance that only
 * applies to test types that cannot be generated. The result is identical for every story in the run, so
 * providers can cache it.
 *
 * Marker syntax in the skill / LEARNINGS markdown:
 *   - `<text> <!-- type:negative,edge -->` — the line is kept only when one of the listed types is active
 *   - a line holding only `<!-- type:api -->` opens a block that ends at `<!-- /type -->`
 */

import { TYPE_TAGS } from '../constants';
import { NormalizedFeature } from '../analysis/normalizeAnalysis';
import { evaluateApiGate, evaluatePerformanceGate } from '../analysis/requirementGates';

const TYPE_MARKER = /\s*<!--\s*type:([a-z,\s-]+?)\s*-->\s*$/i;
const BLOCK_START = /^\s*<!--\s*type:([a-z,\s-]+?)\s*-->\s*$/i;
const BLOCK_END = /^\s*<!--\s*\/type\s*-->\s*$/i;

const listedTypes = (list: string): string[] => list.split(',').map((type) => type.trim().toLowerCase()).filter(Boolean);

/**
 * Type tags that can produce scenarios in this run: not excluded, and for API/performance an open gate on at least one story.
 * @param {NormalizedFeature[]} features
 * @param {ReadonlySet<string>} excludedTypeTags
 * @returns {Set<string>}
 */
export function resolveActiveTypeTags(features: NormalizedFeature[], excludedTypeTags: ReadonlySet<string>): Set<string> {
  const stories = features.flatMap((feature) => feature.userStories);
  const gateOpen: Record<string, boolean> = {
    api: stories.some((story) => evaluateApiGate(story).allowed),
    performance: stories.some((story) => evaluatePerformanceGate(story).allowed),
  };
  return new Set(Object.keys(TYPE_TAGS).filter((tag) => !excludedTypeTags.has(tag) && gateOpen[tag] !== false));
}

/**
 * Strips type-scoped lines and blocks whose types are all inactive, and removes the markers themselves.
 * @param {string} markdown
 * @param {ReadonlySet<string>} activeTypeTags
 * @returns {string}
 */
export function filterByActiveTypes(markdown: string, activeTypeTags: ReadonlySet<string>): string {
  const isActive = (list: string) => listedTypes(list).some((type) => activeTypeTags.has(type));
  const output: string[] = [];
  let blockActive: boolean | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const blockStart = line.match(BLOCK_START);
    if (blockStart) {
      blockActive = isActive(blockStart[1]);
      continue;
    }
    if (BLOCK_END.test(line)) {
      blockActive = null;
      continue;
    }
    if (blockActive === false) continue;
    const marker = line.match(TYPE_MARKER);
    if (!marker) output.push(line);
    else if (isActive(marker[1])) output.push(line.replace(TYPE_MARKER, '').trimEnd());
  }
  return output.join('\n');
}
