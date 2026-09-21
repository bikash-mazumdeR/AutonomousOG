'use strict';

/**
 * @fileoverview Page map — the persisted, reviewable record of verified page states and their unique
 * locators, produced by live DOM discovery. Element names are preserved across runs (matched by locator
 * signature) so generated page objects stay stable.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * `role` takes `[role, name]`, or `[role]` alone for a container (dialog, menu, landmark) the page holds exactly one of.
 * `css` is used only for locators the AUT profile declares (discovery.extraLocators), never inferred.
 */
export type LocatorStrategy = 'testId' | 'role' | 'label' | 'placeholder' | 'text' | 'id' | 'css';

/** A verified element (its locator resolved to exactly one element when discovered). */
export interface PageElement {
  name: string;
  strategy: LocatorStrategy;
  args: string[];
  tag: string;
  role?: string;
  accessibleName?: string;
  inputType?: string;
  /** What the element is, for profile-declared locators (shown in the page contract). */
  description?: string;
}

/**
 * The modal overlay open in a state — a dialog or menu that swaps what the page shows without changing its URL.
 * Identified by role and accessible name, so "Log out?" and "Delete post?" at the same address are two states.
 */
export interface StateOverlay {
  role: string;
  name?: string;
}

/**
 * A discovered application state, keyed by URL path plus the overlay open in it. A single-page application keeps
 * one address while it opens menus and dialogs, so the URL alone would fold every such view into one state.
 */
export interface PageState {
  name: string;
  urlPath: string;
  entryPath?: string;
  overlay?: StateOverlay;
  elements: PageElement[];
}

/** Current page map schema version (v2 adds discovery traces and verified flows). */
export const PAGE_MAP_VERSION = 2 as const;

/** One action discovery performed, tagged with the state it ran in. */
export interface TraceAction {
  stepIndex: number;
  state: string;
  element?: string;
  op: string;
  value?: { binding?: string; literal?: string };
}

/** Consecutive actions a test case performed in one state, and the state they led to. */
export interface TraceRun {
  state: string;
  actions: TraceAction[];
  reachedState: string;
}

/** What discovery verified while executing one test case's steps. */
export interface TestCaseTrace {
  tcKey: string;
  runs: TraceRun[];
  /** State the browser was in after each step's actions (step index → state name). */
  stateAfterStep: Record<number, string>;
}

/** One action of a verified flow; `param` names its value argument when the action takes one. */
export interface FlowAction {
  element?: string;
  op: string;
  param?: string;
}

/** An action run that several test cases performed identically during discovery. */
export interface VerifiedFlow {
  id: string;
  name: string;
  state: string;
  actions: FlowAction[];
  usedBy: string[];
}

/**
 * The sign-in discovery performed and verified against the application, recorded so the generated page object
 * can perform the same sign-in and reach the states behind the login form. Holds element names and environment
 * variable names only — never a credential value.
 */
export interface PageMapAuth {
  /** State holding the sign-in form (an entry state). */
  loginState: string;
  /** State the sign-in landed on. */
  signedInState: string;
  /** Names, in `loginState`, of the identifier field, the password field and the submit control. */
  identifier: string;
  password: string;
  submit: string;
  /** Environment variables the identifier and the password are read from. */
  identifierEnv: string;
  passwordEnv: string;
}

/** Page map for one feature. */
export interface PageMap {
  version: 1 | typeof PAGE_MAP_VERSION;
  featureId: string;
  testIdAttribute?: string;
  states: PageState[];
  traces?: TestCaseTrace[];
  flows?: VerifiedFlow[];
  auth?: PageMapAuth;
}

/**
 * Creates an empty page map.
 * @param {string} featureId
 * @param {string} [testIdAttribute]
 * @returns {PageMap}
 */
export function emptyPageMap(featureId: string, testIdAttribute?: string): PageMap {
  return {
    version: PAGE_MAP_VERSION, featureId, testIdAttribute, states: [], traces: [], flows: [],
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
    if (![1, PAGE_MAP_VERSION].includes(map?.version) || !Array.isArray(map.states)) return null;
    if (map.testIdAttribute !== testIdAttribute) return null;
    return {
      ...map,
      version: PAGE_MAP_VERSION,
      traces: Array.isArray(map.traces) ? map.traces : [],
      flows: Array.isArray(map.flows) ? map.flows : [],
    };
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

/** Words of a dialog title kept in a state name; the rest of a long title adds nothing to its identity. */
const OVERLAY_NAME_WORDS = 4;

/**
 * Human-readable overlay identity, e.g. `alertdialog "Log out?"` or `menu`.
 * @param {StateOverlay | undefined} overlay
 * @returns {string | undefined}
 */
export function overlayLabel(overlay: StateOverlay | undefined): string | undefined {
  if (!overlay) return undefined;
  return overlay.name ? `${overlay.role} "${overlay.name}"` : overlay.role;
}

/**
 * Identity of a state: its URL path and the overlay open in it.
 * @param {Pick<PageState, 'urlPath' | 'overlay'>} state
 * @returns {string}
 */
export function stateKey(state: Pick<PageState, 'urlPath' | 'overlay'>): string {
  return `${state.urlPath}|${overlayLabel(state.overlay) || ''}`;
}

/**
 * Suffix that names an overlay inside a state name. A dialog is named by its title ("Log out?" → "LogOutDialog");
 * a menu by its role alone, because a menu's accessible name is usually borrowed from its trigger — often the
 * signed-in user's initial or name, which must not become a state name.
 * @param {StateOverlay} overlay
 * @returns {string}
 */
function overlaySuffix(overlay: StateOverlay): string {
  const words = /dialog$/.test(overlay.role) && overlay.name
    ? overlay.name.split(/[^a-zA-Z0-9]+/).filter(Boolean).slice(0, OVERLAY_NAME_WORDS)
    : [];
  const kind = /dialog$/.test(overlay.role) ? 'Dialog' : toPascal(overlay.role);
  return `${toPascal(toCamel(words))}${kind}`;
}

/**
 * State name from a URL path and the overlay open there ("/" → "start", "/account/settings.html" → "accountSettings",
 * "/" with the "Log out?" alertdialog open → "startLogOutDialog").
 * @param {string} urlPath
 * @param {StateOverlay | undefined} overlay
 * @param {Set<string>} taken
 * @returns {string}
 */
export function stateNameFor(urlPath: string, overlay: StateOverlay | undefined, taken: Set<string>): string {
  const words = urlPath.replace(/\.[a-z0-9]+$/i, '').split(/[^a-zA-Z0-9]+/).filter(Boolean);
  let base = words.length === 0 ? 'start' : toCamel(words);
  if (/^[0-9]/.test(base)) base = `page${toPascal(base)}`;
  return uniqueName(overlay ? `${base}${overlaySuffix(overlay)}` : base, taken);
}

/**
 * State name from a URL path alone.
 * @param {string} urlPath
 * @param {Set<string>} taken
 * @returns {string}
 */
export function stateNameForPath(urlPath: string, taken: Set<string>): string {
  return stateNameFor(urlPath, undefined, taken);
}

/**
 * Merges a freshly captured state into the map. Existing elements keep their names; new elements are added
 * with unique names. States are matched by URL path and open overlay.
 * @param {PageMap} map
 * @param {PageState} incoming
 * @returns {PageState} The merged state stored in the map
 */
export function mergeState(map: PageMap, incoming: PageState): PageState {
  const existing = map.states.find((state) => stateKey(state) === stateKey(incoming));
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
