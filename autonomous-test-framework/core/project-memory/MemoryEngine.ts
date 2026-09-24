'use strict';

/**
 * @fileoverview Project Memory Engine for the ARIA Framework.
 * Learns from each test cycle and applies accumulated knowledge
 * to improve future test generation, healing, and reporting.
 *
 * @module MemoryEngine
 * @version 1.0.0
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { Mutex } from '../thread-manager/Mutex';
import { vectorStore } from './VectorStore';
import { allProjectSecrets, redactValue } from '../aut/knownSecrets';

// ─── Constants ────────────────────────────────────────────────────────────────

const MEMORY_FILE_PATH = path.resolve(__dirname, 'memory.json');
const LOCK_TIMEOUT_MS = 5000;
const MAX_CYCLES_IN_MEMORY = 50;
const MAX_PATTERNS_PER_CATEGORY = 200;

// ─── Default Memory Shape ─────────────────────────────────────────────────────

const createDefaultMemory = (projectId: string) => ({
  version:   '1.0.0',
  projectId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  cycles: [],

  globalLearnings: {
    selectorPatterns: {},
    knownBugs: [],
    healingStrategies: [],
    testDataPatterns: {},
    failurePatterns: [],
    approvalFeedback: [],
    performanceBaselines: {},
    resolvedClarifications: [],
    stableTestIds: [],
    flakyTestIds: [],
  },

  improvementRules: [],

  metrics: {
    totalRuns:          0,
    totalTestsRun:      0,
    totalBugsFound:     0,
    totalAutoHeals:     0,
    avgPassRate:        0,
    avgHealingRate:     0,
  },
});

// ─── MemoryEngine Class ───────────────────────────────────────────────────────

/**
 * @class MemoryEngine
 * @description Persistent learning store that improves agent behavior over time.
 */
export class MemoryEngine {
  private _mutex: Mutex;
  private _initialized: boolean;

  constructor() {
    this._mutex = new Mutex(LOCK_TIMEOUT_MS);
    this._initialized = false;
  }

  // ── Initialization ───────────────────────────────────────────────────────

  /**
   * Initializes memory engine. Loads or creates memory store.
   * @param {string} [projectId='default']
   * @returns {Promise<void>}
   */
  async initialize(projectId: string = 'default'): Promise<void> {
    if (this._initialized) return;

    try {
      await fsPromises.access(MEMORY_FILE_PATH);
    } catch {
      const defaultMemory = createDefaultMemory(projectId);
      await this._writeToStorage(defaultMemory);
    }

    // Initialize vector store for semantic search (non-blocking)
    try {
      await vectorStore.initialize();
    } catch {
      console.warn('[MemoryEngine] VectorStore initialization failed — semantic search disabled');
    }

    this._initialized = true;
  }

  // ── Core Operations ──────────────────────────────────────────────────────

  /**
   * Records a completed pipeline cycle into memory.
   * @param {Object} cycleSummary - Summary of the completed run
   * @returns {Promise<void>}
   */
  async recordCycle(cycleSummary: any): Promise<void> {
    await this._mutex.runExclusive(async () => {
      const memory = await this._readFromStorage();
      const cycle = {
        id:          `cycle_${Date.now()}`,
        timestamp:   new Date().toISOString(),
        runId:       cycleSummary.runId,
        passRate:    cycleSummary.passRate,
        totalTests:  cycleSummary.totalTests,
        bugsFound:   cycleSummary.bugsFound,
        autoHeals:   cycleSummary.autoHeals,
        stages:      cycleSummary.stages,
        keyLearnings: cycleSummary.keyLearnings || [],
      };

      memory.cycles.unshift(cycle);
      if (memory.cycles.length > MAX_CYCLES_IN_MEMORY) {
        memory.cycles = memory.cycles.slice(0, MAX_CYCLES_IN_MEMORY);
      }

      // Update aggregate metrics
      memory.metrics.totalRuns += 1;
      memory.metrics.totalTestsRun += cycleSummary.totalTests || 0;
      memory.metrics.totalBugsFound += cycleSummary.bugsFound || 0;
      memory.metrics.totalAutoHeals += cycleSummary.autoHeals || 0;
      memory.metrics.avgPassRate = this._rollingAverage(
        memory.metrics.avgPassRate,
        cycleSummary.passRate || 0,
        memory.metrics.totalRuns,
      );

      memory.updatedAt = new Date().toISOString();
      await this._writeToStorage(memory);

      // Index cycle in vector store for semantic search
      try {
        await vectorStore.addRecord(
          cycle.id,
          `Cycle ${cycle.runId}: ${cycle.totalTests} tests, ${cycle.passRate}% pass rate, ${cycle.bugsFound} bugs found, ${cycle.autoHeals} auto-heals. ${(cycle.keyLearnings || []).join('. ')}`,
          'cycle',
          { runId: cycle.runId, passRate: cycle.passRate, bugsFound: cycle.bugsFound }
        );
      } catch { /* non-blocking */ }
    });
  }

