'use strict';

/**
 * @fileoverview API sub-agent: readiness (documented endpoint, method, status) → validated test bodies →
 * deterministic API spec rendering with a configured request context.
 */

import * as path from 'path';
import { AutomationTestCase } from '../contracts/automationTestCase';
import { importPath, renderApiSpec } from '../rendering/specRenderer';
import { generateTestBodies } from '../generation/testBodyGenerator';
import { FRAMEWORK_ENV_HELPER } from '../../../core/aut/projectPaths';
import { loadGenerationPrompt } from './shared/generation-utils';
import {
  FeatureGenerationContext, FeatureGenerationResult, GeneratedFile, fileStem, splitByReadiness,
} from './shared/featureContext';

export class APIScriptGenerator {
  /**
   * Generates the API spec for one feature.
   * @param {AutomationTestCase[]} testCases
   * @param {FeatureGenerationContext} ctx
   * @returns {Promise<FeatureGenerationResult>}
   */
  async generate(testCases: AutomationTestCase[], ctx: FeatureGenerationContext): Promise<FeatureGenerationResult> {
    const { ready, notReady } = splitByReadiness(testCases, ctx.profile, 'API');
    if (ready.length === 0) return { outcomes: notReady, files: [], fileByTcKey: new Map() };

    const specPath = path.join(ctx.paths.specsDir, `${fileStem(ctx.featureId)}.api.spec.ts`);
    const specParams = {
      projectSlug: ctx.projectSlug,
      featureId: ctx.featureId,
      sourceReviewId: ctx.sourceReviewId,
      fixtureImport: importPath(ctx.paths.specsDir, ctx.paths.fixtureFile),
      envImport: importPath(ctx.paths.specsDir, FRAMEWORK_ENV_HELPER),
      authHeaderEnv: ctx.profile.api?.authHeaderEnv,
      basePathEnv: ctx.profile.api?.basePathEnv,
    };
    const bodies = await generateTestBodies({
      mode: 'API',
      featureId: ctx.featureId,
      testCases: ready,
      systemPrompt: loadGenerationPrompt('API', ctx.paths.learningsDir),
      priorReviewFindings: ctx.priorReviewFindings,
      maxRetries: ctx.maxRetries,
      concurrency: ctx.concurrency,
      renderHarness: (tc, body) => renderApiSpec({ ...specParams, tests: [{ tc, body }] }),
    }, ctx.chat);

    const byKey = new Map(ready.map((tc) => [tc.tcKey, tc]));
    const generated = bodies.filter((o) => o.status === 'GENERATED');
    const files: GeneratedFile[] = [];
    const fileByTcKey = new Map<string, string>();
    if (generated.length > 0) {
      files.push({
        path: specPath,
        content: renderApiSpec({ ...specParams, tests: generated.map((o) => ({ tc: byKey.get(o.tcKey) as AutomationTestCase, body: o.body as string })) }),
        kind: 'spec',
      });
      generated.forEach((o) => fileByTcKey.set(o.tcKey, specPath));
    }
    return { outcomes: [...notReady, ...bodies], files, fileByTcKey };
  }
}
