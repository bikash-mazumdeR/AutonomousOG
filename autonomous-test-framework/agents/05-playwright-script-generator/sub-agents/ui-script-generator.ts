/**
 * @fileoverview Sub-Agent for UI Playwright Page Object Model (POM) and Spec generation.
 */

import path from 'path';
import fs from 'fs';
import { Logger } from '../../../core/logger/Logger';
import { FILE_TYPE } from '../../../core/automation-reviewer/ReviewRules';
import {
  cleanContext,
  generateWithSelfReview,
  generateBatchedSpec,
} from './shared/generation-utils';

const STAGE_ID = '05-playwright-script-generator';
const UI_SKILL_PATH = path.resolve(__dirname, '../../../skills/ui-scripting.md');
const PLAYWRIGHT_SKILL_PATH = path.resolve(__dirname, '../../../skills/playwright-scripting.md');
const UI_LEARNINGS_PATH = path.resolve(__dirname, '../learnings/ui-learnings.md');
const ROOT_LEARNINGS_PATH = path.resolve(__dirname, '../LEARNINGS.md');

export class UIScriptGenerator {
  private _logger: Logger;
  private _skill: string;

  constructor() {
    this._logger = new Logger('UIScriptGenerator');
    this._skill = this._loadSkill();
  }

  /**
   * Loads the UI scripting skill file and corresponding UI learnings.
   * Gracefully falls back to existing base skill and learnings if specialized sub-files are pending.
   */
  private _loadSkill(): string {
    let skill = '';
    try {
      if (fs.existsSync(UI_SKILL_PATH)) {
        skill = fs.readFileSync(UI_SKILL_PATH, 'utf-8');
      } else if (fs.existsSync(PLAYWRIGHT_SKILL_PATH)) {
        skill = fs.readFileSync(PLAYWRIGHT_SKILL_PATH, 'utf-8');
      }
    } catch {
      skill = '';
    }

    try {
      if (fs.existsSync(UI_LEARNINGS_PATH)) {
        skill += '\n\n' + fs.readFileSync(UI_LEARNINGS_PATH, 'utf-8');
      } else if (fs.existsSync(ROOT_LEARNINGS_PATH)) {
        skill += '\n\n' + fs.readFileSync(ROOT_LEARNINGS_PATH, 'utf-8');
      }
    } catch {
      // non-blocking
    }

    return skill;
  }

  /**
   * Generates a Playwright Page Object Model (POM) class for a feature group.
   *
   * @param group - The feature group containing UI test cases and metadata
   * @param healedSelectors - Map of self-healed selectors from memory engine
   * @returns Generated POM JavaScript code
   */
  async generatePOM(group: any, healedSelectors: any, reviewFeedback?: any): Promise<string> {
    this._logger.info(`Generating POM for ${group.className || group.featureName || group.featureId}...`);

    const rawContext = {
      group,
      healedSelectors: healedSelectors || {},
      analysis: group.analysis || {},
      reviewFeedback: reviewFeedback || null,
    };

    const cleanedContext = cleanContext(rawContext, {
      mode: 'UI',
      isFirstBatch: true,
    });

    return await generateWithSelfReview({
      stageId: STAGE_ID,
      fileType: FILE_TYPE.POM,
      skill: this._skill,
      context: cleanedContext,
      objective: 'Generate a Playwright Page Object Model class for UI test cases only.',
      logger: this._logger,
    });
  }

  /**
   * Generates a Playwright spec file for UI test cases using batched chunking.
   *
   * @param uiTCs - Array of UI test cases to generate tests for
   * @param groupMeta - Feature group metadata (featureId, featureName, className, fileName)
   * @param pomPath - Path to the generated POM file
   * @param pomClassName - Name of the POM class
   * @param pomCode - Source code of the generated POM
   * @param testData - Test data dictionary / fixtures
   * @param manifest - Application manifest
   * @param reviewFeedback - Optional review findings/blockers from Agent 06
   * @returns Merged runnable Playwright spec JavaScript code
   */
  async generateSpec(
    uiTCs: any[],
    groupMeta: any,
    pomPath: string,
    pomClassName: string,
    pomCode: string,
    testData: any,
    manifest: any,
    reviewFeedback?: any
  ): Promise<string> {
    this._logger.info(
      `Generating UI spec for ${groupMeta.featureId || groupMeta.featureName} (${uiTCs.length} TCs)...`
    );

    const baseContext = {
      groupMeta: {
        featureId: groupMeta.featureId,
        featureName: groupMeta.featureName,
        className: groupMeta.className,
        fileName: groupMeta.fileName,
      },
      pomPath,
      pomClassName,
      pomCode,
      testData,
      reviewFeedback: reviewFeedback || null,
    };

    return await generateBatchedSpec({
      fileType: FILE_TYPE.SPEC,
      skill: this._skill,
      allTCs: uiTCs,
      baseContext,
      objective: 'Generate a Playwright spec file for UI test cases.',
      logger: this._logger,
      stageId: STAGE_ID,
      mode: 'UI',
    });
  }
}
