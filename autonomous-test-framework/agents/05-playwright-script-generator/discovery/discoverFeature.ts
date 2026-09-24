'use strict';

/**
 * @fileoverview Feature-level discovery orchestration.
 * 1. Captures every AUT-profile entry path.
 * 2. When the profile allows it, executes each approved test case's steps against the real application
 *    (actions planned by the LLM from verified elements only) to reach and capture deeper states.
 * Anything that cannot be reached or bound is reported per test case as NEEDS_CONTEXT — never guessed.
 */

import { DISCOVERY_SETTINGS, GOTO_OPERATION, PRECONDITION_STEP_INDEX } from '../constants';
import { ChatFn } from '../types';
import { TraceRecorder, traceLabel } from '../../../core/llm/stagePromptTrace';
import { AutomationTestCase } from '../contracts/automationTestCase';
import { authenticateSession, findSignInControls, signedInStarts } from './authBootstrap';
import { MissingItem } from '../../../core/readiness/readinessTypes';
import { ResolvedAutProfile } from '../../../core/aut/AutProfile';
import { parseJsonObject } from '../sub-agents/shared/generation-utils';
import { DiscoverySession } from './domDiscovery';
import {
  PageMap, PageState, TestCaseTrace, TraceAction, emptyPageMap, loadPageMap, savePageMap, mergeState, locatorSignature,
} from './pageMap';
import { extractFlows } from './flowExtractor';
import {
  NavigationPlan, PlannedAction, PAGE_OPERATIONS, buildPlannerRequest, validateNavigationPlan, resolveActionValue,
} from './navigationPlanner';

/** Inputs for discovering one feature. */
export interface DiscoverFeatureParams {
  featureId: string;
  testCases: AutomationTestCase[];
  profile: ResolvedAutProfile;
  pageMapFile: string;
  fixtureValues: Record<string, unknown>;
  plannerSystemPrompt: string;
  chat: ChatFn;
  logger: any;
  headless?: boolean;
  /**
   * Sign every test case in with the profile's declared credentials (--authenticate). Without it,
   * each test case is signed in only when its precondition — or its feature — needs a session
   * (see signedInStarts): a test case that exercises the login form itself meets it signed out.
   */
  authenticate?: boolean;
  /** Records each navigation-plan request and its attempts for the prompt trace (optional). */
  trace?: TraceRecorder;
}

/** Discovery output. */
export interface DiscoveryResult {
  pageMap: PageMap;
  /** Test cases whose required states/data could not be verified. */
  issues: Map<string, MissingItem[]>;
}

async function captureAndMerge(session: DiscoverySession, map: PageMap, entryPath?: string, reloadVerify = false): Promise<PageState> {
  const live = await session.captureState(map.states, entryPath, reloadVerify);
  const merged = mergeState(map, live);
  const liveSignatures = new Set(live.elements.map((element) => locatorSignature(element)));
  return { ...merged, elements: merged.elements.filter((element) => liveSignatures.has(locatorSignature(element))) };
}

async function requestPlan(
  params: DiscoverFeatureParams,
  tc: AutomationTestCase,
  map: PageMap,
  current: PageState,
  fromStep: number,
  executed: PlannedAction[],
): Promise<{ plan?: NavigationPlan; error?: string }> {
  const request = buildPlannerRequest(tc, map.states, current, fromStep, executed);
  let errors: string[] = [];
  const group = params.trace?.group(`plan ${tc.tcKey} step ${fromStep}`, 'Navigation plan',
    `${params.featureId}/${tc.tcKey} from step ${fromStep} in state ${current.name}`, { 'Verified elements': current.elements.length })
    ?? `plan ${tc.tcKey} step ${fromStep}`;
  for (let attempt = 0; attempt < DISCOVERY_SETTINGS.PLANNER_ATTEMPTS; attempt += 1) {
    const content = errors.length > 0 ? `${request}\n\nYour previous plan was rejected:\n- ${errors.join('\n- ')}` : request;
    // eslint-disable-next-line no-await-in-loop -- each attempt depends on the previous rejection
    const text = await params.chat([{ role: 'system', content: params.plannerSystemPrompt }, { role: 'user', content }], { json: true, traceLabel: traceLabel(group, attempt + 1) });
    let raw: any;
    try {
      raw = parseJsonObject(text);
    } catch (err: any) {
      errors = [`Response is not a JSON object: ${err.message}`];
      params.trace?.attempt(group, { attempt: attempt + 1, summary: 'plan rejected', errors });
      continue;
    }
    const result = validateNavigationPlan(raw, current, tc, map.states, fromStep);
    params.trace?.attempt(group, { attempt: attempt + 1, summary: result.plan ? 'plan accepted' : 'plan rejected', errors: result.plan ? [] : result.errors });
    if (result.plan) return { plan: result.plan };
    errors = result.errors;
  }
  return { error: errors.join('; ') };
}

