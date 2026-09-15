'use strict';

/**
 * @fileoverview Generate → parse → validate → self-correct loop for a single user story.
 * The chat function is injected so the loop is unit-testable without a live LLM.
 */

import { parseGherkinScenarios } from '../parsers/GherkinToZephyrParser';
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

/** Sends messages to the LLM and resolves with the response text. */
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

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
  let errors: string[] = [];
  let warnings: string[] = [];
  let attempts = 0;
  for (let attempt = 0; attempt <= request.maxRetries; attempt += 1) {
    attempts += 1;
    // eslint-disable-next-line no-await-in-loop -- each retry depends on the previous validation result
    const text = await chat(messages);
    const result = validateStoryScenarios(parseGherkinScenarios(text), ctx, accepted);
    accepted = result.scenarios;
    errors = result.errors;
    warnings = result.warnings;
    if (errors.length === 0) break;
    const retryPrompt = buildRetryPrompt(errors, accepted.map((scenario) => scenario.title));
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: retryPrompt });
  }

  const unresolved = errors.map((error) => `[${feature.id}/${story.id}] Unresolved after ${attempts} attempt(s): ${error}`);
  return {
    feature, story, scenarios: accepted, attempts, warnings: [...warnings, ...unresolved],
  };
}
