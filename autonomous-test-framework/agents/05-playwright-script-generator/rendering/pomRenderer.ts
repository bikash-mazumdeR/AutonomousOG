'use strict';

/**
 * @fileoverview Deterministic page-object renderer. Turns a verified page map into a TypeScript page object —
 * getters for verified locators, navigation methods for entry states, and action-only methods for flows that several
 * test cases performed identically during discovery — and the page contract the LLM is allowed to use.
 * No LLM is involved in choosing locators or flows.
 */

import {
  GENERATED_MARKER, PAGE_FIXTURE, POM_ENV_FUNCTION, SIGN_IN_METHOD,
} from '../constants';
import {
  PageElement, PageMap, PageMapAuth, PageState, VerifiedFlow, locatorSignature, overlayLabel, toPascal, uniqueName,
} from '../discovery/pageMap';

/** @enum {string} Kinds of page-contract member. */
export const MEMBER_KIND = Object.freeze({
  LOCATOR: 'locator',
  METHOD: 'method',
  FLOW: 'flow',
} as const);

export type MemberKind = typeof MEMBER_KIND[keyof typeof MEMBER_KIND];

/** A member the generated test bodies may use. */
export interface ContractMember {
  name: string;
  kind: MemberKind;
  state: string;
  description: string;
  /** Flow members only: verified flow id, value parameters and the member/operation of each action. */
  flowId?: string;
  params?: string[];
  actions?: Array<{ member?: string; op: string }>;
}

/** Closed-world description of the page object handed to the LLM. */
export interface PageContract {
  fixture: string;
  pageObject: string;
  /** `overlay` names the dialog or menu that is open in that state — same URL as the state underneath it. */
  states: Array<{ name: string; urlPath: string; overlay?: string }>;
  members: ContractMember[];
}

/** Renderer output. */
export interface PomRenderResult {
  contract: PageContract;
  code: string;
}

/** Page-object rendering options. */
export interface PomOptions {
  className: string;
  basePageImport: string;
  projectSlug: string;
  /** Import path of the framework env helper; needed when the page map records a verified sign-in. */
  envHelperImport?: string;
}

/** BasePage fields and methods a generated page object must not shadow. */
export const RESERVED_MEMBERS: ReadonlySet<string> = new Set([
  'page', 'constructor', '_name', '_network', '_console', 'navigate', 'reload', 'goBack', 'waitForVisible', 'waitForURL',
  'waitForResponse', 'waitForLoad', 'safeClick', 'safeFill', 'safeSelect', 'uploadFile', 'scrollIntoView', '_logAction',
  '_getLocatorDesc', 'assertVisible', 'assertHidden', 'assertText', 'assertURL', 'assertTitle', 'takeScreenshot',
  'saveNetworkLog', 'saveConsoleLog', '_attachCaptures', '_ensureDirs',
]);

interface AssignedElement {
  memberName: string;
  element: PageElement;
  state: PageState;
}

interface RenderedFlow {
  name: string;
  flow: VerifiedFlow;
  actions: Array<{ member?: string; op: string; param?: string }>;
}

/** The verified sign-in resolved to page-object members. */
interface RenderedSignIn {
  name: string;
  loginState: PageState;
  signedInState: PageState;
  identifier: string;
  password: string;
  submit: string;
  identifierEnv: string;
  passwordEnv: string;
}

/** A navigation method: opens an entry state directly, or a state behind the login form by signing in. */
interface OpenMethod {
  name: string;
  state: PageState;
  viaSignIn?: boolean;
}

interface PomParts {
  methods: OpenMethod[];
  signIn?: RenderedSignIn;
  flows: RenderedFlow[];
  elements: AssignedElement[];
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
    case 'role': return second === undefined ? `this.page.getByRole(${first})` : `this.page.getByRole(${first}, { name: ${second}, exact: true })`;
    case 'label': return `this.page.getByLabel(${first}, { exact: true })`;
    case 'placeholder': return `this.page.getByPlaceholder(${first}, { exact: true })`;
    case 'text': return `this.page.getByText(${first}, { exact: true })`;
    case 'css': return `this.page.locator(${first})`;
    default: return `this.page.locator(${JSON.stringify(cssIdSelector(element.args[0]))})`;
  }
}

