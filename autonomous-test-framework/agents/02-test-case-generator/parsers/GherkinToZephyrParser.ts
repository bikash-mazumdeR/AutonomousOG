'use strict';

/**
 * @fileoverview Strict Gherkin parser for Agent 02 LLM output.
 * Accepts only the constrained grammar defined in skills/test-case-generation.md so every
 * scenario maps losslessly onto Zephyr-style steps:
 *
 *   (Given|When) <action>
 *   [And with test data "<value>"]
 *   Then <expected result>
 *   [And <additional expected result>]*
 *
 * Anything outside the grammar is reported as an error for the self-correction loop
 * instead of being guessed.
 *
 * @module GherkinToZephyrParser
 * @version 2.0.0
 */

import { TEST_DATA_LINE, UNCOVERED_DECLARATION } from '../constants';

export type ActionKeyword = 'Given' | 'When';

/** A parsed step block. */
export interface ParsedStep {
  keyword: ActionKeyword;
  description: string;
  testData: string;
  /** Assertions joined with "\n". */
  expectedResult: string;
}

/** A parsed scenario with its grammar errors. */
export interface ParsedScenario {
  title: string;
  /** Lower-cased tags without the leading "@". */
  tags: string[];
  steps: ParsedStep[];
  line: number;
  errors: string[];
}

/** A criterion the model declared uncoverable because only an excluded type could verify it. */
export interface UncoveredDeclaration {
  /** Requirement id, e.g. "AC-3". */
  ref: string;
  /** Lower-cased type tag without "@", e.g. "negative". */
  typeTag: string;
}

/** Parser output. */
export interface GherkinParseResult {
  scenarios: ParsedScenario[];
  /** Errors not attributable to a scenario. */
  errors: string[];
  /** "# UNCOVERED AC-N: @type" declarations. */
  declaredUncovered: UncoveredDeclaration[];
}

interface StepDraft {
  keyword: ActionKeyword;
  description: string;
  testData: string;
  expectations: string[];
  line: number;
}

interface ParserState {
  result: GherkinParseResult;
  pendingTags: string[];
  scenario: ParsedScenario | null;
  draft: StepDraft | null;
}

const STEP_LINE = /^(Given|When|Then|And|But)\b\s*(.*)$/i;
const SCENARIO_LINE = /^Scenario:\s*(.*)$/i;
const OUTLINE_LINE = /^Scenario (?:Outline|Template):\s*(.*)$/i;
const UNSUPPORTED_BLOCK = /^(Examples|Background|Rule):/i;
const TC_KEY_PREFIX = /^\[TC-\d+\]\s*/i;
const SNIPPET_LENGTH = 60;