  /**
   * Records a successful selector healing for future re-use.
   * @param {string} brokenSelector - The selector that failed
   * @param {string} workingSelector - The healed replacement
   * @param {string} context - Page/component context
   * @returns {Promise<void>}
   */
  async recordHealedSelector(brokenSelector: string, workingSelector: string, context: string): Promise<void> {
    await this._mutex.runExclusive(async () => {
      const memory = await this._readFromStorage();
      const key = `${context}::${brokenSelector}`;
      const existing = (memory.globalLearnings.selectorPatterns as any)[key];

      (memory.globalLearnings.selectorPatterns as any)[key] = {
        brokenSelector,
        workingSelector,
        context,
        successCount:  existing ? existing.successCount + 1 : 1,
        firstHealed:   existing ? existing.firstHealed : new Date().toISOString(),
        lastUsed:      new Date().toISOString(),
      };

      memory.updatedAt = new Date().toISOString();
      await this._writeToStorage(memory);

      // Index healing pattern in vector store
      try {
        await vectorStore.addRecord(
          `heal_${Date.now()}`,
          `Healed selector in ${context}: "${brokenSelector}" → "${workingSelector}"`,
          'healing',
          { brokenSelector, workingSelector, context }
        );
      } catch { /* non-blocking */ }
    });
  }

  /**
   * Records a healing strategy that worked.
   * @param {Object} strategy - { name, description, condition, action, successRate }
   * @returns {Promise<void>}
   */
  async recordHealingStrategy(strategy: any): Promise<void> {
    await this._mutex.runExclusive(async () => {
      const memory = await this._readFromStorage();
      const existing = (memory.globalLearnings.healingStrategies as any[])
        .find((s) => s.name === strategy.name);

      if (existing) {
        existing.successCount = (existing.successCount || 0) + 1;
        existing.successRate = strategy.successRate || existing.successRate;
        existing.lastUsed = new Date().toISOString();
      } else {
        (memory.globalLearnings.healingStrategies as any[]).push({
          ...strategy,
          successCount: 1,
          addedAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
        });
      }

      // Sort by success count descending
      (memory.globalLearnings.healingStrategies as any[]).sort(
        (a, b) => (b.successCount || 0) - (a.successCount || 0),
      );

      if (memory.globalLearnings.healingStrategies.length > MAX_PATTERNS_PER_CATEGORY) {
        memory.globalLearnings.healingStrategies = memory.globalLearnings.healingStrategies
          .slice(0, MAX_PATTERNS_PER_CATEGORY);
      }

      memory.updatedAt = new Date().toISOString();
      await this._writeToStorage(memory);
    });
  }

  /**
   * Records human approval feedback for future generation improvement.
   * @param {string} stageId - Which stage was rejected/approved
   * @param {string} status - 'APPROVED' | 'REJECTED'
   * @param {string} comment - Human reviewer's comment
   * @param {string} [content] - Brief excerpt of what was reviewed
   * @returns {Promise<void>}
   */
  async recordApprovalFeedback(stageId: string, status: string, comment: string, content: string = ''): Promise<void> {
    await this._mutex.runExclusive(async () => {
      const memory = await this._readFromStorage();
      (memory.globalLearnings.approvalFeedback as any[]).push({
        id:        `fb_${Date.now()}`,
        stageId,
        status,
        comment,
        content,
        timestamp: new Date().toISOString(),
      });

      // Cap at 500 feedback items
      if (memory.globalLearnings.approvalFeedback.length > 500) {
        memory.globalLearnings.approvalFeedback = memory.globalLearnings.approvalFeedback
          .slice(-500);
      }

      memory.updatedAt = new Date().toISOString();
      await this._writeToStorage(memory);

      // Index feedback in vector store
      try {
        await vectorStore.addRecord(
          `fb_${Date.now()}`,
          `Approval feedback for ${stageId} (${status}): ${comment}. ${content}`,
          'feedback',
          { stageId, status }
        );
      } catch { /* non-blocking */ }
    });
  }

