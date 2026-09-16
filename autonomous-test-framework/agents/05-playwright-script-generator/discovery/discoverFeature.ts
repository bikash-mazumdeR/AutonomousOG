'use strict';

/**
 * @fileoverview Feature-level discovery orchestration.
 * 1. Captures every AUT-profile entry path.
 * 2. When the profile allows it, executes each approved test case's steps against the real application
 *    (actions planned by the LLM from verified elements only) to reach and capture deeper states.
 * Anything that cannot be reached or bound is reported per test case as NEEDS_CONTEXT — never guessed.
 */

import { DISCOVERY_SETTINGS } from '../constants';
import { ChatFn } from '../types';
import { AutomationTestCase } from '../contracts/automationTestCase';
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
}

/** Discovery output. */
export interface DiscoveryResult {
  pageMap: PageMap;
  /** Test cases whose required states/data could not be verified. */
  issues: Map<string, MissingItem[]>;
}

function otherStateNames(map: PageMap, urlPath: string): Set<string> {
  return new Set(map.states.filter((state) => state.urlPath !== urlPath).map((state) => state.name));
}

async function captureAndMerge(session: DiscoverySession, map: PageMap, entryPath?: string, reloadVerify = false): Promise<PageState> {
  const live = await session.captureState(otherStateNames(map, session.currentPath()), entryPath, reloadVerify);
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
  for (let attempt = 0; attempt < DISCOVERY_SETTINGS.PLANNER_ATTEMPTS; attempt += 1) {
    const content = errors.length > 0 ? `${request}\n\nYour previous plan was rejected:\n- ${errors.join('\n- ')}` : request;
    // eslint-disable-next-line no-await-in-loop -- each attempt depends on the previous rejection
    const text = await params.chat([{ role: 'system', content: params.plannerSystemPrompt }, { role: 'user', content }], { json: true });
    let raw: any;
    try {
      raw = parseJsonObject(text);
    } catch (err: any) {
      errors = [`Response is not a JSON object: ${err.message}`];
      continue;
    }
    const result = validateNavigationPlan(raw, current, tc);
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
): Promise<{ missing?: MissingItem; performed: TraceAction[] }> {
  const performed: TraceAction[] = [];
  for (const action of plan.actions) {
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

async function crawlTestCase(
  session: DiscoverySession,
  map: PageMap,
  tc: AutomationTestCase,
  params: DiscoverFeatureParams,
): Promise<{ missing: MissingItem | null; trace: TestCaseTrace }> {
  const { discovery } = params.profile;
  const trace: TestCaseTrace = { tcKey: tc.tcKey, runs: [], stateAfterStep: {} };
  const fail = (missing: MissingItem) => ({ missing, trace });
  try {
    await session.reset();
    const entryPath = discovery.entryPaths[0];
    await session.goto(entryPath);
    let current = await captureAndMerge(session, map, entryPath);
    let fromStep = 1;
    const executed: PlannedAction[] = [];
    for (let depth = 0; depth <= discovery.maxDepth; depth += 1) {
      // eslint-disable-next-line no-await-in-loop -- each state depends on the previous one
      const { plan, error } = await requestPlan(params, tc, map, current, fromStep, executed);
      if (!plan) return fail({ kind: 'STATE', detail: `No valid navigation plan from verified elements: ${error}` });
      // eslint-disable-next-line no-await-in-loop
      const { missing, performed } = await executePlan(session, plan, current, tc, params);
      if (missing) return fail(missing);
      executed.push(...plan.actions);
      const before = current.name;
      // eslint-disable-next-line no-await-in-loop
      current = await captureAndMerge(session, map);
      recordPlan(trace, tc, {
        plan, fromStep, before, after: current.name, performed,
      });
      if (plan.stopReason === 'COMPLETE') return { missing: null, trace };
      if (plan.stopReason === 'NOT_ACHIEVABLE') {
        return fail({ kind: 'STATE', detail: `Step ${plan.nextStep ?? fromStep}: ${plan.detail || 'not achievable with verified elements'}` });
      }
      if (plan.actions.length === 0 || (plan.nextStep as number) < fromStep) {
        return fail({ kind: 'STATE', detail: `Discovery made no progress at step ${fromStep}: ${plan.detail || 'required element not present'}` });
      }
      fromStep = plan.nextStep as number;
    }
    return fail({ kind: 'STATE', detail: `Required state not reached within discovery.maxDepth=${discovery.maxDepth}.` });
  } catch (err: any) {
    return fail({ kind: 'STATE', detail: `Discovery could not execute the test steps: ${err.message}` });
  }
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
    if (profile.discovery.executeTestSteps) {
      for (const tc of params.testCases) {
        // eslint-disable-next-line no-await-in-loop -- test cases share one browser, run sequentially
        const { missing, trace } = await crawlTestCase(session, pageMap, tc, params);
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
