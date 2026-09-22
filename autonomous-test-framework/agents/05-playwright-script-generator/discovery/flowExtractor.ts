'use strict';

/**
 * @fileoverview Turns action runs that discovery verified against the live application into reusable flows, and
 * works out which flows each test case must call, with the exact argument expressions it has to pass.
 * Everything is derived from recorded traces and verified elements; nothing is inferred about the application.
 */

import * as crypto from 'crypto';
import {
  DATA_FIXTURE, ENV_FUNCTION, FLOW_SETTINGS, GOTO_OPERATION, PRECONDITION_STEP_INDEX,
} from '../constants';
import { AutomationTestCase } from '../contracts/automationTestCase';
import {
  FlowAction, PageElement, PageMap, TestCaseTrace, TraceAction, TraceRun, VerifiedFlow, locatorSignature, overlayLabel, toPascal, uniqueName,
} from './pageMap';

/** The value a flow call must pass for one parameter. */
export type FlowArg =
  | { kind: 'data'; key: string; expression: string }
  | { kind: 'env'; name: string; expression: string }
  | { kind: 'literal'; value: string; expression: string };

/** A flow member as exposed by the rendered page contract. */
export interface FlowMemberRef {
  name: string;
  flowId: string;
  params: string[];
  actions: Array<{ member?: string; op: string }>;
}

/** One action discovery performed to establish a test case's precondition, resolved to a page-object member. */
export interface PreconditionAction {
  /**
   * Page-object member the action targets; undefined for a page operation (reload, goBack, goForward). For `goto`
   * it is the navigation method that requests the state's address, called with no arguments.
   */
  member?: string;
  op: string;
  value?: FlowArg;
}

/** A flow one test case must call. */
export interface FlowUsage {
  member: string;
  params: string[];
  /** Page-object member (undefined for page operations) and operation of each action, in order. */
  actions: Array<{ member?: string; op: string }>;
  /** One entry per time the test case performs the flow, in order. */
  calls: Array<Record<string, FlowArg>>;
  stepIndexes: number[];
}

function elementIn(map: PageMap, stateName: string, elementName?: string): PageElement | undefined {
  if (!elementName) return undefined;
  return map.states.find((state) => state.name === stateName)?.elements.find((element) => element.name === elementName);
}

/**
 * Identity of an action run: its state plus each action's verified locator, operation and whether it takes a value.
 * @param {PageMap} map
 * @param {TraceRun} run
 * @returns {string|null} null when an action references an element that is not in the page map
 */
export function runSignature(map: PageMap, run: TraceRun): string | null {
  const parts: string[] = [];
  for (const action of run.actions) {
    const element = elementIn(map, run.state, action.element);
    if (action.element && !element) return null;
    parts.push(`${element ? locatorSignature(element) : (action.target ?? '')}:${action.op}:${action.value ? 'value' : ''}`);
  }
  return `${run.state}|${parts.join('>')}`;
}

/** Whether a run established the precondition: those runs are performed explicitly by the body, never as a flow. */
function isPreconditionRun(run: TraceRun): boolean {
  return run.actions.some((action) => action.stepIndex === PRECONDITION_STEP_INDEX);
}

function flowId(signature: string): string {
  return crypto.createHash('sha1').update(signature).digest('hex').slice(0, 12);
}

function flowActions(run: TraceRun): FlowAction[] {
  const taken = new Set<string>();
  return run.actions.map((action) => {
    const target = action.target ? { target: action.target } : {};
    if (!action.value) return { element: action.element, op: action.op, ...target };
    const param = uniqueName(action.element || action.op, taken);
    taken.add(param);
    return {
      element: action.element, op: action.op, param, ...target,
    };
  });
}

function flowName(run: TraceRun, taken: Set<string>): string {
  const last = run.actions[run.actions.length - 1];
  const base = `${run.state}${toPascal(last.op)}${last.element ? toPascal(last.element) : ''}${FLOW_SETTINGS.NAME_SUFFIX}`;
  const name = uniqueName(base, taken);
  taken.add(name);
  return name;
}

