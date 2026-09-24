'use strict';

/**
 * @fileoverview Agent 01 eval suite runner. Runs the real requirement analysis (LLM, checks, correction round and
 * guardrails — no pipeline state, clarifications or approval gate) on every case, scores it against the case's labels
 * and compares the suite with the pass bars in thresholds.json.
 *
 * Cases live in evals/agent01/cases/<name>/case.json (application-agnostic, synthetic) and in
 * projects/<project>/evals/agent01/<name>/case.json (a project's own requirement documents).
 *
 * Usage: npm run eval:agent01 -- [--case=<name>] [--repeat=<n>]
 *   --case    run only the cases whose name contains this text
 *   --repeat  analyse each case n times and also score how stable the criteria are (costs n times the calls)
 *
 * Exit code: 0 when every bar is met, 1 when any is not, 2 when the runner itself fails.
 */

import * as fs from 'fs';
import * as path from 'path';
import '../../config/framework.config';
import { RequirementAnalyzerAgent } from '../../agents/01-requirement-analyzer/agent';
import {
  KnownSecret, findUngroundedClaims, profileSecrets, redactText,
} from '../../agents/01-requirement-analyzer/guardrails';
import { loadAutProfile } from '../../core/aut/AutProfile';
import { llmClient } from '../../core/llm/LLMClient';
import {
  CaseScore, EvalCase, Thresholds, criteriaOverlap, scoreCase, statementsOf, summarize,
} from './scoring';

const ROOT = path.resolve(__dirname, '../..');
const SUITE_CASES = path.join(__dirname, 'cases');
const PROJECTS = path.join(ROOT, 'projects');
const THRESHOLDS_FILE = path.join(__dirname, 'thresholds.json');
const REPORT_FILE = path.join(ROOT, 'reports/json/agent01-eval.json');
const STAGE_ID = '01-requirement-analyzer';
const EMPTY_MEMORY = { improvementRules: [], resolvedClarifications: [] };

interface LoadedCase {
  evalCase: EvalCase;
  file: string;
  requirements: string;
}

function argValue(name: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
}

function caseFilesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((entry) => path.join(dir, entry, 'case.json'))
    .filter((file) => fs.existsSync(file));
}

/** Every case file: the suite's own, then each project's. */
function discoverCases(): string[] {
  const projectDirs = fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS).map((p) => path.join(PROJECTS, p, 'evals', 'agent01')) : [];
  return [...caseFilesIn(SUITE_CASES), ...projectDirs.flatMap(caseFilesIn)];
}

function loadCase(file: string): LoadedCase {
  const evalCase: EvalCase = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const requirementFile = path.resolve(path.dirname(file), evalCase.requirement);
  if (!fs.existsSync(requirementFile)) throw new Error(`Case "${evalCase.name}": requirement not found at ${requirementFile}`);
  return { evalCase, file, requirements: fs.readFileSync(requirementFile, 'utf-8') };
}

/** The secrets production would redact for this case: its project's AUT profile secrets and any it lists itself. */
function secretsFor(evalCase: EvalCase): KnownSecret[] {
  const literal = Object.entries(evalCase.secrets || {}).map(([name, value]) => ({ value, placeholder: `{{${name}}}` }));
  const fromProfile = evalCase.projectId ? profileSecrets(loadAutProfile(evalCase.projectId), process.env) : [];
  return [...literal, ...fromProfile];
}

async function runCase(agent: RequirementAnalyzerAgent, loaded: LoadedCase, repeat: number): Promise<CaseScore> {
  const { evalCase, requirements } = loaded;
  const secrets = secretsFor(evalCase);
  const runs = [];
  for (let i = 0; i < repeat; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential: the provider is rate-limited and runs are compared
    runs.push(await agent.analyzeForEval(requirements, evalCase.name, EMPTY_MEMORY, secrets));
  }
  const [first] = runs;
  const ungrounded = findUngroundedClaims(first.report, redactText(requirements, secrets));
  const score = scoreCase(evalCase, first, secrets.map((s) => s.value), ungrounded);
  if (runs.length > 1) {
    const base = statementsOf(first.report);
    score.stability = runs.slice(1).reduce((total, run) => total + criteriaOverlap(base, statementsOf(run.report)), 0) / (runs.length - 1);
  }
  return score;
}

function printCase(score: CaseScore): void {
  if (score.error) {
    console.log(`\n✖ ${score.name}: ERROR ${score.error}`);
    return;
  }
  const c = score.criteria;
  const a = score.ambiguities;
  console.log(`\n• ${score.name}`);
  console.log(`  stories ${score.stories.actual}/${score.stories.expected}${score.sourceStoryIdsMissing.length ? ` (missing ids: ${score.sourceStoryIdsMissing.join(', ')})` : ''}`
    + ` | criteria ${c.matched.length}/${c.matched.length + c.missed.length} | ambiguities ${a.matched.length}/${a.matched.length + a.missed.length}`
    + `${score.stability !== undefined ? ` | stability ${score.stability.toFixed(2)}` : ''}`);
  const lines = [
    ...c.missed.map((ref) => `missed criterion ${ref}`),
    ...a.missed.map((about) => `missed ambiguity: ${about}`),
    ...score.schemaIssues,
    ...score.ungrounded,
    ...score.forbiddenHits.map((term) => `invented feature: "${term}"`),
    ...score.canaryHits.map((canary) => `followed injection: "${canary}"`),
    ...(score.leaksAfterGuardrail ? [`${score.leaksAfterGuardrail} secret(s) left after guardrails`] : []),
    ...(score.modelSecretLeaks ? [`model wrote ${score.modelSecretLeaks} secret(s); guardrails removed them`] : []),
  ];
  lines.forEach((line) => console.log(`    - ${line}`));
}

async function main(): Promise<number> {
  const filter = argValue('case');
  const repeat = Math.max(1, Number(argValue('repeat') || 1));
  const thresholds: Thresholds = JSON.parse(fs.readFileSync(THRESHOLDS_FILE, 'utf-8'));
  const cases = discoverCases().map(loadCase).filter((loaded) => !filter || loaded.evalCase.name.includes(filter));
  if (cases.length === 0) throw new Error(filter ? `No eval case matches "${filter}".` : 'No eval cases found.');

  console.log(`Agent 01 eval — ${cases.length} case(s), ${repeat} run(s) each`);
  const agent = new RequirementAnalyzerAgent();
  const scores: CaseScore[] = [];
  for (const loaded of cases) {
    const started = Date.now();
    // eslint-disable-next-line no-await-in-loop -- sequential, one provider
    const score = await runCase(agent, loaded, repeat).catch((error: Error): CaseScore => ({
      name: loaded.evalCase.name, error: error.message, schemaIssues: [], stories: { expected: loaded.evalCase.expect.stories, actual: 0 },
      sourceStoryIdsMissing: [], criteria: { matched: [], missed: [] }, ambiguities: { matched: [], missed: [] },
      forbiddenHits: [], canaryHits: [], ungrounded: [], modelSecretLeaks: 0, leaksAfterGuardrail: 0,
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
  console.error('Agent 01 eval failed to run:', error.message);
  process.exit(2);
});
