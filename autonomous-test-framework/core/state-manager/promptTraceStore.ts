'use strict';

/**
 * @fileoverview Persists a stage prompt trace to the pipeline state (for the UI) and to reports/json.
 * Diagnostic only: a failure is logged and never fails the stage.
 *
 * @module PromptTraceStore
 */

import * as fs from 'fs';
import * as path from 'path';

import { stateManager } from './StateManager';
import { PipelineArtifacts } from '../types';

const REPORTS_JSON_DIR = path.resolve(__dirname, '../../reports/json');

/**
 * Builds and saves a prompt trace.
 * @param {keyof PipelineArtifacts} artifactKey - e.g. 'agent05PromptTrace'
 * @param {string} fileName - File name under reports/json
 * @param {() => Record<string, any>} build - Deferred so a build error is contained too
 * @param {{ warn: Function }} logger
 * @returns {Promise<void>}
 */
export async function savePromptTrace(
  artifactKey: keyof PipelineArtifacts,
  fileName: string,
  build: () => Record<string, any>,
  logger: { warn: (message: string, meta?: any) => void },
): Promise<void> {
  try {
    const report = build();
    await stateManager.setPipelineArtifact(artifactKey, report);
    fs.mkdirSync(REPORTS_JSON_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORTS_JSON_DIR, fileName), JSON.stringify(report, null, 2), 'utf-8');
  } catch (error: any) {
    logger.warn(`Could not save the ${String(artifactKey)} prompt trace`, { error: error.message });
  }
}
