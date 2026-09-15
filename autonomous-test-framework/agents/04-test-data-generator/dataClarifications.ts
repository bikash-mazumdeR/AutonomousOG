'use strict';

/**
 * @fileoverview Agent 04 clarifications: one question per unresolved placeholder (shared by every test case that uses
 * it), one environment question per missing credential variable, answers recorded from UI edits, and retiring
 * questions — including those Agent 05 raised — once the value resolves.
 */

import { Clarification, ClarificationStore, CLARIFICATION_STATUS } from '../../core/clarifications/ClarificationStore';
import { toEnvVarName } from '../../core/aut/envVarNames';
import { OWNING_STAGE } from '../../core/readiness/ownership';
import { READINESS_RULE as RULE } from '../../core/readiness/readinessConstants';
import { STAGE_ID } from './constants';
import { VALUE_CLASS, ValueClass } from './placeholderIntent';
import { placeholderNameOf } from './valueSources';

/** Stage whose unresolved-binding questions Agent 04 retires once it resolves the value. */
const SCRIPT_GENERATION_STAGE = '05-playwright-script-generator';

/** A placeholder Agent 04 could not resolve for a test case. */
export interface UnresolvedPlaceholder {
  placeholder: string;
  name: string;
  tcKey: string;
  stepIndex: number;
  reason: string;
  valueClass: ValueClass;
  suggestion: string;
}

/** A runtime binding whose environment variable is neither declared nor set. */
export interface EnvironmentIssue {
  name: string;
  envVar: string;
  tcKey: string;
}

/** An open question listed in the manifest and at the approval gate. */
export interface PendingDataQuestion {
  id: string;
  question: string;
  placeholder: string;
  envVar?: string;
  tcKeys: string[];
}

/** What was asked and retired. */
export interface DataClarificationSummary {
  pending: PendingDataQuestion[];
  environment: PendingDataQuestion[];
  resolved: number;
}

/** A value set by a human, for answering matching questions. */
export interface AnsweringChange {
  name: string;
  /** Absent for a change that applies to every test case. */
  tcKey?: string;
  value?: unknown;
  envVar?: string;
}

const QUESTION = Object.freeze({
  runtime: (name: string) => `Which environment variable holds {{${name}}}? Answer with the variable name (for example ${toEnvVarName(name)}); the value itself is never stored.`,
  value: (name: string, reason: string, tcKeys: string[]) => `What value should {{${name}}} have? ${reason} Used by ${tcKeys.join(', ')}.`,
  environment: (name: string, envVar: string) => `Set the environment variable ${envVar} (read for {{${name}}}) and declare it in the AUT profile under auth.credentialEnvVars.`,
});

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  items.forEach((item) => groups.set(keyOf(item), [...(groups.get(keyOf(item)) || []), item]));
  return groups;
}

function sortedKeys(items: Array<{ tcKey: string }>): string[] {
  return [...new Set(items.map((item) => item.tcKey))].sort();
}

function raiseUnresolved(store: ClarificationStore, name: string, items: UnresolvedPlaceholder[]): Clarification {
  const tcKeys = sortedKeys(items);
  const { valueClass, reason } = items[0];
  return store.raise({
    sourceStage: STAGE_ID,
    owningStage: STAGE_ID,
    kind: 'DATA',
    ruleId: RULE.UNRESOLVED_BINDING,
    subject: name,
    question: valueClass === VALUE_CLASS.RUNTIME ? QUESTION.runtime(name) : QUESTION.value(name, reason, tcKeys),
    context: { placeholder: name, tcKeys, valueClass, detail: reason },
  });
}

function raiseEnvironment(store: ClarificationStore, envVar: string, issues: EnvironmentIssue[]): Clarification {
  const tcKeys = sortedKeys(issues);
  const { name } = issues[0];
  return store.raise({
    sourceStage: STAGE_ID,
    owningStage: OWNING_STAGE.ENVIRONMENT,
    kind: 'AUTH',
    ruleId: RULE.CREDENTIAL_ENV_VAR,
    subject: envVar,
    question: QUESTION.environment(name, envVar),
    context: { placeholder: name, envVar, tcKeys, detail: `Environment variable ${envVar} for {{${name}}} is not declared in the AUT profile and not set.` },
  });
}

