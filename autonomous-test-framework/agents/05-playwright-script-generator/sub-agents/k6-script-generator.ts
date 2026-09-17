'use strict';

/**
 * @fileoverview K6 sub-agent: readiness (scenario, relative endpoint, SLA) → validated request/check bodies →
 * deterministic K6 scripts (one per test case) driven entirely by environment variables.
 */

import * as path from 'path';
import { AutomationTestCase } from '../contracts/automationTestCase';
import { renderK6Script } from '../rendering/specRenderer';
import { generateTestBodies } from '../generation/testBodyGenerator';
import { loadGenerationPrompt } from './shared/generation-utils';
import {
  FeatureGenerationContext, FeatureGenerationResult, GeneratedFile, fileStem, splitByReadiness,
} from './shared/featureContext';

export class K6ScriptGenerator {
  /**
   * Generates K6 scripts for one feature's performance test cases.
   * @param {AutomationTestCase[]} testCases
   * @param {FeatureGenerationContext} ctx
   * @returns {Promise<FeatureGenerationResult>}
   */
  async generate(testCases: AutomationTestCase[], ctx: FeatureGenerationContext): Promise<FeatureGenerationResult> {
    const { ready, notReady } = splitByReadiness(testCases, ctx.profile, 'K6');
    if (ready.length === 0) return { outcomes: notReady, files: [], fileByTcKey: new Map() };

    const scriptParams = (tc: AutomationTestCase, body: string) => ({
      projectSlug: ctx.projectSlug,
      featureId: ctx.featureId,
      sourceReviewId: ctx.sourceReviewId,
      tc,
      body,
      baseUrlEnv: ctx.profile.baseUrlEnv,
      thresholdEnv: ctx.profile.performance?.thresholdEnv,
    });
    const bodies = await generateTestBodies({
      mode: 'K6',
      featureId: ctx.featureId,
      testCases: ready,
      systemPrompt: loadGenerationPrompt('K6', ctx.paths.learningsDir),
      priorReviewFindings: ctx.priorReviewFindings,
      maxRetries: ctx.maxRetries,
      concurrency: ctx.concurrency,
      trace: ctx.trace,
      renderHarness: (tc, body) => renderK6Script(scriptParams(tc, body)),
    }, ctx.chat);

    const byKey = new Map(ready.map((tc) => [tc.tcKey, tc]));
    const files: GeneratedFile[] = [];
    const fileByTcKey = new Map<string, string>();
    for (const outcome of bodies.filter((o) => o.status === 'GENERATED')) {
      const tc = byKey.get(outcome.tcKey) as AutomationTestCase;
      const scriptPath = path.join(ctx.paths.k6Dir, `${fileStem(ctx.featureId)}-${fileStem(tc.tcKey)}.k6.js`);
      files.push({ path: scriptPath, content: renderK6Script(scriptParams(tc, outcome.body as string)), kind: 'k6' });
      fileByTcKey.set(tc.tcKey, scriptPath);
    }
    return { outcomes: [...notReady, ...bodies], files, fileByTcKey };
  }
}
