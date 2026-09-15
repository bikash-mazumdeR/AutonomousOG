'use strict';

/**
 * @fileoverview Validation and value resolution for LLM navigation plans used by discovery.
 * A plan may reference only elements verified in the current state and values bound in the test case.
 */

import { AutomationTestCase } from '../contracts/automationTestCase';
import { MissingItem } from '../../../core/readiness/readinessTypes';
import { PageState } from './pageMap';

/** Operations on the page itself; they take no element. */
export const PAGE_OPERATIONS: readonly string[] = Object.freeze(['reload', 'goBack', 'goForward']);
export const PLAN_OPERATIONS: readonly string[] = Object.freeze(['fill', 'click', 'check', 'uncheck', 'selectOption', 'press', ...PAGE_OPERATIONS]);
const STOP_REASONS = ['COMPLETE', 'NEEDS_NEW_STATE', 'NOT_ACHIEVABLE'];

/** One planned discovery action. */
export interface PlannedAction {
  stepIndex: number;
  element: string;
  op: string;
  value?: { binding?: string; literal?: string };
}

/** Planner output. */
export interface NavigationPlan {
  actions: PlannedAction[];
  stopReason: 'COMPLETE' | 'NEEDS_NEW_STATE' | 'NOT_ACHIEVABLE';
  nextStep?: number;
  detail?: string;
}

function testCaseText(tc: AutomationTestCase): string {
  return [tc.title, tc.precondition, ...tc.steps.flatMap((step) => [step.action, step.testData, ...step.expected])].join('\n');
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
      elements: currentState.elements.map((e) => ({
        name: e.name, role: e.role, accessibleName: e.accessibleName, inputType: e.inputType,
      })),
    },
    knownStates: knownStates.map((state) => ({ name: state.name, urlPath: state.urlPath })),
  }, null, 2);
}

function validateAction(action: any, index: number, currentState: PageState, tc: AutomationTestCase, text: string): string[] {
  const errors: string[] = [];
  const label = `actions[${index}]`;
  const step = tc.steps.find((s) => s.index === Number(action?.stepIndex));
  if (!step) errors.push(`${label}.stepIndex must reference a test case step`);
  const isPageOp = PAGE_OPERATIONS.includes(action?.op);
  if (isPageOp && action?.element !== undefined) errors.push(`${label}.element must be omitted for page operation "${action.op}"`);
  if (!isPageOp && !currentState.elements.some((e) => e.name === action?.element)) errors.push(`${label}.element "${action?.element}" is not in currentState.elements`);
  if (!PLAN_OPERATIONS.includes(action?.op)) errors.push(`${label}.op must be one of ${PLAN_OPERATIONS.join(', ')}`);
  const value = action?.value;
  if (value?.binding !== undefined && !(step?.data || []).some((b) => b.token === value.binding)) {
    errors.push(`${label}.value.binding "${value.binding}" is not bound in step ${action?.stepIndex}`);
  }
  if (value?.literal !== undefined && !text.includes(String(value.literal))) {
    errors.push(`${label}.value.literal "${value.literal}" does not appear in the test case`);
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
 * @returns {{ plan?: NavigationPlan, errors: string[] }}
 */
export function validateNavigationPlan(raw: any, currentState: PageState, tc: AutomationTestCase): { plan?: NavigationPlan; errors: string[] } {
  const errors: string[] = [];
  if (!raw || !Array.isArray(raw.actions)) errors.push('actions must be an array');
  if (!STOP_REASONS.includes(raw?.stopReason)) errors.push(`stopReason must be one of ${STOP_REASONS.join(', ')}`);
  if (raw?.stopReason === 'NEEDS_NEW_STATE' && !Number.isInteger(raw?.nextStep)) errors.push('nextStep is required when stopReason is NEEDS_NEW_STATE');
  const text = testCaseText(tc);
  (raw?.actions || []).forEach((action: any, idx: number) => errors.push(...validateAction(action, idx, currentState, tc, text)));
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
