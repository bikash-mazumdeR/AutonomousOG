'use strict';

/**
 * @fileoverview UI sub-agent: readiness → live DOM discovery → verified page object (locators, navigation and
 * verified flows) → validated test bodies → deterministic spec rendering with shared leading steps in beforeEach.
 */

import * as path from 'path';
import { AutomationTestCase } from '../contracts/automationTestCase';
import { DiscoveryResult, discoverFeature } from '../discovery/discoverFeature';
import {
  FlowUsage, PreconditionAction, applicableFlows, preconditionActionsFor, verifiedStatesFor,
} from '../discovery/flowExtractor';
import { ResolvedAutProfile } from '../../../core/aut/AutProfile';
import {
  MEMBER_KIND, PomRenderResult, pageObjectClassName, renderPom,
} from '../rendering/pomRenderer';
import { UiSpecParams, importPath, renderUiSpec } from '../rendering/specRenderer';
import { hoistCommonPrefix } from '../rendering/hookHoister';
import { generateTestBodies, TestOutcome } from '../generation/testBodyGenerator';
import { analyzeWithAST, FILE_TYPE, FINDING_SEVERITY } from '../../../core/automation-reviewer/ReviewRules';
import { FRAMEWORK_BASE_PAGE, FRAMEWORK_ENV_HELPER, FRAMEWORK_STORAGE_HELPER } from '../../../core/aut/projectPaths';
import { loadDiscoveryPrompt, loadGenerationPrompt } from './shared/generation-utils';
import {
  FeatureGenerationContext, FeatureGenerationResult, GeneratedFile, fileStem, missingForTestCase,
  needsContextOutcome, splitByReadiness,
} from './shared/featureContext';

type SpecBase = Omit<UiSpecParams, 'tests' | 'hook'>;

interface DiscoveryBindings {
  flowsByTcKey: Map<string, FlowUsage[]>;
  verifiedStatesByTcKey: Map<string, Record<number, { state: string; urlPath: string }>>;
  preconditionActionsByTcKey: Map<string, PreconditionAction[]>;
}

/**
 * The actions each test case's precondition was established with. A test case whose precondition actions can no
 * longer be rendered faithfully is reported, not generated.
 */
function preconditionBindings(discovery: DiscoveryResult, pom: PomRenderResult, testCases: AutomationTestCase[]): {
  byTcKey: Map<string, PreconditionAction[]>; unrenderable: TestOutcome[];
} {
  const traces = new Map((discovery.pageMap.traces || []).map((trace) => [trace.tcKey, trace]));
  const byTcKey = new Map<string, PreconditionAction[]>();
  const unrenderable: TestOutcome[] = [];
  for (const tc of testCases) {
    const actions = preconditionActionsFor(tc, traces.get(tc.tcKey), discovery.pageMap, pom.memberBySignature, pom.navigationByState);
    if (actions) byTcKey.set(tc.tcKey, actions);
    else unrenderable.push(needsContextOutcome(tc.tcKey, [{ kind: 'PRECONDITION', detail: 'The actions discovery performed to establish the precondition use an element or value that is no longer verified.' }]));
  }
  return { byTcKey, unrenderable };
}

/** Credential values the environment holds for this profile; a generated body may never contain one as a literal. */
function credentialSecrets(profile: ResolvedAutProfile, env: NodeJS.ProcessEnv = process.env): Array<{ name: string; value: string }> {
  const names = [...new Set([...Object.values(profile.auth.credentialEnvVars || {}), ...(profile.secretsEnvVars || [])])];
  return names.flatMap((name) => (env[name] ? [{ name, value: env[name] as string }] : []));
}

function discoveryBindings(
  discovery: DiscoveryResult,
  pom: PomRenderResult,
  testCases: AutomationTestCase[],
  preconditionActionsByTcKey: Map<string, PreconditionAction[]>,
): DiscoveryBindings {
  const traces = new Map((discovery.pageMap.traces || []).map((trace) => [trace.tcKey, trace]));
  const flowMembers = pom.contract.members
    .filter((member) => member.kind === MEMBER_KIND.FLOW && member.flowId)
    .map((member) => ({
      name: member.name, flowId: member.flowId as string, params: member.params || [], actions: member.actions || [],
    }));
  return {
    flowsByTcKey: new Map(testCases.map((tc) => [tc.tcKey, applicableFlows(tc, traces.get(tc.tcKey), discovery.pageMap, flowMembers)])),
    verifiedStatesByTcKey: new Map(testCases.map((tc) => [tc.tcKey, verifiedStatesFor(traces.get(tc.tcKey), discovery.pageMap)])),
    preconditionActionsByTcKey,
  };
}

/**
 * Renders the final spec with the leading statements every test shares moved into beforeEach. Falls back to the
 * unhoisted spec when hoisting would introduce any blocking review finding.
 */