function describeElement(element: PageElement, state: PageState): string {
  const kind = element.inputType === 'password' ? 'password input' : (element.role || element.tag);
  const name = element.accessibleName ? ` "${element.accessibleName}"` : (element.description ? ` — ${element.description}` : '');
  return `${kind}${name} (state: ${state.name})`.replace(/\*\//g, '* /');
}

function openMethods(map: PageMap, taken: Set<string>): OpenMethod[] {
  return map.states.filter((state) => state.entryPath).map((state) => {
    const name = uniqueName(`open${toPascal(state.name)}`, taken);
    taken.add(name);
    return { name, state };
  });
}

/**
 * Resolves the recorded sign-in to page-object members. Dropped, like a flow, when any of its elements or states is
 * no longer in the page map — a sign-in that cannot be rendered faithfully must not be rendered at all.
 * @param {PageMapAuth | undefined} auth
 * @param {PageMap} map
 * @param {AssignedElement[]} elements
 * @param {string} name - Reserved member name
 * @returns {RenderedSignIn | undefined}
 */
function resolveSignIn(auth: PageMapAuth | undefined, map: PageMap, elements: AssignedElement[], name: string): RenderedSignIn | undefined {
  if (!auth) return undefined;
  const loginState = map.states.find((state) => state.name === auth.loginState);
  const signedInState = map.states.find((state) => state.name === auth.signedInState);
  if (!loginState || !signedInState) return undefined;
  const memberBySignature = new Map(elements.map((a) => [locatorSignature(a.element), a.memberName]));
  const memberOf = (elementName: string) => {
    const element = loginState.elements.find((candidate) => candidate.name === elementName);
    return element ? memberBySignature.get(locatorSignature(element)) : undefined;
  };
  const [identifier, password, submit] = [memberOf(auth.identifier), memberOf(auth.password), memberOf(auth.submit)];
  if (!identifier || !password || !submit) return undefined;
  return {
    name, loginState, signedInState, identifier, password, submit, identifierEnv: auth.identifierEnv, passwordEnv: auth.passwordEnv,
  };
}

/**
 * The navigation method for the signed-in state, when it has none: a state behind the login form is opened by
 * signing in. A state that is also an entry state keeps its direct navigation; `signIn()` stays available beside it.
 * @param {RenderedSignIn} signIn
 * @param {OpenMethod[]} methods
 * @param {Set<string>} taken
 * @returns {OpenMethod | undefined}
 */
function openViaSignIn(signIn: RenderedSignIn, methods: OpenMethod[], taken: Set<string>): OpenMethod | undefined {
  if (methods.some((method) => method.state.name === signIn.signedInState.name)) return undefined;
  const name = uniqueName(`open${toPascal(signIn.signedInState.name)}`, new Set([...taken, ...RESERVED_MEMBERS]));
  taken.add(name);
  return { name, state: signIn.signedInState, viaSignIn: true };
}

function describeSignIn(signIn: RenderedSignIn): string {
  return `Signs in on the "${signIn.loginState.name}" state with the account the environment provides `
    + `(${signIn.identifierEnv}, ${signIn.passwordEnv}) and lands on the "${signIn.signedInState.name}" state `
    + `(${signIn.signedInState.urlPath}). Verified by discovery; performs actions only and asserts nothing. `
    + 'Call it before any step that needs an authenticated session — never fill the sign-in form with credentials yourself.';
}

function describeOpen(method: OpenMethod): string {
  return method.viaSignIn
    ? `Navigate to the "${method.state.name}" state (${method.state.urlPath}) by signing in — it sits behind the login form (see ${SIGN_IN_METHOD}).`
    : `Navigate to the "${method.state.name}" state (${method.state.urlPath}).`;
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

/** Resolves each flow action to the page-object member of its verified element; flows with unverified elements are dropped. */
function resolveFlows(map: PageMap, elements: AssignedElement[], taken: Set<string>): RenderedFlow[] {
  const memberBySignature = new Map(elements.map((a) => [locatorSignature(a.element), a.memberName]));
  const rendered: RenderedFlow[] = [];
  for (const flow of map.flows || []) {
    const state = map.states.find((candidate) => candidate.name === flow.state);
    const actions = flow.actions.map((action) => {
      const element = action.element ? state?.elements.find((candidate) => candidate.name === action.element) : undefined;
      return { op: action.op, param: action.param, member: element ? memberBySignature.get(locatorSignature(element)) : undefined };
    });
    if (actions.some((action, idx) => flow.actions[idx].element && !action.member)) continue;
    const name = uniqueName(flow.name, new Set([...taken, ...RESERVED_MEMBERS]));
    taken.add(name);
    rendered.push({ name, flow, actions });
  }
  return rendered;
}

function flowParams(flow: RenderedFlow): string[] {
  return flow.actions.filter((action) => action.param).map((action) => action.param as string);
}

function describeFlow(flow: RenderedFlow): string {
  const steps = flow.actions.map((action) => (action.member ? `${action.op} ${action.member}` : action.op)).join(', ');
  return `Verified action sequence in state "${flow.flow.state}": ${steps}. Performs actions only and asserts nothing `
    + `(verified by ${flow.flow.usedBy.join(', ')}).`.replace(/\*\//g, '* /');
}

function buildContract(map: PageMap, className: string, parts: PomParts): PageContract {
  return {
    fixture: PAGE_FIXTURE,
    pageObject: className,
    states: map.states.map((state) => ({ name: state.name, urlPath: state.urlPath, ...(state.overlay ? { overlay: overlayLabel(state.overlay) } : {}) })),
    members: [
      ...parts.methods.map((m) => ({
        name: m.name, kind: MEMBER_KIND.METHOD, state: m.state.name, description: describeOpen(m),
      })),
      ...(parts.signIn ? [{
        name: parts.signIn.name, kind: MEMBER_KIND.METHOD, state: parts.signIn.signedInState.name, description: describeSignIn(parts.signIn),
      }] : []),
      ...parts.flows.map((f) => ({
        name: f.name,
        kind: MEMBER_KIND.FLOW,
        state: f.flow.state,
        description: describeFlow(f),
        flowId: f.flow.id,
        params: flowParams(f),
        actions: f.actions.map(({ member, op }) => ({ member, op })),
      })),
      ...parts.elements.map((a) => ({
        name: a.memberName, kind: MEMBER_KIND.LOCATOR, state: a.state.name, description: describeElement(a.element, a.state),
      })),
    ],
  };
}

function flowActionLine(action: RenderedFlow['actions'][number]): string {
  const target = action.member ? `this.${action.member}` : 'this.page';
  return `    await ${target}.${action.op}(${action.param ? `values.${action.param}` : ''});`;
}

function renderFlowMethod(flow: RenderedFlow): string[] {
  const params = flowParams(flow);
  const valuesType = `{ ${params.map((param) => `${param}: string`).join('; ')} }`;
  return [
    '',
    '  /**',
    `   * ${describeFlow(flow)}`,
    ...(params.length > 0 ? [`   * @param {{ ${params.map((param) => `${param}: string`).join(', ')} }} values`] : []),
    '   */',
    `  async ${flow.name}(${params.length > 0 ? `values: ${valuesType}` : ''}): Promise<void> {`,
    ...flow.actions.map(flowActionLine),
    '  }',
  ];
}

function renderOpenMethod(method: OpenMethod): string[] {
  const body = method.viaSignIn ? `    await this.${SIGN_IN_METHOD}();` : `    await this.navigate(${JSON.stringify(method.state.entryPath)});`;
  return ['', `  /** ${describeOpen(method)} */`, `  async ${method.name}(): Promise<void> {`, body, '  }'];
}

/** The sign-in exactly as discovery performed it: open the form's entry path, fill both fields from the environment, submit. */
function renderSignInMethod(signIn: RenderedSignIn): string[] {
  const entry = JSON.stringify(signIn.loginState.entryPath || signIn.loginState.urlPath);
  return [
    '',
    '  /**',
    `   * ${describeSignIn(signIn)}`,
    '   */',
    `  async ${signIn.name}(): Promise<void> {`,
    `    await this.navigate(${entry});`,
    `    await this.${signIn.identifier}.fill(${POM_ENV_FUNCTION}(${JSON.stringify(signIn.identifierEnv)}));`,
    `    await this.${signIn.password}.fill(${POM_ENV_FUNCTION}(${JSON.stringify(signIn.passwordEnv)}));`,
    `    await this.${signIn.submit}.click();`,
    '  }',
  ];
}

function renderPomCode(map: PageMap, options: PomOptions, parts: PomParts): string {
  return [
    `// ${GENERATED_MARKER} project=${options.projectSlug} feature=${map.featureId} source=page-map`,
    '// Rendered from the verified page map by ARIA Agent 05. Do not edit by hand; regenerate instead.',
    "import { Page, Locator } from '@playwright/test';",
    `import { BasePage } from '${options.basePageImport}';`,
    ...(parts.signIn ? [`import { ${POM_ENV_FUNCTION} } from '${options.envHelperImport}';`] : []),
    '',
    '/**',
    ` * Page object for feature ${map.featureId}. Every locator resolved to exactly one element during discovery.`,
    ' */',
    `export class ${options.className} extends BasePage {`,
    '  constructor(page: Page) {',
    `    super(page, '${options.className}');`,
    '  }',
    ...parts.methods.flatMap(renderOpenMethod),
    ...(parts.signIn ? renderSignInMethod(parts.signIn) : []),
    ...parts.flows.flatMap(renderFlowMethod),
    ...parts.elements.flatMap((a) => [
      '', `  /** ${describeElement(a.element, a.state)} */`, `  get ${a.memberName}(): Locator {`,
      `    return ${locatorExpression(a.element)};`, '  }',
    ]),
    '}',
    '',
  ].join('\n');
}

/**
 * Renders the page object and its contract.
 * @param {PageMap} map
 * @param {PomOptions} options
 * @returns {PomRenderResult}
 */
export function renderPom(map: PageMap, options: PomOptions): PomRenderResult {
  if (map.auth && !options.envHelperImport) throw new Error('envHelperImport is required to render the sign-in the page map records.');
  const taken = new Set<string>();
  const methods = openMethods(map, taken);
  const signInName = uniqueName(SIGN_IN_METHOD, taken);
  taken.add(signInName);
  const elements = assignElements(map, taken);
  const signIn = resolveSignIn(map.auth, map, elements, signInName);
  const viaSignIn = signIn ? openViaSignIn(signIn, methods, taken) : undefined;
  const parts: PomParts = {
    methods: viaSignIn ? [...methods, viaSignIn] : methods, signIn, elements, flows: resolveFlows(map, elements, taken),
  };
  return { contract: buildContract(map, options.className, parts), code: renderPomCode(map, options, parts) };
}