async function executePlan(
  session: DiscoverySession,
  plan: NavigationPlan,
  current: PageState,
  tc: AutomationTestCase,
  params: DiscoverFeatureParams,
  map: PageMap,
): Promise<{ missing?: MissingItem; performed: TraceAction[] }> {
  const performed: TraceAction[] = [];
  for (const action of plan.actions) {
    if (action.op === GOTO_OPERATION) {
      const target = map.states.find((state) => state.name === action.state);
      if (!target) return { missing: { kind: 'STATE', detail: `State ${action.state} is not in the page map.` }, performed };
      // eslint-disable-next-line no-await-in-loop -- actions must run in order against the live page
      await session.goto(target.urlPath);
      performed.push({
        stepIndex: action.stepIndex, state: current.name, op: GOTO_OPERATION, target: target.name,
      });
      continue;
    }
    if (PAGE_OPERATIONS.includes(action.op)) {
      // eslint-disable-next-line no-await-in-loop -- actions must run in order against the live page
      await session.performPage(action.op);
      performed.push({ stepIndex: action.stepIndex, state: current.name, op: action.op });
      continue;
    }
    const element = current.elements.find((e) => e.name === action.element);
    if (!element) return { missing: { kind: 'LOCATOR', detail: `Element ${action.element} is not present in state ${current.name}.` }, performed };
    const resolved = resolveActionValue(action, tc, params.fixtureValues);
    if (resolved.missing) return { missing: resolved.missing, performed };
    // eslint-disable-next-line no-await-in-loop -- actions must run in order against the live page
    await session.perform(element, action.op, resolved.value);
    performed.push({
      stepIndex: action.stepIndex, state: current.name, element: element.name, op: action.op, value: action.value,
    });
  }
  return { performed };
}

/** Records the actions a plan performed and the state reached after each step it covered. */
function recordPlan(
  trace: TestCaseTrace,
  tc: AutomationTestCase,
  step: { plan: NavigationPlan; fromStep: number; before: string; after: string; performed: TraceAction[] },
): void {
  const {
    plan, fromStep, before, after, performed,
  } = step;
  if (performed.length > 0) trace.runs.push({ state: before, actions: performed, reachedState: after });
  const lastStep = Math.max(...tc.steps.map((s) => s.index));
  const lastCovered = plan.stopReason === 'COMPLETE' ? lastStep : (plan.nextStep ?? fromStep) - 1;
  const lastActionStep = performed.length > 0 ? performed[performed.length - 1].stepIndex : undefined;
  for (let index = fromStep; index <= lastCovered; index += 1) {
    trace.stateAfterStep[index] = lastActionStep !== undefined && index < lastActionStep ? before : after;
  }
}

/**
 * The test case as discovery plans it: its precondition, when it has one, is step PRECONDITION_STEP_INDEX, planned
 * and performed before step 1. The precondition is the situation the test starts from ("the user menu is open",
 * "the user has logged out"); the planner establishes it with verified elements exactly as it performs a step, or
 * plans nothing for it when the current state already satisfies it.
 * @param {AutomationTestCase} tc
 * @returns {AutomationTestCase}
 */
export function withPreconditionStep(tc: AutomationTestCase): AutomationTestCase {
  const precondition = tc.precondition.trim();
  if (!precondition) return tc;
  const step: AutomationTestCase['steps'][number] = {
    index: PRECONDITION_STEP_INDEX, keyword: 'Given', action: `Precondition: ${precondition}`, expected: [], testData: '', data: [],
  };
  return { ...tc, steps: [step, ...tc.steps] };
}

/** "Precondition" for the precondition step, "Step N" otherwise. */
function stepLabel(index: number): string {
  return index === PRECONDITION_STEP_INDEX ? 'Precondition' : `Step ${index}`;
}

/** The missing kind a failure at a step is reported as: the precondition has its own. */
function missingKindAt(index: number): MissingItem['kind'] {
  return index === PRECONDITION_STEP_INDEX ? 'PRECONDITION' : 'STATE';
}