/** Operations whose second consecutive use on the same element overwrites the first. */
const OVERWRITING_OPS: ReadonlySet<string> = new Set(['fill', 'selectOption']);

/**
 * Whether a run repeats an overwriting action on the same element back to back (e.g. fill username, fill username).
 * Such a run records a planning mistake — the first action has no effect — and must never become a reusable flow.
 * @param {TraceRun} run
 * @returns {boolean}
 */
export function hasRedundantActions(run: TraceRun): boolean {
  return run.actions.some((action, idx) => {
    const previous = run.actions[idx - 1];
    return idx > 0 && OVERWRITING_OPS.has(action.op) && previous.op === action.op && !!action.element && previous.element === action.element;
  });
}

/**
 * Builds the flows performed identically by at least FLOW_SETTINGS.MIN_USERS test cases. Deterministic for identical traces.
 * When the test cases are given, only test cases the flow is applicable to count as users (and appear in `usedBy`),
 * so a flow is never published as "verified by" a test case that is not allowed to call it.
 * @param {PageMap} map
 * @param {AutomationTestCase[]} [testCases]
 * @returns {VerifiedFlow[]}
 */
export function extractFlows(map: PageMap, testCases?: AutomationTestCase[]): VerifiedFlow[] {
  const tcByKey = new Map((testCases || []).map((tc) => [tc.tcKey, tc]));
  const bySignature = new Map<string, { run: TraceRun; users: Set<string> }>();
  for (const trace of map.traces || []) {
    const tc = tcByKey.get(trace.tcKey);
    for (const run of trace.runs) {
      if (isPreconditionRun(run) || hasRedundantActions(run) || (testCases && (!tc || !assertsOnlyAfterLastStep(run, tc)))) continue;
      const signature = run.actions.length >= FLOW_SETTINGS.MIN_ACTIONS ? runSignature(map, run) : null;
      if (!signature) continue;
      const entry = bySignature.get(signature) || { run, users: new Set<string>() };
      entry.users.add(trace.tcKey);
      bySignature.set(signature, entry);
    }
  }
  const taken = new Set<string>();
  return [...bySignature.entries()]
    .filter(([, entry]) => entry.users.size >= FLOW_SETTINGS.MIN_USERS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([signature, { run, users }]) => ({
      id: flowId(signature), name: flowName(run, taken), state: run.state, actions: flowActions(run), usedBy: [...users].sort(),
    }));
}

function argFor(action: TraceAction, tc: AutomationTestCase): FlowArg | null {
  const { value } = action;
  if (value?.literal !== undefined) {
    return { kind: 'literal', value: String(value.literal), expression: JSON.stringify(String(value.literal)) };
  }
  const binding = tc.steps.find((step) => step.index === action.stepIndex)?.data.find((b) => b.token === value?.binding);
  if (binding?.fixtureKey) return { kind: 'data', key: binding.fixtureKey, expression: `${DATA_FIXTURE}.${binding.fixtureKey}` };
  if (binding?.envVar) return { kind: 'env', name: binding.envVar, expression: `${ENV_FUNCTION}('${binding.envVar}')` };
  return null;
}

function callArgs(run: TraceRun, flow: VerifiedFlow, tc: AutomationTestCase): Record<string, FlowArg> | null {
  const args: Record<string, FlowArg> = {};
  for (let idx = 0; idx < flow.actions.length; idx += 1) {
    const { param } = flow.actions[idx];
    if (!param) continue;
    const arg = argFor(run.actions[idx], tc);
    if (!arg) return null;
    args[param] = arg;
  }
  return args;
}

function assertsOnlyAfterLastStep(run: TraceRun, tc: AutomationTestCase): boolean {
  const steps = [...new Set(run.actions.map((action) => action.stepIndex))].sort((a, b) => a - b);
  const last = steps[steps.length - 1];
  return steps.every((index) => index === last || (tc.steps.find((step) => step.index === index)?.expected.length ?? 0) === 0);
}

