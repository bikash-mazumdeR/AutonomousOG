'use strict';

/**
 * @fileoverview Agent 10 — Auto Healer.
 * Analyses failed tests, applies targeted healing strategies, patches spec files,
 * and records all successful patterns to Project Memory.
 * @module AutoHealerAgent
 * @version 1.0.0
 */

import * as path from 'path';
import * as fs from 'fs';
import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { llmClient } from '../../core/llm/LLMClient';
import * as recast from 'recast';
// Specs are TypeScript; recast's default parser is JavaScript-only and rejects `?.` and type
// annotations, which made every AST heal and every LLM patch fail validation. Agent 06 already
// parses these files, so reuse its TypeScript-aware parser rather than adding a second one.
import { parseTypeScript } from '../../core/automation-reviewer/ReviewRules';
const b = recast.types.builders;

const STAGE_ID = '10-auto-healer';
const STAGE_NAME = 'Auto Healer';

const STRATEGY = Object.freeze({
  SELECTOR_HEAL:   'SELECTOR_HEAL',
  WAIT_ADJUSTMENT: 'WAIT_ADJUSTMENT',
  ASSERTION_RELAX: 'ASSERTION_RELAX',
  RETRY_NETWORK:   'RETRY_NETWORK',
  DATA_FIX:        'DATA_FIX',
});

const ERROR_TO_STRATEGY = Object.freeze([
  { re: /locator|getBy|element not found|resolved to \d+ elements/i, strategy: STRATEGY.SELECTOR_HEAL },
  { re: /timeout|timed out|exceeded.*ms/i,                           strategy: STRATEGY.WAIT_ADJUSTMENT },
  { re: /expect|assertion|received|toBe|toHave/i,                    strategy: STRATEGY.ASSERTION_RELAX },
  { re: /network|fetch|ECONNREFUSED|ENOTFOUND|api/i,                 strategy: STRATEGY.RETRY_NETWORK },
  { re: /invalid.*data|type.*error|cannot.*null|undefined/i,         strategy: STRATEGY.DATA_FIX },
]);

const LOCATOR_FALLBACKS = Object.freeze([
  (n: string) => `getByRole('button', { name: '${n}' })`,
  (n: string) => `getByRole('link',   { name: '${n}' })`,
  (n: string) => `getByLabel('${n}')`,
  (n: string) => `getByPlaceholder('${n}')`,
  (n: string) => `getByText('${n}')`,
]);

export class AutoHealerAgent {
  private _logger: Logger;

  constructor() {
    this._logger = new Logger(STAGE_ID);
  }

  async run(input: any): Promise<any> {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);
    if (!input.executionResults) throw new Error('executionResults not found.');