  /**
   * Records a known bug to prevent duplicate Jira issues.
   * @param {Object} bug - { title, hash, jiraKey, severity }
   * @returns {Promise<void>}
   */
  async recordKnownBug(bug: any): Promise<void> {
    await this._mutex.runExclusive(async () => {
      const memory = await this._readFromStorage();
      const isDuplicate = (memory.globalLearnings.knownBugs as any[])
        .some((b) => b.hash === bug.hash);

      if (!isDuplicate) {
        (memory.globalLearnings.knownBugs as any[]).push({
          ...bug,
          firstSeen: new Date().toISOString(),
          occurrences: 1,
        });
      } else {
        const existing = (memory.globalLearnings.knownBugs as any[]).find((b) => b.hash === bug.hash);
        existing.occurrences += 1;
        existing.lastSeen = new Date().toISOString();
      }

      memory.updatedAt = new Date().toISOString();
      await this._writeToStorage(memory);

      // Index known bug in vector store
      try {
        if (!isDuplicate) {
          await vectorStore.addRecord(
            `bug_${bug.hash}`,
            `Known bug [${bug.severity}]: ${bug.title}`,
            'bug',
            { hash: bug.hash, jiraKey: bug.jiraKey, severity: bug.severity }
          );
        }
      } catch { /* non-blocking */ }
    });
  }

  /**
   * Records a resolved clarification to avoid re-asking.
   * @param {string} question - Original question text
   * @param {string} answer - Human's answer
   * @param {string} stageId - Which stage asked
   * @returns {Promise<void>}
   */
  async recordClarification(question: string, answer: string, stageId: string): Promise<void> {
    await this._mutex.runExclusive(async () => {
      const memory = await this._readFromStorage();
      (memory.globalLearnings.resolvedClarifications as any[]).push({
        id:        `clq_${Date.now()}`,
        question,
        answer,
        stageId,
        resolvedAt: new Date().toISOString(),
      });

      memory.updatedAt = new Date().toISOString();
      await this._writeToStorage(memory);
    });
  }

  /**
   * Adds an improvement rule derived from failure analysis.
   * @param {Object} rule - { id, description, appliesTo, condition, action }
   * @returns {Promise<void>}
   */
  async addImprovementRule(rule: any): Promise<void> {
    await this._mutex.runExclusive(async () => {
      const memory = await this._readFromStorage();
      const existing = (memory.improvementRules as any[]).find((r) => r.id === rule.id);

      if (!existing) {
        (memory.improvementRules as any[]).push({
          ...rule,
          addedAt:     new Date().toISOString(),
          activeCount: 0,
        });
      } else {
        Object.assign(existing, rule, {
          updatedAt: new Date().toISOString()
        });
      }

      memory.updatedAt = new Date().toISOString();
      await this._writeToStorage(memory);

      // Index rule in vector store
      try {
        if (!existing) {
          await vectorStore.addRecord(
            `rule_${rule.id}`,
            `Improvement rule for ${rule.appliesTo}: IF ${rule.condition} THEN ${rule.action}. ${rule.description}`,
            'rule',
            { ruleId: rule.id, appliesTo: rule.appliesTo }
          );
        }
      } catch { /* non-blocking */ }
    });
  }

  // ── Query Operations ─────────────────────────────────────────────────────

  /**
   * Retrieves all improvement rules that apply to a given stage.
   * @param {string} stageId - Stage to filter rules for
   * @returns {Promise<Array>} Applicable rules
   */
  async getImprovementRules(stageId: string): Promise<any[]> {
    const memory = await this._readFromStorage();
    return (memory.improvementRules as any[]).filter(
      (r) => r.appliesTo === stageId || r.appliesTo === 'ALL',
    );
  }

  /**
   * Looks up a known healing for a broken selector.
   * @param {string} brokenSelector - The failing selector
   * @param {string} context - Page/component context
   * @returns {Promise<string|null>} Working selector or null
   */
  async getHealedSelector(brokenSelector: string, context: string): Promise<string | null> {
    const memory = await this._readFromStorage();
    const key = `${context}::${brokenSelector}`;
    const pattern = (memory.globalLearnings.selectorPatterns as any)[key];
    return pattern ? pattern.workingSelector : null;
  }

  /**
   * Checks if a bug has already been reported.
   * @param {string} hash - Bug content hash
   * @returns {Promise<Object|null>} Known bug record or null
   */
  async findKnownBug(hash: string): Promise<any | null> {
    const memory = await this._readFromStorage();
    return (memory.globalLearnings.knownBugs as any[]).find((b) => b.hash === hash) || null;
  }

