'use strict';

/**
 * @fileoverview Agent 02 eval suite runner. Generates test cases with the real LLM from each case's frozen Agent 01
 * analysis (normalisation, redaction, validation and self-correction exactly as the stage runs them — no pipeline state,
 * memory, feature files or approval gate), scores them against the case's labels and compares the suite with the pass
 * bars in thresholds.json. Frozen analyses keep Agent 02's score independent of Agent 01's drift.
 *
 * Cases live in evals/agent02/cases/<name>/case.json (application-agnostic, synthetic) and in
 * projects/<project>/evals/agent02/<name>/case.json (a project's own analyses).
 *
 * Usage: npm run eval:agent02 -- [--case=<name>] [--repeat=<n>]
 * Exit code: 0 when every bar is met, 1 when any is not, 2 when the runner itself fails.
 */

import * as fs from 'fs';
import * as path from 'path';
import '../../config/framework.config';
import { TestCaseGeneratorAgent } from '../../agents/02-test-case-generator/agent';
import { SKIP_OPTIONS } from '../../agents/02-test-case-generator/constants';
import { loadAutProfile } from '../../core/aut/AutProfile';
import { KnownSecret, profileSecrets } from '../../core/aut/knownSecrets';
import { llmClient } from '../../core/llm/LLMClient';
import {
  CaseScore, EvalCase, Thresholds, scoreCase, summarize, titleOverlap,
} from './scoring';

const ROOT = path.resolve(__dirname, '../..');
const SUITE_CASES = path.join(__dirname, 'cases');
const PROJECTS = path.join(ROOT, 'projects');
const THRESHOLDS_FILE = path.join(__dirname, 'thresholds.json');
const REPORT_FILE = path.join(ROOT, 'reports/json/agent02-eval.json');
const STAGE_ID = '02-test-case-generator';

interface LoadedCase {
  evalCase: EvalCase;
  analysis: any;
}

function argValue(name: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
}

function caseFilesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((entry) => path.join(dir, entry, 'case.json')).filter((file) => fs.existsSync(file));
}

function discoverCases(): string[] {
  const projectDirs = fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS).map((p) => path.join(PROJECTS, p, 'evals', 'agent02')) : [];
  return [...caseFilesIn(SUITE_CASES), ...projectDirs.flatMap(caseFilesIn)];
}

function loadCase(file: string): LoadedCase {
  const evalCase: EvalCase = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const analysisFile = path.resolve(path.dirname(file), evalCase.analysis);
  if (!fs.existsSync(analysisFile)) throw new Error(`Case "${evalCase.name}": analysis not found at ${analysisFile}`);
  return { evalCase, analysis: JSON.parse(fs.readFileSync(analysisFile, 'utf-8')) };
}

/** Credential names and secrets as production would resolve them: from the case's project profile, plus its own. */
function environmentFor(evalCase: EvalCase): { credentialNames: string[]; secrets: KnownSecret[] } {
  const profile = evalCase.projectId ? loadAutProfile(evalCase.projectId) : undefined;
  const literal = Object.entries(evalCase.secrets || {}).map(([name, value]) => ({ value, placeholder: `{{${name}}}` }));
  return {
    credentialNames: [...new Set([...(evalCase.credentialNames || []), ...Object.keys(profile?.auth?.credentialEnvVars || {})])],
    secrets: [...literal, ...(profile ? profileSecrets(profile, process.env) : [])],
  };
}

/** The --skip-* options that exclude the case's types. */
function optionsFor(evalCase: EvalCase): Record<string, boolean> {
  const excluded = new Set(evalCase.excludedTypes || []);
  return Object.fromEntries(Object.entries(SKIP_OPTIONS).filter(([, tag]) => excluded.has(tag)).map(([flag]) => [flag, true]));
}

async function runCase(agent: TestCaseGeneratorAgent, loaded: LoadedCase, repeat: number): Promise<CaseScore> {
  const { evalCase, analysis } = loaded;
  const environment = environmentFor(evalCase);
  const runs = [];
  for (let i = 0; i < repeat; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential: one provider, and runs are compared
    runs.push(await agent.generateForEval(JSON.parse(JSON.stringify(analysis)), optionsFor(evalCase), environment));
  }
  const [first] = runs;
  const score = scoreCase(evalCase, {
    testCases: first.testCases, warnings: first.warnings, coverage: first.coverage, attempts: Object.values(first.meta.attemptsByStory || {}),
  }, analysis, { credentialNames: environment.credentialNames, secretValues: environment.secrets.map((s) => s.value) });
  if (runs.length > 1) {
    score.stability = runs.slice(1).reduce((total, run) => total + titleOverlap(first.testCases, run.testCases), 0) / (runs.length - 1);
  }
  return score;
}

