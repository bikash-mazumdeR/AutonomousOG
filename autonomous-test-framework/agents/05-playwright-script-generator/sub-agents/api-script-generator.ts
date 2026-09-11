/**
 * @fileoverview Sub-Agent for Playwright API Spec generation.
 */

import path from 'path';
import fs from 'fs';
import { Logger } from '../../../core/logger/Logger';
import { FILE_TYPE } from '../../../core/automation-reviewer/ReviewRules';
import { generateBatchedSpec } from './shared/generation-utils';

const STAGE_ID = '05-playwright-script-generator';
const API_SKILL_PATH = path.resolve(__dirname, '../../../skills/api-scripting.md');
const PLAYWRIGHT_SKILL_PATH = path.resolve(__dirname, '../../../skills/playwright-scripting.md');
const API_LEARNINGS_PATH = path.resolve(__dirname, '../learnings/api-learnings.md');
const ROOT_LEARNINGS_PATH = path.resolve(__dirname, '../LEARNINGS.md');

export class APIScriptGenerator {
  private _logger: Logger;
  private _skill: string;

  constructor() {
    this._logger = new Logger('APIScriptGenerator');
    this._skill = this._loadSkill();
  }

  /**
   * Loads the API scripting skill file and corresponding API learnings.
   * Gracefully falls back to base skill and learnings if specialized sub-files are pending.
   */
  private _loadSkill(): string {
    let skill = '';
    try {
      if (fs.existsSync(API_SKILL_PATH)) {
        skill = fs.readFileSync(API_SKILL_PATH, 'utf-8');
      } else if (fs.existsSync(PLAYWRIGHT_SKILL_PATH)) {
        skill = fs.readFileSync(PLAYWRIGHT_SKILL_PATH, 'utf-8');
      }
    } catch {
      skill = '';
    }

    try {
      if (fs.existsSync(API_LEARNINGS_PATH)) {
        skill += '\n\n' + fs.readFileSync(API_LEARNINGS_PATH, 'utf-8');
      } else if (fs.existsSync(ROOT_LEARNINGS_PATH)) {
        skill += '\n\n' + fs.readFileSync(ROOT_LEARNINGS_PATH, 'utf-8');
      }
    } catch {
      // non-blocking
    }

    return skill;
  }

  /**
   * Validates if test cases contain concrete, actionable API endpoints.
   * Filters out placeholders and unconfigured mock endpoints.
   */
  validateEndpoints(apiTCs: any[]): boolean {
    if (!apiTCs || apiTCs.length === 0) return false;
    const invalid = [
      'not specified',
      'unknown',
      'undefined',
      'none',
      'n/a',
      '',
      '/api',
      '/api/endpoint',
      '{{targetendpoint}}',
    ];

    return apiTCs.some((tc: any) => {
      const ep = tc.apiDetails?.endpoint || '';
      return (
        ep &&
        !invalid.includes(String(ep).trim().toLowerCase()) &&
        (ep.startsWith('/') || ep.startsWith('http'))
      );
    });
  }

  /**
   * Generates a Playwright API spec file using the request fixture.
   *
   * @param apiTCs - Array of API test cases
   * @param groupMeta - Feature group metadata (featureId, featureName, className, fileName)
   * @param testData - Test data fixtures dictionary
   * @param manifest - Application manifest
   * @returns Generated API spec code or null if endpoints are invalid
   */
  async generateSpec(
    apiTCs: any[],
    groupMeta: any,
    testData: any,
    manifest: any
  ): Promise<string | null> {
    if (!this.validateEndpoints(apiTCs)) {
      this._logger.warn(
        `Skipping API spec generation for ${groupMeta.featureId || 'unknown'}: No concrete API endpoints specified in requirements.`
      );
      return null;
    }

    this._logger.info(
      `Generating API spec for ${groupMeta.featureId || groupMeta.featureName} (${apiTCs.length} TCs)...`
    );

    const baseContext = {
      groupMeta: {
        featureId: groupMeta.featureId,
        featureName: groupMeta.featureName,
        className: groupMeta.className,
        fileName: groupMeta.fileName,
      },
      testData,
      generationMode: 'API',
    };

    return await generateBatchedSpec({
      fileType: FILE_TYPE.SPEC,
      skill: this._skill,
      allTCs: apiTCs,
      baseContext,
      objective: 'Generate a Playwright API spec file using the request fixture. No POM or page interactions.',
      logger: this._logger,
      stageId: STAGE_ID,
      mode: 'API',
    });
  }
}