function renderFinalSpec(base: SpecBase, tests: Array<{ tc: AutomationTestCase; body: string }>): { content: string; hook: string[] } {
  const plain = renderUiSpec({ ...base, tests });
  const { hook, bodies } = hoistCommonPrefix(tests.map((test) => test.body));
  if (hook.length === 0) return { content: plain, hook };
  const hoisted = renderUiSpec({ ...base, hook, tests: tests.map((test, idx) => ({ tc: test.tc, body: bodies[idx] })) });
  const keys = tests.map((test) => test.tc.tcKey);
  const blocked = analyzeWithAST(hoisted, FILE_TYPE.SPEC, keys).findings.some((finding) => finding.severity === FINDING_SEVERITY.BLOCKER);
  return blocked ? { content: plain, hook: [] } : { content: hoisted, hook };
}

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

    const stem = fileStem(ctx.featureKey);
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
      trace: ctx.trace,
      logger: ctx.logger,
      headless: ctx.headless,
      authenticate: ctx.authenticate,
    });

    const pageObject = pageObjectClassName(ctx.featureKey);
    const pomPath = path.join(ctx.paths.pagesDir, `${pageObject}.ts`);
    const pom = renderPom(discovery.pageMap, {
      className: pageObject,
      projectSlug: ctx.projectSlug,
      basePageImport: importPath(ctx.paths.pagesDir, FRAMEWORK_BASE_PAGE),
      envHelperImport: importPath(ctx.paths.pagesDir, FRAMEWORK_ENV_HELPER),
    });
    const hasLocators = pom.contract.members.some((member) => member.kind === MEMBER_KIND.LOCATOR);
    const blocked: TestOutcome[] = ready
      .filter((tc) => !hasLocators || discovery.issues.has(tc.tcKey))
      .map((tc) => needsContextOutcome(tc.tcKey, missingForTestCase(discovery.issues, tc.tcKey)));
    const discovered = ready.filter((tc) => hasLocators && !discovery.issues.has(tc.tcKey));
    const preconditions = preconditionBindings(discovery, pom, discovered);
    blocked.push(...preconditions.unrenderable);
    const generatable = discovered.filter((tc) => preconditions.byTcKey.has(tc.tcKey));
    const base = this._specBase(ctx, pageObject, pomPath);
    const bodies = generatable.length === 0 ? [] : await generateTestBodies({
      mode: 'UI',
      featureId: ctx.featureId,
      testCases: generatable,
      contract: pom.contract,
      systemPrompt: loadGenerationPrompt('UI', ctx.paths.learningsDir),
      priorReviewFindings: ctx.priorReviewFindings,
      storageKeys: ctx.profile.storageKeys,
      maxRetries: ctx.maxRetries,
      concurrency: ctx.concurrency,
      trace: ctx.trace,
      secrets: credentialSecrets(ctx.profile),
      ...discoveryBindings(discovery, pom, generatable, preconditions.byTcKey),
      renderHarness: (tc, body) => renderUiSpec({ ...base, tests: [{ tc, body }] }),
    }, ctx.chat);

    const specPath = path.join(ctx.paths.specsDir, `${stem}.spec.ts`);
    const assembled = this._assemble(generatable, bodies, base, { pomPath, pomCode: pom.code, specPath });
    return {
      outcomes: [...notReady, ...blocked, ...bodies], files: assembled.files, pageMapFile, fileByTcKey: assembled.fileByTcKey,
    };
  }

  private _specBase(ctx: FeatureGenerationContext, pageObject: string, pomPath: string): SpecBase {
    return {
      projectSlug: ctx.projectSlug,
      featureId: ctx.featureId,
      sourceReviewId: ctx.sourceReviewId,
      pageObject,
      pomImport: importPath(ctx.paths.specsDir, pomPath),
      fixtureImport: importPath(ctx.paths.specsDir, ctx.paths.fixtureFile),
      envImport: importPath(ctx.paths.specsDir, FRAMEWORK_ENV_HELPER),
      storageImport: importPath(ctx.paths.specsDir, FRAMEWORK_STORAGE_HELPER),
    };
  }

  private _assemble(
    testCases: AutomationTestCase[],
    bodies: TestOutcome[],
    base: SpecBase,
    target: { pomPath: string; pomCode: string; specPath: string },
  ): Pick<FeatureGenerationResult, 'files' | 'fileByTcKey'> {
    const byKey = new Map(testCases.map((tc) => [tc.tcKey, tc]));
    const generated = bodies.filter((outcome) => outcome.status === 'GENERATED');
    if (generated.length === 0) return { files: [], fileByTcKey: new Map() };
    const spec = renderFinalSpec(base, generated.map((outcome) => ({ tc: byKey.get(outcome.tcKey) as AutomationTestCase, body: outcome.body as string })));
    if (spec.hook.length > 0) generated.forEach((outcome) => { outcome.sharedSetup = spec.hook; });
    const files: GeneratedFile[] = [
      { path: target.pomPath, content: target.pomCode, kind: 'pom' },
      { path: target.specPath, content: spec.content, kind: 'spec' },
    ];
    return { files, fileByTcKey: new Map(generated.map((outcome) => [outcome.tcKey, target.specPath])) };
  }
}
