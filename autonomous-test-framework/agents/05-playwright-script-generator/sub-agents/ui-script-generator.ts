'use strict';

/**
 * @fileoverview UI sub-agent: readiness → live DOM discovery → verified page object → validated test bodies →
 * deterministic spec rendering.
 */

import * as path from 'path';
import { AutomationTestCase } from '../contracts/automationTestCase';
import { discoverFeature } from '../discovery/discoverFeature';
import { pageObjectClassName, renderPom } from '../rendering/pomRenderer';
import { importPath, renderUiSpec } from '../rendering/specRenderer';
import { generateTestBodies, TestOutcome } from '../generation/testBodyGenerator';
import { FRAMEWORK_BASE_PAGE, FRAMEWORK_ENV_HELPER } from '../../../core/aut/projectPaths';
import { loadDiscoveryPrompt, loadGenerationPrompt } from './shared/generation-utils';
import {
  FeatureGenerationContext, FeatureGenerationResult, GeneratedFile, fileStem, needsContextOutcome, splitByReadiness,
} from './shared/featureContext';

export class UIScriptGenerator {
  /**
   * Generates the page object and UI spec for one feature.
   * @param {AutomationTestCase[]} testCases - UI test cases of the feature, in key order
   * @param {FeatureGenerationContext} ctx
   * @returns {Promise<FeatureGenerationResult>}
   */
  async generate(testCases: AutomationTestCase[], ctx: FeatureGenerationContext): Promise<FeatureGenerationResult> {
    const { ready, notReady } = splitByReadiness(testCases, ctx.profile, 'UI');
    if (ready.length === 0) return { outcomes: notReady, files: [], fileByTcKey: new Map() };

    const stem = fileStem(ctx.featureId);
    const pageMapFile = path.join(ctx.paths.pageMapsDir, `${stem}.json`);
    ctx.logger.info(`Discovering application states for ${ctx.featureId} (${ready.length} test case(s))`);
    const discovery = await discoverFeature({
      featureId: ctx.featureId,
      testCases: ready,
      profile: ctx.profile,
      pageMapFile,
      fixtureValues: ctx.fixtureValues,
      plannerSystemPrompt: loadDiscoveryPrompt(ctx.paths.learningsDir),
      chat: ctx.chat,
      logger: ctx.logger,
      headless: ctx.headless,
    });

    const pageObject = pageObjectClassName(ctx.featureId);
    const pomPath = path.join(ctx.paths.pagesDir, `${pageObject}.ts`);
    const pom = renderPom(discovery.pageMap, {
      className: pageObject, projectSlug: ctx.projectSlug, basePageImport: importPath(ctx.paths.pagesDir, FRAMEWORK_BASE_PAGE),
    });
    const hasLocators = pom.contract.members.some((member) => member.kind === 'locator');
    const blocked: TestOutcome[] = ready
      .filter((tc) => !hasLocators || discovery.issues.has(tc.tcKey))
      .map((tc) => needsContextOutcome(tc.tcKey, hasLocators
        ? discovery.issues.get(tc.tcKey) || []
        : [{ kind: 'LOCATOR', detail: 'Discovery found no verifiable elements in the application.' }]));
    const generatable = ready.filter((tc) => hasLocators && !discovery.issues.has(tc.tcKey));

    const specPath = path.join(ctx.paths.specsDir, `${stem}.spec.ts`);
    const specParams = {
      projectSlug: ctx.projectSlug,
      featureId: ctx.featureId,
      sourceReviewId: ctx.sourceReviewId,
      pageObject,
      pomImport: importPath(ctx.paths.specsDir, pomPath),
      fixtureImport: importPath(ctx.paths.specsDir, ctx.paths.fixtureFile),
      envImport: importPath(ctx.paths.specsDir, FRAMEWORK_ENV_HELPER),
    };
    const bodies = generatable.length === 0 ? [] : await generateTestBodies({
      mode: 'UI',
      featureId: ctx.featureId,
      testCases: generatable,
      contract: pom.contract,
      systemPrompt: loadGenerationPrompt('UI', ctx.paths.learningsDir),
      priorReviewFindings: ctx.priorReviewFindings,
      maxRetries: ctx.maxRetries,
      concurrency: ctx.concurrency,
      renderHarness: (tc, body) => renderUiSpec({ ...specParams, tests: [{ tc, body }] }),
    }, ctx.chat);

    const byKey = new Map(generatable.map((tc) => [tc.tcKey, tc]));
    const generated = bodies.filter((outcome) => outcome.status === 'GENERATED');
    const files: GeneratedFile[] = [];
    const fileByTcKey = new Map<string, string>();
    if (generated.length > 0) {
      files.push({ path: pomPath, content: pom.code, kind: 'pom' });
      files.push({
        path: specPath,
        content: renderUiSpec({ ...specParams, tests: generated.map((o) => ({ tc: byKey.get(o.tcKey) as AutomationTestCase, body: o.body as string })) }),
        kind: 'spec',
      });
      generated.forEach((o) => fileByTcKey.set(o.tcKey, specPath));
    }
    return {
      outcomes: [...notReady, ...blocked, ...bodies], files, pageMapFile, fileByTcKey,
    };
  }
}