  /**
   * Finds a known bug by its test case key.
   * @param {string} tcKey - Test case key (e.g., 'TC-LOGIN-01')
   * @returns {Promise<Object|null>} Known bug record or null
   */
  async findKnownBugByTcKey(tcKey: string): Promise<any | null> {
    const memory = await this._readFromStorage();
    return (memory.globalLearnings.knownBugs as any[]).find((b) => b.tcKey === tcKey) || null;
  }

  /**
   * Retrieves previously answered clarification matching a question.
   * @param {string} question - Question to look up
   * @returns {Promise<string|null>} Previous answer or null
   */
  async findAnsweredClarification(question: string): Promise<string | null> {
    const memory = await this._readFromStorage();
    const normalizedQ = question.toLowerCase().trim();
    const match = (memory.globalLearnings.resolvedClarifications as any[]).find(
      (c) => c.question.toLowerCase().trim() === normalizedQ,
    );
    return match ? match.answer : null;
  }

  /**
   * Returns the top N most successful healing strategies.
   * @param {number} [limit=10] - Number of strategies to return
   * @returns {Promise<Array>} Healing strategies
   */
  async getTopHealingStrategies(limit: number = 10): Promise<any[]> {
    const memory = await this._readFromStorage();
    return (memory.globalLearnings.healingStrategies as any[]).slice(0, limit);
  }

  /**
   * Performs semantic search across all memory types.
   * @param {string} query - Query text.
   * @param {number} [limit=5]
   * @returns {Promise<Array>}
   */
  async searchMemory(query: string, limit: number = 5): Promise<any[]> {
    return vectorStore.search(query, limit);
  }

  /**
   * Returns rejection feedback for a specific stage.
   * @param {string} stageId - Stage identifier
   * @returns {Promise<Array>} Feedback items
   */
  async getRejectionFeedbackForStage(stageId: string): Promise<any[]> {
    const memory = await this._readFromStorage();
    return (memory.globalLearnings.approvalFeedback as any[])
      .filter((f) => f.stageId === stageId && f.status === 'REJECTED');
  }

  /**
   * Returns full memory summary for a given stage's context.
   * Used by agents to load their context before executing.
   * @param {string} stageId - Agent stage identifier
   * @returns {Promise<Object>} Contextual memory snapshot
   */
  async getContextForStage(stageId: string): Promise<any> {
    const memory = await this._readFromStorage();
    return {
      improvementRules: (memory.improvementRules as any[]).filter(
        (r) => r.appliesTo === stageId || r.appliesTo === 'ALL',
      ),
      rejectionFeedback: (memory.globalLearnings.approvalFeedback as any[])
        .filter((f) => f.stageId === stageId && f.status === 'REJECTED')
        .slice(-20),
      // Answers are shared: a detail clarified for one stage is valid for every stage.
      resolvedClarifications: (memory.globalLearnings.resolvedClarifications as any[]).slice(-50),
      healingStrategies: (memory.globalLearnings.healingStrategies as any[]).slice(0, 20),
      lastCycle: memory.cycles[0] || null,
      metrics: memory.metrics,
    };
  }

  /**
   * Returns full memory object (read-only snapshot).
   * @returns {Promise<Object>}
   */
  async getFullMemory(): Promise<any> {
    return JSON.parse(JSON.stringify(await this._readFromStorage()));
  }

  // ── Storage Abstraction ──────────────────────────────────────────────────

  /**
   * Reads memory from persistent storage.
   * @private
   */
  private async _readFromStorage(): Promise<any> {
    const raw = await fsPromises.readFile(MEMORY_FILE_PATH, 'utf-8');
    return JSON.parse(raw);
  }

  /**
   * Writes memory to persistent storage.
   * @private
   */
  private async _writeToStorage(memory: any): Promise<void> {
    // Memory is committed with the code and shared by every project, so no project's secret may be written into it —
    // not in a clarification answer, an approval comment or a question an agent quoted a secret in.
    const { value } = redactValue(memory, allProjectSecrets(process.env));
    await fsPromises.writeFile(MEMORY_FILE_PATH, JSON.stringify(value, null, 2), 'utf-8');
  }

  /** @private */
  private _rollingAverage(currentAvg: number, newValue: number, n: number): number {
    if (n <= 1) return newValue;
    return Math.round(((currentAvg * (n - 1)) + newValue) / n * 100) / 100;
  }
}

export const memoryEngine = new MemoryEngine();

