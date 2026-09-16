'use strict';

/**
 * @fileoverview Generate → parse → validate → self-correct loop for a single user story.
 * The chat function is injected so the loop is unit-testable without a live LLM.
 */

import { parseGherkinScenarios, UncoveredDeclaration } from '../parsers/GherkinToZephyrParser';
import { validateStoryScenarios, ScenarioContext, ValidatedScenario } from '../validators/scenarioValidator';
import { buildStoryPrompt, buildRetryPrompt, PromptMemoryContext } from '../prompts/storyPrompt';
import { evaluateApiGate, evaluatePerformanceGate } from '../analysis/requirementGates';
import { NormalizedFeature, NormalizedStory, OpenAmbiguity } from '../analysis/normalizeAnalysis';
import { StoryScenarios } from '../builders/testCaseBuilder';

/** Chat message in the LLMClient format. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** LLM answer; `truncated` marks output cut off at the output token limit. */
export interface ChatReply {
  text: string;
  truncated?: boolean;
}

/** Sends messages to the LLM and resolves with the response text (or a reply carrying the truncation flag). */
export type ChatFn = (messages: ChatMessage[]) => Promise<string | ChatReply>;

/** Inputs for generating one story. */
export interface StoryGenerationRequest {
  feature: NormalizedFeature;
  story: NormalizedStory;
  systemPrompt: string;
  excludedTypeTags: ReadonlySet<string>;
  openAmbiguities: OpenAmbiguity[];
  stateTransitions: unknown[];
  memoryContext: PromptMemoryContext;
  /** Self-correction retries after the first attempt. */
  maxRetries: number;
}

/** Result for one story. */
export interface StoryGenerationOutcome extends StoryScenarios {
  attempts: number;
  warnings: string[];
}

const SCENARIO_HEADER = /^\s*Scenario(?: Outline| Template)?:\s*(.*)$/i;
const TAG_LINE = /^\s*@/;
const TC_KEY_PREFIX = /^\[TC-\d+\]\s*/i;

const hasExcludedTypeTag = (block: string[], excludedTypeTags: ReadonlySet<string>): boolean => block
  .filter((line) => TAG_LINE.test(line))
  .some((line) => line.trim().split(/\s+/).some((tag) => excludedTypeTags.has(tag.replace(/^@/, '').toLowerCase())));

/**
 * Reduces a model answer to the scenario blocks that still need fixing: accepted scenarios, discarded
 * excluded-type scenarios and "# UNCOVERED" lines (already remembered) are removed. Sent back as the
 * assistant turn on retry so they are not re-read as input tokens on every attempt.
 * @param {string} text - Raw model output
 * @param {string[]} acceptedTitles
 * @param {ReadonlySet<string>} [excludedTypeTags]
 * @returns {string}
 */
export function extractUnacceptedBlocks(text: string, acceptedTitles: string[], excludedTypeTags: ReadonlySet<string> = new Set()): string {
  const accepted = new Set(acceptedTitles.map((title) => title.toLowerCase()));
  const blocks: string[][] = [];
  let pendingTags: string[] = [];
  let current: string[] | null = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const header = line.match(SCENARIO_HEADER);
    if (TAG_LINE.test(line)) {
      pendingTags.push(line);
    } else if (header) {
      current = [...pendingTags, line];
      pendingTags = [];
      blocks.push(current);
    } else if (current && line.trim() && !line.trim().startsWith('#') && !line.trim().startsWith('```')) {
      current.push(line);
    }
  }
  const titleOf = (block: string[]) => (block.find((line) => SCENARIO_HEADER.test(line)) || '')
    .replace(SCENARIO_HEADER, '$1').replace(TC_KEY_PREFIX, '').trim().toLowerCase();
  return blocks
    .filter((block) => !accepted.has(titleOf(block)) && !hasExcludedTypeTag(block, excludedTypeTags))
    .map((block) => block.join('\n')).join('\n\n')
    || '(all scenarios from this answer were accepted or discarded)';
}

/**
 * Removes the last, possibly unfinished scenario (and any dangling tag lines) from output cut off at the token limit.
 * @param {string} text
 * @returns {string}
 */
export function dropUnfinishedScenario(text: string): string {
  const lines = String(text || '').split(/\r?\n/);
  const lastHeader = lines.map((line) => SCENARIO_HEADER.test(line)).lastIndexOf(true);
  if (lastHeader === -1) return '';
  let start = lastHeader;
  while (start > 0 && TAG_LINE.test(lines[start - 1])) start -= 1;
  return lines.slice(0, start).join('\n');
}

/**
 * Generates validated scenarios for one story, retrying with validator feedback.
 * Scenarios accepted in any attempt are kept; retries only fix failing scenarios and fill coverage gaps,
 * so self-correction never lowers the count. Errors left after the last attempt become warnings.
 * @param {StoryGenerationRequest} request
 * @param {ChatFn} chat
 * @returns {Promise<StoryGenerationOutcome>}
 */
export async function generateStoryScenarios(request: StoryGenerationRequest, chat: ChatFn): Promise<StoryGenerationOutcome> {
  const { feature, story } = request;
  const ctx: ScenarioContext = {
    feature,
    story,
    apiGate: evaluateApiGate(story),
    performanceGate: evaluatePerformanceGate(story),
    excludedTypeTags: request.excludedTypeTags,
  };
  const userPrompt = buildStoryPrompt({
    ...ctx, openAmbiguities: request.openAmbiguities, stateTransitions: request.stateTransitions, memoryContext: request.memoryContext,
  });
  const messages: ChatMessage[] = [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: userPrompt }];

  let accepted: ValidatedScenario[] = [];
  let declared: UncoveredDeclaration[] = [];
  let errors: string[] = [];
  let warnings: string[] = [];
  let attempts = 0;
  for (let attempt = 0; attempt <= request.maxRetries; attempt += 1) {
    attempts += 1;
    // eslint-disable-next-line no-await-in-loop -- each retry depends on the previous validation result
    const reply = await chat(messages);
    const { text, truncated = false } = typeof reply === 'string' ? { text: reply } : reply;
    const result = validateStoryScenarios(parseGherkinScenarios(truncated ? dropUnfinishedScenario(text) : text), ctx, accepted, declared);
    ({ errors, warnings, declaredUncovered: declared } = result);
    accepted = result.scenarios;
    if (truncated) warnings.push(`[${feature.id}/${story.id}] Attempt ${attempts} was cut off at the output token limit; its last scenario was discarded`);
    if (errors.length === 0) break;
    const acceptedTitles = accepted.map((scenario) => scenario.title);
    const retryPrompt = buildRetryPrompt(errors, {
      acceptedTitles, excludedTypeTags: ctx.excludedTypeTags, excludedDrops: result.excludedDrops, truncated,
    });
    messages.push({ role: 'assistant', content: extractUnacceptedBlocks(text, acceptedTitles, ctx.excludedTypeTags) }, { role: 'user', content: retryPrompt });
  }

  const unresolved = errors.map((error) => `[${feature.id}/${story.id}] Unresolved after ${attempts} attempt(s): ${error}`);
  return {
    feature, story, scenarios: accepted, attempts, warnings: [...warnings, ...unresolved],
  };
}