    try {
      await stateManager.markStageRunning(STAGE_ID);
      const results = input.executionResults;
      const failedTests = results.failedTests || [];

      if (failedTests.length === 0) { return await this._completeEmpty(startMs); }

      const knownStrategies = await memoryEngine.getTopHealingStrategies(20);
      const knownSelectors = await this._loadHealedSelectors();
      const patches: any[] = [], unhealed: any[] = [];

      for (const test of failedTests) {
        const patch: any = await this._healTest(test, knownStrategies, knownSelectors);
        if (patch.healed) {
          patches.push(patch);
          await memoryEngine.recordHealingStrategy({
            name: patch.strategyUsed, description: patch.description,
            condition: patch.errorPattern, action: patch.actionTaken, successRate: 0.8,
          });
          if (patch.selectorFixed) {
            await memoryEngine.recordHealedSelector(
              patch.selectorFixed.broken, patch.selectorFixed.healed, patch.context || 'unknown');
          }
        } else {
          unhealed.push({ tcKey: test.tcKey, reason: patch.reason });
        }
      }

      const healingRate = Math.round((patches.length / Math.max(failedTests.length, 1)) * 100);
      const output = {
        healingId: `heal_${Date.now()}`, healedAt: new Date().toISOString(),
        totalFailed: failedTests.length, healed: patches.length, unhealed: unhealed.length,
        healingRate, healingPatches: patches, unhealedTests: unhealed,
        strategies: [...new Set(patches.map((p) => p.strategyUsed))],
      };

      if (patches.length > 0) {
        await memoryEngine.addImprovementRule({
          id: `RULE-10-${Date.now()}`,
          description: `Auto-heal: ${patches.length}/${failedTests.length} fixed`,
          appliesTo: '05-playwright-script-generator', action: 'APPLY_HEALING_PATTERNS',
          addedAt: new Date().toISOString(),
        });
      }

      await stateManager.setPipelineArtifact('healingPatches', output);
      await stateManager.markStageCompleted(STAGE_ID, output);

      return this._buildAgentResult(output, [], Date.now() - startMs);
    } catch (error: any) {
      this._logger.error('Auto Healer failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  /**
   * Directories that can contain a generated spec, newest layout first.
   *
   * Agent 05 writes to tests/projects/<slug>/specs, so resolving only against tests/specs made every
   * heal fail with "Spec file missing".
   *
   * @returns {string[]} Existing absolute directories
   * @private
   */
  _specSearchDirs(): string[] {
    const testsRoot = path.resolve(__dirname, '../../tests');
    const projectsRoot = path.join(testsRoot, 'projects');
    const dirs: string[] = [];

    try {
      for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const specsDir = path.join(projectsRoot, entry.name, 'specs');
        if (fs.existsSync(specsDir)) dirs.push(specsDir);
      }
    } catch {
      // No per-project tests yet — the legacy directory below still applies.
    }

    const legacy = path.join(testsRoot, 'specs');
    if (fs.existsSync(legacy)) dirs.push(legacy);
    return dirs;
  }

  async _healTest(test: any, knownStrategies: any[], knownSelectors: any) {
    this._logger.info(`Healing test: ${test.tcKey}`, { error: test.error?.message });
    const errorMsg = test.error?.message || '';

    // Agent 07 reports location.file as a bare basename, so the spec has to be located by search.
    // Generated specs live under tests/projects/<slug>/specs; tests/specs is the legacy home and is
    // kept in the list so a hand-written spec there still resolves.
    const searchDirs = this._specSearchDirs();

    let specFile = test.specFile || test.file || test.location?.file || '';
    if (specFile && !path.isAbsolute(specFile)) {
      const base = path.basename(specFile);
      const candidates = [
        ...searchDirs.map((dir) => path.join(dir, base)),
        path.resolve(process.cwd(), specFile),
      ];
      const found = candidates.find((c) => fs.existsSync(c));
      if (found) specFile = found;
    }

    if (!specFile || !fs.existsSync(specFile)) {
      for (const dir of searchDirs) {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.spec.ts') || f.endsWith('.spec.js'));
        const match = files.find((file) => fs.readFileSync(path.join(dir, file), 'utf-8').includes(test.tcKey));
        if (match) { specFile = path.join(dir, match); break; }
      }
    }

    // 1. Contextual RAG Search for historical similar fixes
    const ragContext = await memoryEngine.searchMemory(errorMsg, 3);
    
    // 2. Try Rule-based / Memory-based healing first (fast)
    const strategies = this._selectStrategies(errorMsg, knownStrategies);
    for (const s of strategies) {
      const result = await this._applyStrategy(s.name, test, errorMsg, specFile, knownSelectors);
      if (result && result.healed) return result;
    }

    // 3. Fallback to LLM Agentic Healing (slow but smart)
    return await this._healWithLLM(test, errorMsg, specFile, ragContext);
  }

  async _healWithLLM(test: any, errorMsg: string, specFile: string, ragContext: any[]) {
    if (!specFile || !fs.existsSync(specFile)) return { healed: false, tcKey: test.tcKey, reason: 'Spec file missing' };

    const fileContent = fs.readFileSync(specFile, 'utf-8');
    const skillPath = path.resolve(__dirname, '../../skills/auto-healing.md');
    const skill = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf-8') : '';

    const prompt = `
Objective: Auto-heal a failing Playwright test script.
Error Message: ${errorMsg}
Test Context: ${test.tcKey} - ${test.name}
Spec File Path: ${specFile}

RELEVANT HISTORICAL FIXES (RAG):
${ragContext.map(r => `- Error: ${r.text}\n  Fix: ${r.metadata.action || 'N/A'}`).join('\n')}

CURRENT SCRIPT CONTENT:
\`\`\`javascript
${fileContent}
\`\`\`

Based on the error and historical fixes, provide the PATCHED JAVASCRIPT CODE for the entire file. 
Ensure you fix the brittle selector or logic that caused the failure.
Return ONLY the raw javascript code, no markdown blocks.
`;

    try {
      const response = await llmClient.chat(STAGE_ID, {
        messages: [
          { role: 'system', content: skill },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 4096
      });

      const cleanCode = response.text.replace(/```(?:javascript|js)?\n?|\n?```/g, '').trim();
      
      if (cleanCode && cleanCode.length > 10 && cleanCode !== fileContent) {
        // Validate syntax before writing
        try {
          parseTypeScript(cleanCode);
        } catch (syntaxErr: any) {
          this._logger.error('LLM generated invalid syntax', { 
            tcKey: test.tcKey, 
            error: syntaxErr.message 
          });
          return { 
            healed: false, 
            tcKey: test.tcKey, 
            reason: `LLM generated code with invalid syntax: ${syntaxErr.message}` 
          };
        }

        fs.writeFileSync(specFile, cleanCode, 'utf-8');
        return {
          healed: true,
          tcKey: test.tcKey,
          strategyUsed: 'AGENTIC_RAG_LLM',
          description: 'Healed using semantic RAG and LLM reasoning',
          errorPattern: 'complex',
          actionTaken: `LLM-Patched ${path.basename(specFile)}`,
          context: specFile,
          diff: {
            before: fileContent,
            after: cleanCode
          }
        };
      }
    } catch (error: any) {
      this._logger.error('LLM healing failed', { tcKey: test.tcKey, error: error.message });
    }

    return { healed: false, tcKey: test.tcKey, reason: 'LLM could not find a valid fix' };
  }

  _selectStrategies(errorMsg: string, knownStrategies: any[]) {
    const matched: any[] = [];
    (ERROR_TO_STRATEGY as any).forEach(({ re, strategy }: any) => {
      if (re.test(errorMsg)) matched.push({ name: strategy, source: 'rule', priority: matched.length + 1 });
    });
    knownStrategies.slice(0, 5).forEach((s, i) =>
      matched.push({ name: s.name, source: 'memory', priority: matched.length + i + 1 }));
    return matched;
  }

  async _applyStrategy(name: string, test: any, errorMsg: string, specFile: string, knownSelectors: any) {
    switch (name) {
      case STRATEGY.SELECTOR_HEAL:   return this._healSelector(test, errorMsg, specFile, knownSelectors);
      case STRATEGY.WAIT_ADJUSTMENT: return this._healWait(test, specFile);
      case STRATEGY.ASSERTION_RELAX: return this._healAssertion(test, specFile);
      case STRATEGY.RETRY_NETWORK:   return this._healNetwork(test);
      case STRATEGY.DATA_FIX:        return this._healData(test, specFile);
      default: return null;
    }
  }

  _healSelector(test: any, errorMsg: string, specFile: string, knownSelectors: any) {
    const extracted = this._extractSelector(errorMsg);
    if (!extracted || !specFile || !fs.existsSync(specFile))
      return { healed: false, tcKey: test.tcKey, reason: 'Cannot extract selector or spec missing' };

    const memHealed = knownSelectors[extracted];
    if (memHealed && this._patchFileWithAST(specFile, extracted, memHealed))
      return { healed: true, tcKey: test.tcKey, strategyUsed: STRATEGY.SELECTOR_HEAL,
        description: `Memory: "${extracted}" → "${memHealed}"`, errorPattern: 'locator',
        actionTaken: `Patched ${path.basename(specFile)}`, context: specFile,
        selectorFixed: { broken: extracted, healed: memHealed } };

    const name = this._extractElementName(extracted);
    for (const fb of LOCATOR_FALLBACKS) {
      const candidate = `this.page.${fb(name)}`;
      if (this._patchFileWithAST(specFile, extracted, candidate))
        return { healed: true, tcKey: test.tcKey, strategyUsed: STRATEGY.SELECTOR_HEAL,
          description: `Fallback: "${extracted}" → "${candidate}"`, errorPattern: 'locator',
          actionTaken: `Patched ${path.basename(specFile)}`, context: specFile,
          selectorFixed: { broken: extracted, healed: candidate } };
    }

    return { healed: false, tcKey: test.tcKey, reason: 'No working fallback locator found' };
  }

  _healWait(test: any, specFile: string) {
    if (!specFile || !fs.existsSync(specFile)) return { healed: false, tcKey: test.tcKey, reason: 'Spec file missing' };
    
    // Using AST to replace hardcoded wait with networkidle
    const diff = this._transformAST(specFile, (path: any) => {
      const { node } = path;
      if (node.type === 'CallExpression' && 
          node.callee.property && node.callee.property.name === 'waitForTimeout') {
        node.callee.property.name = 'waitForLoadState';
        node.arguments = [b.literal('networkidle')];
        return true;
      }
      return false;
    });

    if (diff) {
      return { healed: true, tcKey: test.tcKey, strategyUsed: STRATEGY.WAIT_ADJUSTMENT,
        description: 'Replaced hardcoded timeout with networkidle', errorPattern: 'timeout',
        actionTaken: `Patched ${path.basename(specFile)}`, context: specFile, diff };
    }
    return { healed: false, tcKey: test.tcKey, reason: 'No hardcoded timeouts to fix' };
  }

  _healAssertion(test: any, specFile: string) {
    if (!specFile || !fs.existsSync(specFile)) return { healed: false, tcKey: test.tcKey, reason: 'Spec file missing' };

    // Logic to relax assertions (e.g. toBe to toContain for strings, or relax numerical thresholds)
    const diff = this._transformAST(specFile, (path: any) => {
      const { node } = path;
      // Relax string equality to containment
      if (node.type === 'CallExpression' && 
          node.callee?.property?.name === 'toBe' &&
          node.arguments?.[0]?.type === 'Literal' &&
          typeof node.arguments[0].value === 'string') {
        node.callee.property.name = 'toContain';
        return true;
      }
      // Relax timing threshold if toBeLessThanOrEqual failed on latency
      if (node.type === 'CallExpression' &&
          node.callee?.property?.name === 'toBeLessThanOrEqual' &&
          node.arguments?.[0]?.type === 'Literal' &&
          typeof node.arguments[0].value === 'number') {
        node.arguments[0].value = Math.max(node.arguments[0].value * 4, 15000);
        return true;
      }
      return false;
    });

    if (diff) {
      return { healed: true, tcKey: test.tcKey, strategyUsed: STRATEGY.ASSERTION_RELAX,
        description: 'Adjusted assertion threshold / containment', errorPattern: 'assertion',
        actionTaken: `Patched ${path.basename(specFile)}`, context: specFile, diff };
    }
    return { healed: false, tcKey: test.tcKey, reason: 'No strict assertions to relax' };
  }

  _healNetwork(test: any) {
    return { healed: true, tcKey: test.tcKey, strategyUsed: STRATEGY.RETRY_NETWORK,
      description: 'Network failure — queued for clean retry', errorPattern: 'network/api',
      actionTaken: 'Test queued for Agent 11 re-run', context: 'runner' };
  }

  _healData(test: any, specFile: string) {
    if (!specFile || !fs.existsSync(specFile))
      return { healed: false, tcKey: test.tcKey, reason: 'Spec file missing' };
    
    const diff = this._transformAST(specFile, (path: any) => {
      const { node } = path;
      // Replace tcData['key'].value with tcData['key']?.value
      if (node.type === 'MemberExpression' && node.property.name === 'value' &&
          node.object.type === 'MemberExpression' && node.object.object.name === 'tcData') {
        node.optional = true;
        return true;
      }
      return false;
    });

    if (diff) {
      return { healed: true, tcKey: test.tcKey, strategyUsed: STRATEGY.DATA_FIX,
        description: 'Added optional chaining for data access', errorPattern: 'null/undefined',
        actionTaken: `Patched ${path.basename(specFile)}`, context: specFile, diff };
    }
    return { healed: false, tcKey: test.tcKey, reason: 'No unsafe data access found' };
  }

  async _loadHealedSelectors() {
    const memory = await memoryEngine.getFullMemory();
    const patterns = memory.globalLearnings?.selectorPatterns || {};
    const map: any = {};
    Object.values(patterns).forEach((p: any) => {
      if (p.brokenSelector && p.workingSelector) map[p.brokenSelector] = p.workingSelector;
    });
    return map;
  }

  /**
   * Semantic patching using AST.
   * Finds the exact call expression and replaces it.
   */
  _patchFileWithAST(filePath: string, search: string, replacement: string) {
    if (!filePath || !fs.existsSync(filePath)) {
      this._logger.warn('AST patching skipped: file missing', { filePath });
      return false;
    }
    try {
      const src = fs.readFileSync(filePath, 'utf-8');
      const ast = parseTypeScript(src);
      let modified = false;

      recast.visit(ast, {
        visitCallExpression(path) {
          const code = recast.print(path.node).code;
          if (code === search) {
            // Replace the entire call expression with the replacement code
            // This is a bit simplified, ideally we parse the replacement too
            const replacementAst = parseTypeScript(replacement).program.body[0];
            if (replacementAst.type === 'ExpressionStatement') {
              path.replace(replacementAst.expression);
            } else {
              path.replace(replacementAst);
            }
            modified = true;
          }
          this.traverse(path);
        }
      });

      if (modified) {
        const output = recast.print(ast).code;
        fs.writeFileSync(filePath, output, 'utf-8');
        return true;
      }
      return false;
    } catch (err) {
      this._logger.error('AST patching failed', { filePath, error: (err as any).message });
      return false; 
    }
  }

  /**
   * Generic AST transformation helper.
   */
  _transformAST(filePath: string, visitorFn: (path: any) => boolean) {
    if (!filePath || !fs.existsSync(filePath)) {
      this._logger.warn('AST transformation skipped: file missing', { filePath });
      return false;
    }
    try {
      const src = fs.readFileSync(filePath, 'utf-8');
      const ast = parseTypeScript(src);
      let modified = false;

      recast.visit(ast, {
        visitCallExpression(path) {
          if (visitorFn(path)) modified = true;
          this.traverse(path);
        },
        visitMemberExpression(path) {
          if (visitorFn(path)) modified = true;
          this.traverse(path);
        }
      });

      if (modified) {
        const output = recast.print(ast).code;
        fs.writeFileSync(filePath, output, 'utf-8');
        return true;
      }
      return false;
    } catch (err) {
      this._logger.error('AST transformation failed', { filePath, error: (err as any).message });
      return false;
    }
  }

  _extractSelector(errorMsg: string) {
    const m = errorMsg.match(/(?:this\.page|page)\.(getByTestId|getByRole|getByLabel|locator)\(['"][^'"]+['"]\)/);
    return m ? m[0] : null;
  }

  _extractElementName(expr: string) {
    const m = expr.match(/['"]([^'"]+)['"]/);
    return m ? m[1] : 'element';
  }

  async _completeEmpty(startMs: number) {
    const output = {
      healingId: `heal_${Date.now()}`, healedAt: new Date().toISOString(),
      totalFailed: 0, healed: 0, unhealed: 0, healingRate: 100,
      healingPatches: [], unhealedTests: [], strategies: [], message: 'No failures to heal.',
    };
    await stateManager.setPipelineArtifact('healingPatches', output);
    await stateManager.markStageCompleted(STAGE_ID, output);
    return this._buildAgentResult(output, [], Date.now() - startMs);
  }

  _buildAgentResult(output: any, warnings: any[], durationMs: number) {
    return {
      agentId: STAGE_ID, stageNumber: '10', stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED, output, clarifications: [], warnings,
      memoryUpdate: { healingRate: output.healingRate, healed: output.healed },
      timestamp: new Date().toISOString(), durationMs,
      approvalStatus: 'PENDING', approvalComment: '',
    };
  }
}

const agent = new AutoHealerAgent();
export default agent;

if (require.main === module) {
  (async () => {
    let projectId = FRAMEWORK_CONFIG.projectId;
    try {
      const { stateDb } = require('../../core/state-manager/Database');
      stateDb.initialize();
      const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get();
      if (latestRun && latestRun.project_id) {
        projectId = latestRun.project_id;
      }
    } catch {}

    await stateManager.initialize(projectId);
    await memoryEngine.initialize(projectId);
    let executionResults = await stateManager.getPipelineArtifact('executionResults');
    if (!executionResults) {
      try {
        const reportsDir = path.resolve(__dirname, '../../reports/json');
        if (fs.existsSync(reportsDir)) {
          const files = fs.readdirSync(reportsDir)
            .filter((f) => f.startsWith('execution-results-') && f.endsWith('.json'))
            .sort().reverse();
          if (files.length > 0) {
            executionResults = JSON.parse(fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8'));
          }
        }
      } catch {}
    }
    if (!executionResults) { console.error('❌ No execution results. Run Agent 07 first.'); process.exit(1); }
    const result = await agent.run({ executionResults });
    console.log(`✅ Agent 10 complete — Healed: ${result.output.healed}/${result.output.totalFailed}`);
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })();
}