function toPending(clarification: Clarification): PendingDataQuestion {
  const { placeholder, envVar, tcKeys } = clarification.context;
  return { id: clarification.id, question: clarification.question, placeholder, envVar, tcKeys: tcKeys || [] };
}

function retireScriptGenerationQuestions(store: ClarificationStore, unresolved: UnresolvedPlaceholder[], testCaseKeys: string[]): number {
  const stillUnresolved = new Set(unresolved.map((item) => `${item.tcKey}|${item.name}`));
  const inScope = new Set(testCaseKeys);
  const open = store.listOpen({ owningStage: STAGE_ID, sourceStage: SCRIPT_GENERATION_STAGE })
    .filter((c) => c.ruleId === RULE.UNRESOLVED_BINDING && c.tcKey && inScope.has(c.tcKey));
  let resolved = 0;
  for (const [tcKey, questions] of groupBy(open, (c) => c.tcKey as string)) {
    const firingKeys = questions.filter((c) => stillUnresolved.has(`${tcKey}|${placeholderNameOf(c)}`)).map((c) => c.dedupeKey);
    resolved += store.resolveMissing({ sourceStage: SCRIPT_GENERATION_STAGE, tcKey, firingKeys });
  }
  return resolved;
}

/**
 * Raises (or refreshes) the questions for this run's unresolved placeholders and missing environment variables, and
 * retires questions whose value now resolves.
 * @param {ClarificationStore} store
 * @param {UnresolvedPlaceholder[]} unresolved
 * @param {EnvironmentIssue[]} environmentIssues
 * @param {string[]} testCaseKeys - Test cases resolved in this run
 * @returns {DataClarificationSummary}
 */
export function syncDataClarifications(
  store: ClarificationStore, unresolved: UnresolvedPlaceholder[], environmentIssues: EnvironmentIssue[], testCaseKeys: string[],
): DataClarificationSummary {
  const dataQuestions = [...groupBy(unresolved, (item) => item.name)].map(([name, items]) => raiseUnresolved(store, name, items));
  const envQuestions = [...groupBy(environmentIssues, (issue) => issue.envVar)].map(([envVar, issues]) => raiseEnvironment(store, envVar, issues));
  const firingKeys = [...dataQuestions, ...envQuestions].map((c) => c.dedupeKey);
  const resolved = store.resolveMissing({ sourceStage: STAGE_ID, firingKeys })
    + retireScriptGenerationQuestions(store, unresolved, testCaseKeys);
  const open = (questions: Clarification[]) => questions.filter((c) => c.status === CLARIFICATION_STATUS.OPEN).map(toPending);
  return { pending: open(dataQuestions), environment: open(envQuestions), resolved };
}

/**
 * Gate lines for open data and environment questions.
 * @param {{ pending?: PendingDataQuestion[], environment?: PendingDataQuestion[] }} summary
 * @returns {string[]}
 */
export function describeDataClarifications(summary: { pending?: PendingDataQuestion[]; environment?: PendingDataQuestion[] }): string[] {
  const data = (summary.pending || []).map((q) => `[DATA] ${q.question} (id ${q.id})`);
  const environment = (summary.environment || []).map((q) => `[ENVIRONMENT] ${q.question} (id ${q.id})`);
  return [...data, ...environment];
}

/**
 * Answers open Agent 04 questions a human edit settles: a test case edit answers that test case's questions; a
 * change for every test case also answers the project-wide question.
 * @param {ClarificationStore} store
 * @param {AnsweringChange[]} changes
 * @param {string} answeredBy
 * @returns {string[]} Ids of the questions answered
 */
export function answerDataClarifications(store: ClarificationStore, changes: AnsweringChange[], answeredBy: string): string[] {
  const open = store.listOpen({ owningStage: STAGE_ID }).filter((c) => c.ruleId === RULE.UNRESOLVED_BINDING);
  const answered: string[] = [];
  for (const change of changes) {
    for (const clarification of open) {
      const matches = placeholderNameOf(clarification) === change.name && (change.tcKey === undefined || clarification.tcKey === change.tcKey);
      if (!matches || answered.includes(clarification.id)) continue;
      store.answer(clarification.id, change.envVar ?? String(change.value), answeredBy);
      answered.push(clarification.id);
    }
  }
  return answered;
}
