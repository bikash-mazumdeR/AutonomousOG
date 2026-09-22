'use strict';

/**
 * @fileoverview Validation and value resolution for LLM navigation plans used by discovery.
 * A plan may reference only elements verified in the current state and values bound in the test case.
 */

import { AutomationTestCase } from '../contracts/automationTestCase';
import { MissingItem } from '../../../core/readiness/readinessTypes';
import { GOTO_OPERATION } from '../constants';
import { PageState, overlayLabel } from './pageMap';

/** Operations on the page itself; they take no element. */
export const PAGE_OPERATIONS: readonly string[] = Object.freeze(['reload', 'goBack', 'goForward']);
/** Operations on an element. `hover` and `dblclick` reveal what a pointer does — a menu that opens on hover, a row that opens on double click. */
export const ELEMENT_OPERATIONS: readonly string[] = Object.freeze(['fill', 'click', 'dblclick', 'hover', 'check', 'uncheck', 'selectOption', 'press']);
export const PLAN_OPERATIONS: readonly string[] = Object.freeze([...ELEMENT_OPERATIONS, ...PAGE_OPERATIONS, GOTO_OPERATION]);
const STOP_REASONS = ['COMPLETE', 'NEEDS_NEW_STATE', 'NOT_ACHIEVABLE'];

/**
 * A step whose action is a navigation: the user navigates / goes to an address, or opens, visits, enters or types a
 * URL or address. Such a step is performed by a `goto` (or a page operation) — being at the address already does not
 * perform it, and the state after the step is only known once the request has been made.
 */
const NAVIGATION_STEP = /\bnavigat(?:e|es|ed|ing)\b|\b(?:go|goes|going|went)\s+to\b|\b(?:open|opens|visit|visits|enter|enters|type|types)\b[^.]*\b(?:url|address|link)\b/i;

/** Operations that perform a navigation step. */
const NAVIGATION_OPERATIONS: readonly string[] = Object.freeze([GOTO_OPERATION, ...PAGE_OPERATIONS]);

/** One planned discovery action. */
export interface PlannedAction {
  stepIndex: number;
  element: string;
  op: string;
  value?: { binding?: string; literal?: string };
  /** `goto` only: the known state whose address is requested. */
  state?: string;
}

/** Planner output. */
export interface NavigationPlan {
  actions: PlannedAction[];
  stopReason: 'COMPLETE' | 'NEEDS_NEW_STATE' | 'NOT_ACHIEVABLE';
  nextStep?: number;
  detail?: string;
}

/** Text of one step; a literal value must come from the step it is attributed to, never from another step. */
function stepText(step: AutomationTestCase['steps'][number] | undefined): string {
  return step ? [step.action, step.testData, ...step.expected].join('\n') : '';
}

/**
 * Builds the planner user message.
 * @param {AutomationTestCase} tc
 * @param {PageState[]} knownStates
 * @param {PageState} currentState
 * @param {number} fromStep
 * @param {PlannedAction[]} [executedActions] - Actions already performed in this browser session, in order
 * @returns {string}
 */
export function buildPlannerRequest(
  tc: AutomationTestCase,
  knownStates: PageState[],
  currentState: PageState,
  fromStep: number,
  executedActions: PlannedAction[] = [],
): string {
  return JSON.stringify({
    testCase: {
      tcKey: tc.tcKey,
      title: tc.title,
      precondition: tc.precondition,
      steps: tc.steps.map((step) => ({
        index: step.index, keyword: step.keyword, action: step.action, expected: step.expected, testData: step.testData, data: step.data.map((b) => b.token),
      })),
    },
    fromStep,
    executedActions: executedActions.map((a) => ({ stepIndex: a.stepIndex, element: a.element, op: a.op })),
    currentState: {
      name: currentState.name,
      urlPath: currentState.urlPath,
      overlay: overlayLabel(currentState.overlay),
      elements: currentState.elements.map((e) => ({
        name: e.name, role: e.role, accessibleName: e.accessibleName, inputType: e.inputType,
      })),
    },
    knownStates: knownStates.map((state) => ({ name: state.name, urlPath: state.urlPath, overlay: overlayLabel(state.overlay) })),
  }, null, 2);
}

function validateGoto(action: any, label: string, knownStates: PageState[]): string[] {
  const errors: string[] = [];
  if (action?.element !== undefined) errors.push(`${label}.element must be omitted for "${GOTO_OPERATION}"; give the state whose address is requested in "state"`);
  const target = knownStates.find((state) => state.name === action?.state);
  const addressable = knownStates.filter((state) => !state.overlay).map((state) => state.name);
  if (!target) errors.push(`${label}.state "${action?.state}" is not a known state (one of ${addressable.join(', ') || 'none'})`);
  else if (target.overlay) errors.push(`${label}.state "${action.state}" is a menu or dialog state: it shares its page's address and cannot be requested`);
  return errors;
}