async function crawlTestCase(
  session: DiscoverySession,
  map: PageMap,
  tc: AutomationTestCase,
  params: DiscoverFeatureParams,
  startSignedIn: boolean,
): Promise<{ missing: MissingItem | null; trace: TestCaseTrace }> {
  const { discovery } = params.profile;
  const trace: TestCaseTrace = { tcKey: tc.tcKey, runs: [], stateAfterStep: {} };
  const fail = (missing: MissingItem) => ({ missing, trace });
  const planned = withPreconditionStep(tc);
  try {
    await session.reset();
    const entryPath = discovery.entryPaths[0];
    await session.goto(entryPath);
    let current = await captureAndMerge(session, map, entryPath);
    // reset() isolates each test case by clearing the session, which also signs the browser out.
    // A test case that starts behind the login form must therefore sign in again here, or it is
    // planned from the login page and its precondition can never be met.
    if (startSignedIn) {
      const { state, reason } = await signIn(session, map, params, current);
      if (!state) return fail({ kind: 'AUTH', detail: `Discovery could not sign in to reach the state this test case starts from: ${reason}` });
      current = state;
    }
    let fromStep = planned.steps[0].index;
    const executed: PlannedAction[] = [];
    // The precondition may take several states to establish (a menu, then a dialog, then a logout); those rounds
    // have their own depth budget so they never eat into the one the steps get.
    const rounds = { [PRECONDITION_STEP_INDEX]: 0, steps: 0 };
    while (rounds.steps <= discovery.maxDepth && rounds[PRECONDITION_STEP_INDEX] <= discovery.maxDepth) {
      const startedAt = fromStep;
      // eslint-disable-next-line no-await-in-loop -- each state depends on the previous one
      const { plan, error } = await requestPlan(params, planned, map, current, fromStep, executed);
      if (!plan) return fail({ kind: missingKindAt(fromStep), detail: `No valid navigation plan from verified elements: ${error}` });
      // eslint-disable-next-line no-await-in-loop
      const { missing, performed } = await executePlan(session, plan, current, planned, params, map);
      if (missing) return fail(missing);
      executed.push(...plan.actions);
      const before = current.name;
      // eslint-disable-next-line no-await-in-loop
      current = await captureAndMerge(session, map);
      recordPlan(trace, planned, {
        plan, fromStep, before, after: current.name, performed,
      });
      if (plan.stopReason === 'COMPLETE') return { missing: null, trace };
      const at = plan.nextStep ?? fromStep;
      if (plan.stopReason === 'NOT_ACHIEVABLE') {
        return fail({ kind: missingKindAt(at), detail: `${stepLabel(at)}: ${plan.detail || 'not achievable with verified elements'}` });
      }
      if (plan.actions.length === 0 || (plan.nextStep as number) < fromStep) {
        return fail({ kind: missingKindAt(fromStep), detail: `Discovery made no progress at ${stepLabel(fromStep).toLowerCase()}: ${plan.detail || 'required element not present'}` });
      }
      fromStep = plan.nextStep as number;
      if (startedAt === PRECONDITION_STEP_INDEX) rounds[PRECONDITION_STEP_INDEX] += 1; else rounds.steps += 1;
    }
    return fail({ kind: 'STATE', detail: `Required state not reached within discovery.maxDepth=${discovery.maxDepth}.` });
  } catch (err: any) {
    return fail({ kind: 'STATE', detail: `Discovery could not execute the test steps: ${err.message}` });
  }
}

/**
 * Signs in and captures the state that follows, so the crawl starts from an authenticated session.
 *
 * A failure to sign in is recorded as a warning rather than raised: the crawl still runs, and each
 * test case that needed the authenticated state reports precisely what it could not reach.
 *
 * The first sign-in that works is recorded on the page map: the page object renders it as `signIn()`,
 * which is the only way a generated test can reach a state behind the login form — credentials are
 * kept out of test data, so no test body can perform the sign-in itself.
 *
 * @param {DiscoverySession} session
 * @param {PageMap} map
 * @param {DiscoverFeatureParams} params
 * @param {PageState} from - The verified entry state holding the sign-in form
 * @returns {Promise<{ state?: PageState, reason?: string }>}
 */
async function signIn(
  session: DiscoverySession,
  map: PageMap,
  params: DiscoverFeatureParams,
  from: PageState,
): Promise<{ state?: PageState; reason?: string }> {
  // A client-rendered form may mount after the entry capture; re-capture it rather than judge a partial state.
  const wait = {
    recapture: () => captureAndMerge(session, map, from.entryPath),
    budgetMs: DISCOVERY_SETTINGS.NAVIGATION_TIMEOUT_MS,
    pollMs: DISCOVERY_SETTINGS.SIGN_IN_FORM_POLL_MS,
  };
  const result = await authenticateSession(session, from, params.profile.auth.credentialEnvVars || {}, process.env, wait);
  if (!result.signedIn) return { reason: result.reason };
  // The states behind the form may show the account's identifier; discovery can now recognise it when they do.
  if (result.form) session.setAccountIdentifier({ envName: result.form.identifierEnv, value: process.env[result.form.identifierEnv] as string });
  const state = await captureAndMerge(session, map, undefined, false);
  if (!map.auth && result.form) map.auth = { loginState: from.name, signedInState: state.name, ...result.form };
  return { state };
}