function printCase(score: CaseScore): void {
  if (score.error) {
    console.log(`\n✖ ${score.name}: ERROR ${score.error}`);
    return;
  }
  const types = Object.entries(score.byType).map(([type, n]) => `${n} ${type}`).join(', ');
  const p = score.placeholders;
  console.log(`\n• ${score.name}`);
  console.log(`  ${score.testCases} test cases (${types}) | criteria ${score.criteria.covered}/${score.criteria.total}`
    + ` | attempts ${score.attempts.join(', ')} | placeholders reused ${p.reused.length}, new ${p.newNames.length}`
    + `${score.stability !== undefined ? ` | stability ${score.stability.toFixed(2)}` : ''}`);
  [
    ...score.unresolved,
    ...p.missing.map((name) => `did not use {{${name}}}`),
    ...(p.newNames.length ? [`new placeholder names: ${p.newNames.map((n) => `{{${n}}}`).join(', ')}`] : []),
    ...score.secretsLeaked.map((key) => `${key} writes out a secret`),
    ...score.ungrounded,
    ...score.forbiddenHits,
    ...score.excludedTypeLeaks.map((leak) => `excluded type got through: ${leak}`),
    ...score.duplicates,
    ...score.minByTypeMissed,
  ].forEach((line) => console.log(`    - ${line}`));
}

async function main(): Promise<number> {
  const filter = argValue('case');
  const repeat = Math.max(1, Number(argValue('repeat') || 1));
  const thresholds: Thresholds = JSON.parse(fs.readFileSync(THRESHOLDS_FILE, 'utf-8'));
  const cases = discoverCases().map(loadCase).filter((loaded) => !filter || loaded.evalCase.name.includes(filter));
  if (cases.length === 0) throw new Error(filter ? `No eval case matches "${filter}".` : 'No eval cases found.');

  console.log(`Agent 02 eval — ${cases.length} case(s), ${repeat} run(s) each`);
  const agent = new TestCaseGeneratorAgent();
  const scores: CaseScore[] = [];
  for (const loaded of cases) {
    const started = Date.now();
    // eslint-disable-next-line no-await-in-loop -- sequential, one provider
    const score = await runCase(agent, loaded, repeat).catch((error: Error): CaseScore => ({
      name: loaded.evalCase.name, error: error.message, testCases: 0, byType: {}, criteria: { covered: 0, total: 0 }, unresolved: [],
      placeholders: { used: [], reused: [], newNames: [], missing: [], required: 0 },
      secretsLeaked: [], ungrounded: [], forbiddenHits: [], excludedTypeLeaks: [], duplicates: [], minByTypeMissed: [], attempts: [],
    }));
    scores.push(score);
    printCase(score);
    console.log(`  (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }

  const { metrics, passed } = summarize(scores, thresholds);
  const usage = llmClient.getStageUsage(STAGE_ID);
  console.log('\nMetric                                        Value     Bar');
  metrics.forEach((m) => {
    const value = Number.isInteger(m.value) ? String(m.value) : m.value.toFixed(2);
    const mark = m.informational ? 'ℹ' : m.pass ? '✔' : '✖';
    console.log(`${mark} ${m.name.padEnd(44)}${value.padStart(6)}   ${m.informational ? '—' : `${m.kind === 'max' ? '≤' : '≥'} ${m.bar}`}`);
  });
  console.log(`\nTokens: ${usage.totalTokens} (≈ $${usage.estimatedCostUSD.toFixed(3)}) | Suite ${passed ? 'PASSED' : 'FAILED'}`);

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify({
    ranAt: new Date().toISOString(), repeat, passed, metrics, usage, cases: scores,
  }, null, 2), 'utf-8');
  console.log(`Report: ${path.relative(ROOT, REPORT_FILE)}`);
  return passed ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error('Agent 02 eval failed to run:', error.message);
  process.exit(2);
});