function validateAction(action: any, index: number, currentState: PageState, tc: AutomationTestCase, knownStates: PageState[]): string[] {
  const errors: string[] = [];
  const label = `actions[${index}]`;
  const step = tc.steps.find((s) => s.index === Number(action?.stepIndex));
  if (!step) errors.push(`${label}.stepIndex must reference a test case step`);
  const isPageOp = PAGE_OPERATIONS.includes(action?.op);
  const isGoto = action?.op === GOTO_OPERATION;
  if (isPageOp && action?.element !== undefined) errors.push(`${label}.element must be omitted for page operation "${action.op}"`);
  if (isGoto) errors.push(...validateGoto(action, label, knownStates));
  if (!isPageOp && !isGoto && !currentState.elements.some((e) => e.name === action?.element)) errors.push(`${label}.element "${action?.element}" is not in currentState.elements`);
  if (!PLAN_OPERATIONS.includes(action?.op)) errors.push(`${label}.op must be one of ${PLAN_OPERATIONS.join(', ')}`);
  const value = action?.value;
  if (value?.binding !== undefined && !(step?.data || []).some((b) => b.token === value.binding)) {
    errors.push(`${label}.value.binding "${value.binding}" is not bound in step ${action?.stepIndex}`);
  }
  if (value?.literal !== undefined && String(value.literal).trim() === '') {
    errors.push(`${label}.value.literal must not be empty — "fill" replaces the existing content, so "clear X and enter Y" is one fill with Y`);
  } else if (value?.literal !== undefined && step && !stepText(step).includes(String(value.literal))) {
    errors.push(`${label}.value.literal "${value.literal}" does not appear in step ${step.index}; attribute each action to the step that describes it`);
  }
  if (['fill', 'selectOption', 'press'].includes(action?.op) && value?.binding === undefined && value?.literal === undefined) {
    errors.push(`${label} (${action?.op}) requires a value`);
  }
  return errors;
}

/**
 * Validates a raw plan.
 * @param {any} raw
 * @param {PageState} currentState
 * @param {AutomationTestCase} tc
 * @param {PageState[]} [knownStates] - States a `goto` action may request
 * @param {number} [fromStep] - First step the plan covers; a covered navigation step must be performed by a navigation action
 * @returns {{ plan?: NavigationPlan, errors: string[] }}
 */
/**
 * The steps a plan claims to have covered: from `fromStep` up to the last step (COMPLETE) or the step before
 * `nextStep`. A covered navigation step must have been performed by a navigation action.
 */
function navigationStepErrors(raw: any, tc: AutomationTestCase, fromStep: number | undefined): string[] {
  if (fromStep === undefined || !Array.isArray(raw?.actions)) return [];
  const last = Math.max(...tc.steps.map((step) => step.index));
  const lastCovered = raw.stopReason === 'COMPLETE' ? last : Number(raw.nextStep) - 1;
  return tc.steps
    .filter((step) => step.index >= fromStep && step.index <= lastCovered && NAVIGATION_STEP.test(step.action))
    .filter((step) => !raw.actions.some((action: any) => Number(action?.stepIndex) === step.index && NAVIGATION_OPERATIONS.includes(action?.op)))
    .map((step) => `step ${step.index} says the user navigates to an address; perform it with "${GOTO_OPERATION}" to the known state at that address `
      + '(or a page operation) — being there already does not perform the step. If no known state has that address, stop with NOT_ACHIEVABLE.');
}

export function validateNavigationPlan(
  raw: any,
  currentState: PageState,
  tc: AutomationTestCase,
  knownStates: PageState[] = [],
  fromStep?: number,
): { plan?: NavigationPlan; errors: string[] } {
  const errors: string[] = [];
  if (!raw || !Array.isArray(raw.actions)) errors.push('actions must be an array');
  if (!STOP_REASONS.includes(raw?.stopReason)) errors.push(`stopReason must be one of ${STOP_REASONS.join(', ')}`);
  if (raw?.stopReason === 'NEEDS_NEW_STATE' && !Number.isInteger(raw?.nextStep)) errors.push('nextStep is required when stopReason is NEEDS_NEW_STATE');
  (raw?.actions || []).forEach((action: any, idx: number) => errors.push(...validateAction(action, idx, currentState, tc, knownStates)));
  if (STOP_REASONS.includes(raw?.stopReason)) errors.push(...navigationStepErrors(raw, tc, fromStep));
  if (errors.length > 0) return { errors };
  return {
    errors,
    plan: {
      actions: raw.actions.map((a: any) => ({ ...a, stepIndex: Number(a.stepIndex) })), stopReason: raw.stopReason, nextStep: raw.nextStep, detail: raw.detail,
    },
  };
}

/**
 * Resolves the concrete value for an action.
 * @param {PlannedAction} action
 * @param {AutomationTestCase} tc
 * @param {Record<string, unknown>} fixtureValues
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ value?: string, missing?: MissingItem }}
 */
export function resolveActionValue(
  action: PlannedAction,
  tc: AutomationTestCase,
  fixtureValues: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): { value?: string; missing?: MissingItem } {
  if (action.value?.literal !== undefined) return { value: String(action.value.literal) };
  if (action.value?.binding === undefined) return {};
  const binding = tc.steps.find((s) => s.index === action.stepIndex)?.data.find((b) => b.token === action.value?.binding);
  if (binding?.fixtureKey && fixtureValues[binding.fixtureKey] !== undefined) return { value: String(fixtureValues[binding.fixtureKey]) };
  if (binding?.envVar && env[binding.envVar]) return { value: String(env[binding.envVar]) };
  const detail = binding?.envVar
    ? `Environment variable ${binding.envVar} (for ${binding.token}) is not set, so discovery cannot execute step ${action.stepIndex}.`
    : `No value is bound for ${action.value.binding} in step ${action.stepIndex}.`;
  return { missing: { kind: 'DATA', detail } };
}
