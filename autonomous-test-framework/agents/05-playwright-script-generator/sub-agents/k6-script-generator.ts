/**
 * @fileoverview Sub-Agent for K6 Performance Script generation.
 */

import path from 'path';
import fs from 'fs';
import { Logger } from '../../../core/logger/Logger';
import { FILE_TYPE } from '../../../core/automation-reviewer/ReviewRules';
import { cleanContext, generateWithSelfReview } from './shared/generation-utils';

const STAGE_ID = '05-playwright-script-generator';
const K6_SKILL_PATH = path.resolve(__dirname, '../../../skills/k6-scripting.md');
const PLAYWRIGHT_SKILL_PATH = path.resolve(__dirname, '../../../skills/playwright-scripting.md');
const K6_LEARNINGS_PATH = path.resolve(__dirname, '../learnings/k6-learnings.md');
const ROOT_LEARNINGS_PATH = path.resolve(__dirname, '../LEARNINGS.md');

export class K6ScriptGenerator {
  private _logger: Logger;
  private _skill: string;

  constructor() {
    this._logger = new Logger('K6ScriptGenerator');
    this._skill = this._loadSkill();
  }

  /**
   * Loads the K6 scripting skill file and corresponding K6 learnings.
   * Gracefully falls back to base skill and learnings if specialized sub-files are pending.
   */
  private _loadSkill(): string {
    let skill = '';
    try {
      if (fs.existsSync(K6_SKILL_PATH)) {
        skill = fs.readFileSync(K6_SKILL_PATH, 'utf-8');
      } else if (fs.existsSync(PLAYWRIGHT_SKILL_PATH)) {
        skill = fs.readFileSync(PLAYWRIGHT_SKILL_PATH, 'utf-8');
      }
    } catch {
      skill = '';
    }

    try {
      if (fs.existsSync(K6_LEARNINGS_PATH)) {
        skill += '\n\n' + fs.readFileSync(K6_LEARNINGS_PATH, 'utf-8');
      } else if (fs.existsSync(ROOT_LEARNINGS_PATH)) {
        skill += '\n\n' + fs.readFileSync(ROOT_LEARNINGS_PATH, 'utf-8');
      }
    } catch {
      // non-blocking
    }

    return skill;
  }

  /**
   * Validates if test cases contain concrete, actionable performance target endpoints.
   */
  validateEndpoints(perfTCs: any[]): boolean {
    if (!perfTCs || perfTCs.length === 0) return false;
    const invalid = [
      'not specified',
      'unknown',
      'undefined',
      'none',
      'n/a',
      '',
      '{{targetendpoint}}',
    ];

    return perfTCs.some((tc: any) => {
      const ep = tc.performanceRef?.targetEndpoint || tc.apiDetails?.endpoint || '';
      return (
        ep &&
        !invalid.includes(String(ep).trim().toLowerCase()) &&
        (ep.startsWith('/') || ep.startsWith('http'))
      );
    });
  }

  /**
   * Generates individual K6 performance test scripts for performance test cases.
   * Cleans context and filters fixtures to avoid dumping bulky analysis objects.
   *
   * @param perfTCs - Array of performance test cases
   * @param featureId - Feature ID (e.g. 'FEAT-001')
   * @param featureName - Human readable feature name
   * @param testData - Test data dictionary / fixtures
   * @returns Array of objects containing tcKey and generated K6 code
   */
  async generateScripts(
    perfTCs: any[],
    featureId: string,
    featureName: string,
    testData: any
  ): Promise<Array<{ tcKey: string; code: string }>> {
    if (!this.validateEndpoints(perfTCs)) {
      this._logger.warn(
        `Skipping K6 performance script generation for ${featureId}: No concrete performance endpoints or workload conditions defined in requirements.`
      );
      return [];
    }

    const results: Array<{ tcKey: string; code: string }> = [];

    for (const tc of perfTCs) {
      this._logger.info(`Generating K6 script for ${tc.key}: ${tc.name}...`);

      const rawContext = {
        tc,
        featureId,
        featureName,
        testData,
      };

      const cleanedContext = cleanContext(rawContext, {
        mode: 'K6',
      });

      const k6Code = await generateWithSelfReview({
        stageId: STAGE_ID,
        fileType: FILE_TYPE.K6,
        skill: this._skill,
        context: cleanedContext,
        objective: `Generate a K6 performance script for ${tc.key}: ${tc.name}.`,
        logger: this._logger,
      });

      results.push({
        tcKey: tc.key,
        code: k6Code,
      });
    }

    return results;
  }
}