/**
 * Flows a test case must call: its own trace performed the flow's exact run, and no step inside that run (other than
 * the last) has expected results that would have to be asserted between the flow's actions.
 * @param {AutomationTestCase} tc
 * @param {TestCaseTrace | undefined} trace
 * @param {PageMap} map
 * @param {FlowMemberRef[]} members - Flow members of the rendered page contract
 * @returns {FlowUsage[]}
 */
export function applicableFlows(tc: AutomationTestCase, trace: TestCaseTrace | undefined, map: PageMap, members: FlowMemberRef[]): FlowUsage[] {
  const usages = new Map<string, FlowUsage>();
  for (const run of trace?.runs || []) {
    if (isPreconditionRun(run)) continue;
    const signature = runSignature(map, run);
    const flow = signature ? (map.flows || []).find((candidate) => candidate.id === flowId(signature)) : undefined;
    const member = flow ? members.find((candidate) => candidate.flowId === flow.id) : undefined;
    const args = flow && member && assertsOnlyAfterLastStep(run, tc) ? callArgs(run, flow, tc) : null;
    if (!member || !args) continue;
    const usage = usages.get(member.name) || {
      member: member.name, params: member.params, actions: member.actions, calls: [], stepIndexes: [],
    };
    usage.calls.push(args);
    usage.stepIndexes = [...new Set([...usage.stepIndexes, ...run.actions.map((action) => action.stepIndex)])].sort((a, b) => a - b);
    usages.set(member.name, usage);
  }
  return [...usages.values()];
}

/**
 * The actions discovery performed to establish the test case's precondition, resolved to page-object members and
 * value expressions, in order. A generated body performs exactly these before step 1.
 * @param {AutomationTestCase} tc
 * @param {TestCaseTrace | undefined} trace
 * @param {PageMap} map
 * @param {ReadonlyMap<string, string>} memberBySignature - Locator signature → page-object member, from the renderer
 * @param {ReadonlyMap<string, string>} [navigationByState] - State name → the method that requests its address directly
 * @returns {PreconditionAction[] | null} null when an action can no longer be rendered faithfully (its element is
 *   no longer verified, or its value is not bound), so the test case must not be generated
 */
export function preconditionActionsFor(
  tc: AutomationTestCase,
  trace: TestCaseTrace | undefined,
  map: PageMap,
  memberBySignature: ReadonlyMap<string, string>,
  navigationByState: ReadonlyMap<string, string> = new Map(),
): PreconditionAction[] | null {
  const actions: PreconditionAction[] = [];
  for (const run of trace?.runs || []) {
    for (const action of run.actions) {
      if (action.stepIndex !== PRECONDITION_STEP_INDEX) continue;
      if (action.op === GOTO_OPERATION) {
        const method = action.target ? navigationByState.get(action.target) : undefined;
        if (!method) return null;
        actions.push({ member: method, op: GOTO_OPERATION });
        continue;
      }
      const element = elementIn(map, action.state, action.element);
      const member = element ? memberBySignature.get(locatorSignature(element)) : undefined;
      if (action.element && !member) return null;
      const value = action.value ? argFor(action, tc) : null;
      if (action.value && !value) return null;
      actions.push({ ...(member ? { member } : {}), op: action.op, ...(value ? { value } : {}) });
    }
  }
  return actions;
}

/** A state discovery verified after a step: its name, URL path and, when a dialog or menu was open, that overlay. */
export interface VerifiedState {
  state: string;
  urlPath: string;
  overlay?: string;
}

/**
 * The states discovery verified after each step of a test case.
 * @param {TestCaseTrace | undefined} trace
 * @param {PageMap} map
 * @returns {Record<number, VerifiedState>}
 */
export function verifiedStatesFor(trace: TestCaseTrace | undefined, map: PageMap): Record<number, VerifiedState> {
  const result: Record<number, VerifiedState> = {};
  for (const [step, stateName] of Object.entries(trace?.stateAfterStep || {})) {
    const state = map.states.find((candidate) => candidate.name === stateName);
    if (!state) continue;
    const overlay = overlayLabel(state.overlay);
    result[Number(step)] = { state: state.name, urlPath: state.urlPath, ...(overlay ? { overlay } : {}) };
  }
  return result;
}
