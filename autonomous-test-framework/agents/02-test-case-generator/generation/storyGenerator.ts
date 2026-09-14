'use strict';

/**
 * @fileoverview Generate → parse → validate → self-correct loop for a single user story.
 * The chat function is injected so the loop is unit-testable without a live LLM.
 */

import { parseGherkinScenarios } from '../parsers/GherkinToZephyrParser';
import { validateStoryScenarios, StoryValidationResult, ScenarioContext } from '../validators/scenarioValidator';
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

function isBetter(candidate: StoryValidationResult, best: StoryValidationResult | null): boolean {
  if (!best) return true;
  if (candidate.errors.length !== best.errors.length) return candidate.errors.length < best.errors.length;
  return candidate.scenarios.length > best.scenarios.length;
}

/**
 * Generates validated scenarios for one story, retrying with validator feedback.
 * After retries are exhausted, only valid scenarios are kept and remaining errors become warnings.
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

  let best: StoryValidationResult | null = null;
  let attempts = 0;
  for (let attempt = 0; attempt <= request.maxRetries; attempt += 1) {
    attempts += 1;
    // eslint-disable-next-line no-await-in-loop -- each retry depends on the previous validation result
    const text = await chat(messages);
    const result = validateStoryScenarios(parseGherkinScenarios(text), ctx);
    if (isBetter(result, best)) best = result;
    if (result.errors.length === 0) break;
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: buildRetryPrompt(result.errors) });
  }

  const final = best as StoryValidationResult;
  const unresolved = final.errors.map((error) => `[${feature.id}/${story.id}] Unresolved after ${attempts} attempt(s): ${error}`);
  return {
    feature, story, scenarios: final.scenarios, attempts, warnings: [...final.warnings, ...unresolved],
  };
}
