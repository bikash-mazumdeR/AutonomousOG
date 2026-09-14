'use strict';

/**
 * @fileoverview Deterministic page-object renderer. Turns a verified page map into a TypeScript page object
 * (getters for verified locators + navigation methods for entry states) and the page contract the LLM is
 * allowed to use. No LLM is involved in choosing locators.
 */

import { GENERATED_MARKER, PAGE_FIXTURE } from '../constants';
import {
  PageElement, PageMap, PageState, locatorSignature, toPascal, uniqueName,
} from '../discovery/pageMap';

/** A member the generated test bodies may use. */
export interface ContractMember {
  name: string;
  kind: 'locator' | 'method';
  state: string;
  description: string;
}

/** Closed-world description of the page object handed to the LLM. */
export interface PageContract {
  fixture: string;
  pageObject: string;
  states: Array<{ name: string; urlPath: string }>;
  members: ContractMember[];
}

/** Renderer output. */
export interface PomRenderResult {
  contract: PageContract;
  code: string;
}

/** BasePage members a generated page object must not shadow. */
const RESERVED_MEMBERS: ReadonlySet<string> = new Set([
  'page', 'constructor', 'navigate', 'reload', 'goBack', 'waitForVisible', 'waitForURL', 'waitForResponse', 'waitForLoad',
  'safeClick', 'safeFill', 'safeSelect', 'uploadFile', 'scrollIntoView', 'assertVisible', 'assertHidden', 'assertText',
  'assertURL', 'assertTitle', 'takeScreenshot', 'saveNetworkLog', 'saveConsoleLog',
]);

interface AssignedElement {
  memberName: string;
  element: PageElement;
  state: PageState;
}

/**
 * Page-object class name from a feature id ("F-01" → "F01Page").
 * @param {string} featureId
 * @returns {string}
 */
export function pageObjectClassName(featureId: string): string {
  const compact = String(featureId).replace(/[^A-Za-z0-9]/g, '');
  return `${toPascal(/^[A-Za-z]/.test(compact) ? compact : `Feature${compact}`)}Page`;
}

function cssIdSelector(id: string): string {
  return `#${id.replace(/([^a-zA-Z0-9_-])/g, '\\$1')}`;
}

/**
 * TypeScript expression for a verified locator.
 * @param {Pick<PageElement, 'strategy'|'args'>} element
 * @returns {string}
 */
export function locatorExpression(element: Pick<PageElement, 'strategy' | 'args'>): string {
  const [first, second] = element.args.map((arg) => JSON.stringify(arg));
  switch (element.strategy) {
    case 'testId': return `this.page.getByTestId(${first})`;
    case 'role': return `this.page.getByRole(${first}, { name: ${second}, exact: true })`;
    case 'label': return `this.page.getByLabel(${first}, { exact: true })`;
    case 'placeholder': return `this.page.getByPlaceholder(${first}, { exact: true })`;
    case 'text': return `this.page.getByText(${first}, { exact: true })`;
    default: return `this.page.locator(${JSON.stringify(cssIdSelector(element.args[0]))})`;
  }
}

function describeElement(element: PageElement, state: PageState): string {
  const kind = element.inputType === 'password' ? 'password input' : (element.role || element.tag);
  const name = element.accessibleName ? ` "${element.accessibleName}"` : '';
  return `${kind}${name} (state: ${state.name})`.replace(/\*\//g, '* /');
}

function assignElements(map: PageMap, taken: Set<string>): AssignedElement[] {
  const bySignature = new Set<string>();
  const assigned: AssignedElement[] = [];
  for (const state of map.states) {
    for (const element of state.elements) {
      const signature = locatorSignature(element);
      if (bySignature.has(signature)) continue;
      bySignature.add(signature);
      const base = taken.has(element.name) || RESERVED_MEMBERS.has(element.name) ? `${state.name}${toPascal(element.name)}` : element.name;
      const memberName = uniqueName(base, new Set([...taken, ...RESERVED_MEMBERS]));
      taken.add(memberName);
      assigned.push({ memberName, element, state });
    }
  }
  return assigned;
}

/**
 * Renders the page object and its contract.
 * @param {PageMap} map
 * @param {{ className: string, basePageImport: string, projectSlug: string }} options
 * @returns {PomRenderResult}
 */
export function renderPom(map: PageMap, options: { className: string; basePageImport: string; projectSlug: string }): PomRenderResult {
  const taken = new Set<string>();
  const methods = map.states.filter((state) => state.entryPath).map((state) => {
    const name = uniqueName(`open${toPascal(state.name)}`, taken);
    taken.add(name);
    return { name, state };
  });
  const elements = assignElements(map, taken);
  const contract: PageContract = {
    fixture: PAGE_FIXTURE,
    pageObject: options.className,
    states: map.states.map((state) => ({ name: state.name, urlPath: state.urlPath })),
    members: [
      ...methods.map((m) => ({
        name: m.name, kind: 'method' as const, state: m.state.name, description: `Navigate to the "${m.state.name}" state (${m.state.urlPath}).`,
      })),
      ...elements.map((a) => ({
        name: a.memberName, kind: 'locator' as const, state: a.state.name, description: describeElement(a.element, a.state),
      })),
    ],
  };

  const code = [
    `// ${GENERATED_MARKER} project=${options.projectSlug} feature=${map.featureId} source=page-map`,
    '// Rendered from the verified page map by ARIA Agent 05. Do not edit by hand; regenerate instead.',
    "import { Page, Locator } from '@playwright/test';",
    `import { BasePage } from '${options.basePageImport}';`,
    '',
    '/**',
    ` * Page object for feature ${map.featureId}. Every locator resolved to exactly one element during discovery.`,
    ' */',
    `export class ${options.className} extends BasePage {`,
    '  constructor(page: Page) {',
    `    super(page, '${options.className}');`,
    '  }',
    ...methods.flatMap((m) => [
      '', `  /** Navigate to the "${m.state.name}" state. */`, `  async ${m.name}(): Promise<void> {`,
      `    await this.navigate(${JSON.stringify(m.state.entryPath)});`, '  }',
    ]),
    ...elements.flatMap((a) => [
      '', `  /** ${describeElement(a.element, a.state)} */`, `  get ${a.memberName}(): Locator {`,
      `    return ${locatorExpression(a.element)};`, '  }',
    ]),
    '}',
    '',
  ].join('\n');

  return { contract, code };
}
