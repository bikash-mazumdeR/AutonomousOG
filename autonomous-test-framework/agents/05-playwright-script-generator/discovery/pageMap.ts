'use strict';

/**
 * @fileoverview Page map — the persisted, reviewable record of verified page states and their unique
 * locators, produced by live DOM discovery. Element names are preserved across runs (matched by locator
 * signature) so generated page objects stay stable.
 */

import * as fs from 'fs';
import * as path from 'path';

export type LocatorStrategy = 'testId' | 'role' | 'label' | 'placeholder' | 'text' | 'id';

/** A verified element (its locator resolved to exactly one element when discovered). */
export interface PageElement {
  name: string;
  strategy: LocatorStrategy;
  args: string[];
  tag: string;
  role?: string;
  accessibleName?: string;
  inputType?: string;
}

/** A discovered application state, keyed by URL path. */
export interface PageState {
  name: string;
  urlPath: string;
  entryPath?: string;
  elements: PageElement[];
}

/** Page map for one feature. */
export interface PageMap {
  version: 1;
  featureId: string;
  testIdAttribute?: string;
  states: PageState[];
}

/**
 * Creates an empty page map.
 * @param {string} featureId
 * @param {string} [testIdAttribute]
 * @returns {PageMap}
 */
export function emptyPageMap(featureId: string, testIdAttribute?: string): PageMap {
  return {
    version: 1, featureId, testIdAttribute, states: [],
  };
}

/**
 * Loads a page map; returns null when missing, unreadable or for a different test-id attribute.
 * @param {string} file
 * @param {string} [testIdAttribute]
 * @returns {PageMap|null}
 */
export function loadPageMap(file: string, testIdAttribute?: string): PageMap | null {
  if (!fs.existsSync(file)) return null;
  try {
    const map = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (map?.version !== 1 || !Array.isArray(map.states)) return null;
    return map.testIdAttribute === testIdAttribute ? map : null;
  } catch {
    return null;
  }
}

/**
 * Saves a page map with stable formatting.
 * @param {string} file
 * @param {PageMap} map
 */
export function savePageMap(file: string, map: PageMap): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, 'utf-8');
}

/**
 * Identity of a locator (strategy + arguments).
 * @param {Pick<PageElement, 'strategy'|'args'>} element
 * @returns {string}
 */
export function locatorSignature(element: Pick<PageElement, 'strategy' | 'args'>): string {
  return `${element.strategy}:${JSON.stringify(element.args)}`;
}

/**
 * Returns `base`, or `base2`, `base3`… when taken.
 * @param {string} base
 * @param {Set<string>} taken
 * @returns {string}
 */
export function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  let counter = 2;
  while (taken.has(name)) {
    name = `${base}${counter}`;
    counter += 1;
  }
  return name;
}

/**
 * camelCase from words.
 * @param {string[]} words
 * @returns {string}
 */
export function toCamel(words: string[]): string {
  return words
    .map((word, idx) => {
      const lower = word.toLowerCase();
      return idx === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/**
 * PascalCase from an identifier.
 * @param {string} identifier
 * @returns {string}
 */
export function toPascal(identifier: string): string {
  return identifier.charAt(0).toUpperCase() + identifier.slice(1);
}

/**
 * State name from a URL path ("/" → "start", "/account/settings.html" → "accountSettings").
 * @param {string} urlPath
 * @param {Set<string>} taken
 * @returns {string}
 */
export function stateNameForPath(urlPath: string, taken: Set<string>): string {
  const words = urlPath.replace(/\.[a-z0-9]+$/i, '').split(/[^a-zA-Z0-9]+/).filter(Boolean);
  let base = words.length === 0 ? 'start' : toCamel(words);
  if (/^[0-9]/.test(base)) base = `page${toPascal(base)}`;
  return uniqueName(base, taken);
}

/**
 * Merges a freshly captured state into the map. Existing elements keep their names; new elements are added
 * with unique names. States are matched by URL path.
 * @param {PageMap} map
 * @param {PageState} incoming
 * @returns {PageState} The merged state stored in the map
 */
export function mergeState(map: PageMap, incoming: PageState): PageState {
  const existing = map.states.find((state) => state.urlPath === incoming.urlPath);
  if (!existing) {
    map.states.push(incoming);
    return incoming;
  }
  if (incoming.entryPath && !existing.entryPath) existing.entryPath = incoming.entryPath;
  const known = new Set(existing.elements.map((element) => locatorSignature(element)));
  const taken = new Set(existing.elements.map((element) => element.name));
  for (const element of incoming.elements) {
    const signature = locatorSignature(element);
    if (known.has(signature)) continue;
    const name = uniqueName(element.name, taken);
    existing.elements.push({ ...element, name });
    taken.add(name);
    known.add(signature);
  }
  return existing;
}