function snippet(text: string): string {
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH - 3)}...` : text;
}

function addError(state: ParserState, message: string): void {
  (state.scenario ? state.scenario.errors : state.result.errors).push(message);
}

function flushDraft(state: ParserState): void {
  const { draft, scenario } = state;
  if (!draft || !scenario) return;
  if (draft.expectations.length === 0) {
    addError(state, `Line ${draft.line}: "${draft.keyword} ${snippet(draft.description)}" has no Then expected result`);
  }
  scenario.steps.push({
    keyword: draft.keyword,
    description: draft.description,
    testData: draft.testData,
    expectedResult: draft.expectations.join('\n'),
  });
  state.draft = null;
}

function closeScenario(state: ParserState): void {
  flushDraft(state);
  const { scenario } = state;
  if (!scenario) return;
  if (!scenario.steps.some((step) => step.keyword === 'Given')) scenario.errors.push('Scenario has no Given setup step');
  if (!scenario.steps.some((step) => step.keyword === 'When')) scenario.errors.push('Scenario has no When action');
  state.result.scenarios.push(scenario);
  state.scenario = null;
}

function openScenario(state: ParserState, rawTitle: string, lineNo: number): void {
  closeScenario(state);
  state.scenario = {
    title: rawTitle.replace(TC_KEY_PREFIX, '').trim(),
    tags: state.pendingTags,
    steps: [],
    line: lineNo,
    errors: [],
  };
  state.pendingTags = [];
  if (!state.scenario.title) addError(state, `Line ${lineNo}: Scenario has no title`);
}

/**
 * The test data value as meant, not as quoted: a model writes a JSON request body inside the quotes as
 * `"{ \"id\": 1 }"`, and keeping the backslashes makes the body unparseable, so the API test case lost it. Only an
 * escaped quote is unescaped: a JSON body's own escaped backslash must stay as written.
 * @param {string} raw - Text between the quotes of "with test data"
 * @returns {string}
 */
export function unescapeTestData(raw: string): string {
  return raw.replace(/\\"/g, '"');
}

function attachTestData(state: ParserState, data: string, lineNo: number): void {
  const { draft } = state;
  if (!draft || draft.expectations.length > 0) {
    addError(state, `Line ${lineNo}: "And with test data" must directly follow its Given/When action (before Then)`);
    return;
  }
  if (draft.testData) {
    addError(state, `Line ${lineNo}: duplicate test data line for "${snippet(draft.description)}"`);
    return;
  }
  draft.testData = data.trim();
}

function processStep(state: ParserState, keyword: string, text: string, lineNo: number): void {
  if (!text) {
    addError(state, `Line ${lineNo}: "${keyword}" step has no text`);
    return;
  }
  if (keyword === 'Given' || keyword === 'When') {
    flushDraft(state);
    state.draft = {
      keyword, description: text, testData: '', expectations: [], line: lineNo,
    };
    return;
  }
  if (keyword === 'Then') {
    if (state.draft) state.draft.expectations.push(text);
    else addError(state, `Line ${lineNo}: "Then ${snippet(text)}" has no preceding Given/When action`);
    return;
  }
  const dataMatch = text.match(TEST_DATA_LINE);
  if (dataMatch) {
    attachTestData(state, unescapeTestData(dataMatch[1]), lineNo);
  } else if (state.draft && state.draft.expectations.length > 0) {
    state.draft.expectations.push(text);
  } else {
    addError(state, `Line ${lineNo}: "${keyword} ${snippet(text)}" continues an action — every Given/When action needs its own Then; start a new When block instead`);
  }
}

function processLine(state: ParserState, line: string, lineNo: number): void {
  const declaration = line.match(UNCOVERED_DECLARATION);
  if (declaration) {
    state.result.declaredUncovered.push({ ref: declaration[1].toUpperCase(), typeTag: declaration[2].toLowerCase() });
    return;
  }
  if (!line || line.startsWith('#') || line.startsWith('```')) return;
  if (line.startsWith('@')) {
    state.pendingTags.push(...line.split(/\s+/).map((tag) => tag.replace(/^@/, '').replace(/,$/, '').toLowerCase()).filter(Boolean));
    return;
  }
  const outline = line.match(OUTLINE_LINE);
  const scenario = outline || line.match(SCENARIO_LINE);
  if (scenario) {
    openScenario(state, scenario[1], lineNo);
    if (outline) addError(state, `Line ${lineNo}: Scenario Outline is not allowed — write one Scenario per test case`);
    return;
  }
  const unsupported = line.match(UNSUPPORTED_BLOCK);
  if (unsupported) {
    addError(state, `Line ${lineNo}: "${unsupported[1]}:" blocks are not allowed`);
    return;
  }
  const step = line.match(STEP_LINE);
  if (step && state.scenario) {
    const keyword = step[1].charAt(0).toUpperCase() + step[1].slice(1).toLowerCase();
    processStep(state, keyword, step[2].trim(), lineNo);
  } else if (state.scenario) {
    addError(state, `Line ${lineNo}: unexpected text "${snippet(line)}" — only Given/When/Then/And steps are allowed inside a Scenario`);
  }
  // Text outside scenarios (Feature header, narrative, prose) is ignored.
}

/**
 * Parses LLM Gherkin output into scenarios using the strict Agent 02 grammar.
 * @param {string} content - Raw LLM output (code fences tolerated)
 * @returns {GherkinParseResult}
 */
export function parseGherkinScenarios(content: string): GherkinParseResult {
  const state: ParserState = {
    result: { scenarios: [], errors: [], declaredUncovered: [] }, pendingTags: [], scenario: null, draft: null,
  };
  String(content || '').split(/\r?\n/).forEach((raw, idx) => processLine(state, raw.trim(), idx + 1));
  closeScenario(state);
  if (state.pendingTags.length > 0) {
    state.result.errors.push(`Tags "${state.pendingTags.map((tag) => `@${tag}`).join(' ')}" are not followed by a Scenario`);
  }
  return state.result;
}