/**
 * Returns the browser to the entry state discovery signs in from, and returns that state.
 *
 * The entry paths are visited in turn, so the browser ends on the last one, which is often a page behind
 * the login form. Signing in there would wait out the whole navigation budget for a form that never renders.
 * An entry state that already holds the whole form is preferred. Otherwise the first entry path is used, as
 * each test case does when it signs in again, so a form that mounts late still gets its wait.
 * @param {DiscoverySession} session
 * @param {PageMap} map
 * @param {string[]} entryPaths - From the AUT profile
 * @returns {Promise<PageState | undefined>}
 */
async function goToSignInEntry(session: DiscoverySession, map: PageMap, entryPaths: string[]): Promise<PageState | undefined> {
  const entryStates = map.states.filter((state) => state.entryPath && !state.overlay);
  const target = entryStates.find((state) => findSignInControls(state))
    || entryStates.find((state) => state.entryPath === entryPaths[0])
    || map.states[0];
  if (!target) return undefined;
  if (target.entryPath && session.currentPath() !== target.urlPath) await session.goto(target.entryPath);
  return target;
}

/**
 * Discovers verified page states for a feature and persists the page map.
 * @param {DiscoverFeatureParams} params
 * @returns {Promise<DiscoveryResult>}
 */
export async function discoverFeature(params: DiscoverFeatureParams): Promise<DiscoveryResult> {
  const { profile } = params;
  const pageMap = loadPageMap(params.pageMapFile, profile.testIdAttribute) || emptyPageMap(params.featureId, profile.testIdAttribute);
  const issues = new Map<string, MissingItem[]>();
  const addIssue = (tcKey: string, item: MissingItem) => issues.set(tcKey, [...(issues.get(tcKey) || []), item]);
  const traces: TestCaseTrace[] = [];
  if (!profile.baseURL) {
    params.testCases.forEach((tc) => addIssue(tc.tcKey, { kind: 'AUT_UNREACHABLE', detail: `Environment variable ${profile.baseUrlEnv} is not set.` }));
    return { pageMap, issues };
  }

  let session: DiscoverySession | null = null;
  try {
    session = await DiscoverySession.open({
      baseURL: profile.baseURL,
      testIdAttribute: profile.testIdAttribute,
      dynamicIdPatterns: (profile.discovery.dynamicIdPatterns || []).map((pattern) => new RegExp(pattern)),
      headless: params.headless,
      extraLocators: profile.discovery.extraLocators || [],
    });
    for (const entryPath of profile.discovery.entryPaths) {
      // eslint-disable-next-line no-await-in-loop -- one browser page, sequential navigation
      await session.goto(entryPath);
      // eslint-disable-next-line no-await-in-loop
      await captureAndMerge(session, pageMap, entryPath, true);
    }
    const signIns = signedInStarts(params.testCases, profile.auth.credentialEnvVars || {}, params.authenticate);
    if (params.authenticate || signIns.size > 0) {
      params.logger?.info?.('Discovery signs in for', { featureId: params.featureId, testCases: [...signIns].sort() });
      const from = await goToSignInEntry(session, pageMap, profile.discovery.entryPaths);
      const bootstrap = from ? await signIn(session, pageMap, params, from) : { reason: 'No entry state was captured.' };
      if (bootstrap.state) {
        params.logger?.info?.('Discovery signed in', { featureId: params.featureId, state: bootstrap.state.name, elements: bootstrap.state.elements.length });
      } else {
        params.logger?.warn?.('Discovery could not sign in', { featureId: params.featureId, reason: bootstrap.reason });
      }
    }
    if (profile.discovery.executeTestSteps) {
      for (const tc of params.testCases) {
        // eslint-disable-next-line no-await-in-loop -- test cases share one browser, run sequentially
        const { missing, trace } = await crawlTestCase(session, pageMap, tc, params, signIns.has(tc.tcKey));
        if (missing) addIssue(tc.tcKey, missing);
        else traces.push(trace);
      }
    }
  } catch (err: any) {
    params.logger?.warn?.('DOM discovery failed', { featureId: params.featureId, error: err.message });
    params.testCases
      .filter((tc) => !issues.has(tc.tcKey))
      .forEach((tc) => addIssue(tc.tcKey, { kind: 'AUT_UNREACHABLE', detail: `Discovery could not open the application: ${err.message}` }));
  } finally {
    await session?.close();
  }

  pageMap.traces = traces;
  pageMap.flows = extractFlows(pageMap, params.testCases);
  savePageMap(params.pageMapFile, pageMap);
  return { pageMap, issues };
}
