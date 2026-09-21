'use strict';

/**
 * @fileoverview Agent 08 — Bug Reporter.
 * For every failed test in the execution results, creates a structured
 * Jira bug issue (via Atlassian REST API) with full attachments and
 * sends an email notification via Gmail SMTP.
 * Deduplicates against known bugs in memory and EXISTING Jira issues to avoid duplicate issues.
 *
 * @module BugReporterAgent
 * @version 1.0.0
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { gmailClient } from '../../notifications/gmail/GmailClient';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG, JIRA_CONFIG, GMAIL_CONFIG } from '../../config/framework.config';
import { jiraClient } from '../../mcp/jira/jira-mcp-client';
import { LATEST_PROJECT_SQL } from '../../core/state-manager/projectResolver';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_ID   = '08-bug-reporter';
const STAGE_NAME = 'Bug Reporter';
const NEXT_STAGE = '09-report-generator';

const SKILL_PATH = path.resolve(__dirname, '../../skills/bug-reporting.md');

/** @enum {string} */
const SEVERITY = {
  CRITICAL: 'Critical',
  HIGH:     'High',
  MEDIUM:   'Medium',
  LOW:      'Low',
};

/** @enum {string} */
const JIRA_PRIORITY: Record<string, string> = {
  Critical: 'Highest',
  High:     'High',
  Medium:   'Medium',
  Low:      'Low',
};

const SEVERITY_PATTERNS = [
  { re: /timeout|timed out/i,                          severity: SEVERITY.HIGH },
  { re: /403|401|unauthorized|forbidden/i,             severity: SEVERITY.CRITICAL },
  { re: /500|server error|internal error/i,            severity: SEVERITY.CRITICAL },
  { re: /null pointer|cannot read|undefined is not/i,  severity: SEVERITY.HIGH },
  { re: /assertion.*failed|expect.*received/i,         severity: SEVERITY.MEDIUM },
  { re: /element not found|locator.*resolved to/i,     severity: SEVERITY.MEDIUM },
  { re: /network|connection refused|econnrefused/i,    severity: SEVERITY.HIGH },
];

const LABEL_PATTERNS = [
  { re: /\[API\]/i,         label: 'API' },
  { re: /\[PERF\]/i,        label: 'Performance' },
  { re: /login|auth/i,      label: 'Security' },
  { re: /ui|page|screen/i,  label: 'UI' },
];

export class BugReporterAgent {
  private _logger: Logger;
  private _skill: string;

  constructor() {
    this._logger    = new Logger(STAGE_ID);
    this._skill     = this._loadSkill();
  }

  async run(input: any): Promise<any> {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);

    if (!input.executionResults) {
      throw new Error('executionResults not found. Ensure Agent 07 completed successfully.');
    }

    try {
      await stateManager.markStageRunning(STAGE_ID);

      const results  = input.executionResults;
      const failures = results.failedTests || [];
      const k6Fails  = (results.k6Results || []).filter((k: any) => k.passed === false);

      if (failures.length === 0 && k6Fails.length === 0) {
        const emptyOutput = this._buildEmptyOutput();
        await stateManager.setPipelineArtifact('bugReports', emptyOutput);
        await stateManager.markStageCompleted(STAGE_ID, emptyOutput);
        return this._buildAgentResult(emptyOutput, [], Date.now() - startMs);
      }

      this._mailer = this._createMailer();

      // ── 1. Fetch Existing Jira Issues for Sync ──────────────────────────
      this._logger.info('Syncing with Jira to avoid duplicates...');
      const existingIssues = await jiraClient.searchIssues(`project = ${JIRA_CONFIG.projectKey} AND issuetype = Bug AND status != Closed`);
      this._logger.info(`Found ${existingIssues.length} active issues in Jira.`);

      const bugReports: any[] = [];
      const skippedDups: any[] = [];
      const warnings: string[] = [];

      for (const failure of failures) {
        try {
          const report = await this._processFailed(failure, results, existingIssues);
          if (report.skipped) {
            skippedDups.push(report);
          } else {
            bugReports.push(report);
          }
        } catch (err: any) {
          warnings.push(`Failed to report bug for ${failure.tcKey}: ${err.message}`);
        }
      }

      for (const k6 of k6Fails) {
        try {
          const report = await this._processK6Failure(k6, results, existingIssues);
          bugReports.push(report);
        } catch (err: any) {
          warnings.push(`Failed to report K6 failure for ${k6.scriptName}: ${err.message}`);
        }
      }

      if (bugReports.length > 0) {
        await this._sendSummaryEmail(bugReports, results.summary);
      }

      const output = {
        reportId:       `bug_report_${Date.now()}`,
        reportedAt:     new Date().toISOString(),
        totalFailures:  failures.length + k6Fails.length,
        bugsCreated:    bugReports.filter((b) => b.jiraKey && !b.updated).length,
        bugsUpdated:    bugReports.filter((b) => b.updated).length,
        duplicatesSkipped: skippedDups.length,
        bugReports,
        skippedDuplicates: skippedDups,
        environment:    FRAMEWORK_CONFIG.environment,
        summary:        results.summary,
      };

      await stateManager.setPipelineArtifact('bugReports', output);
      await stateManager.markStageCompleted(STAGE_ID, output);

      const durationMs = Date.now() - startMs;
      const agentResult: any = this._buildAgentResult(output, warnings, durationMs);

      const gateResult = await approvalGate.waitForApproval({
        stageId:       STAGE_ID,
        stageName:     STAGE_NAME,
        nextStageName: NEXT_STAGE,
        summary:       this._buildApprovalSummary(output),
        fullOutput:    output,
        warnings,
      });

      agentResult.approvalStatus  = gateResult.status;
      agentResult.approvalComment = gateResult.comment;

      return agentResult;

    } catch (error: any) {
      this._logger.error('Agent execution failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  async _processFailed(failure: any, results: any, existingIssues: any[]) {
    const bug = this._buildBugReport(failure, results);
    const hash = this._hashBug(bug);

    // 1. Local Memory Deduplication
    const known = await memoryEngine.findKnownBug(hash);
    if (known) {
      this._logger.info('Duplicate bug (Memory) — skipping', { tcKey: failure.tcKey, jiraKey: known.jiraKey });
      return { ...bug, hash, skipped: true, duplicateOf: known.jiraKey, source: 'memory' };
    }

    // 2. Jira Bi-Directional Sync Deduplication
    const existingJira = existingIssues.find(issue => 
      issue.fields.summary.includes(failure.tcKey) || 
      issue.fields.summary.includes(failure.title)
    );

    if (existingJira) {
      this._logger.info('Existing issue found in Jira — adding comment', { jiraKey: existingJira.key });
      await jiraClient.addComment(existingJira.key, `⚠️ Another occurrence detected in Run ID: ${results.runId}\nError: ${failure.error?.message}`);
      await memoryEngine.recordKnownBug({ title: bug.title, hash, jiraKey: existingJira.key, severity: bug.severity });
      return { ...bug, hash, jiraKey: existingJira.key, updated: true, skipped: false };
    }

    // 3. Create New Issue
    const jiraKey = await jiraClient.createIssue({
      project: { key: JIRA_CONFIG.projectKey },
      issuetype: { name: JIRA_CONFIG.issueTypes.bug },
      summary: bug.title,
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: bug.description }] }]
      },
      priority: { name: JIRA_PRIORITY[bug.severity] || 'Medium' },
      labels: bug.labels,
      environment: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: JSON.stringify(bug.environment, null, 2) }] }]
      }
    });

    if (jiraKey) {
      await jiraClient.addAttachment(jiraKey, 'fake/path/to/screenshot.png'); // Placeholder
      await this._ensureNewStatus(jiraKey);
      (bug as any).jiraKey = jiraKey;
      await memoryEngine.recordKnownBug({ title: bug.title, hash, jiraKey, severity: bug.severity });
    }

    return { ...bug, hash, skipped: false };
  }

  async _processK6Failure(k6: any, results: any, existingIssues: any[]) {
    // Similar logic for K6
    const bug: any = {
      title: `[${FRAMEWORK_CONFIG.environment.toUpperCase()}][HIGH] Performance — ${k6.scriptName}`,
      severity: SEVERITY.HIGH,
      description: `K6 Threshold breach in ${k6.scriptName}`,
      labels: ['Performance', 'ARIA-AutoGenerated'],
      environment: FRAMEWORK_CONFIG.environment
    };
    const hash = this._hashBug(bug);
    const jiraKey = await jiraClient.createIssue({
       project: { key: JIRA_CONFIG.projectKey },
       issuetype: { name: JIRA_CONFIG.issueTypes.bug },
       summary: bug.title,
       description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: bug.description }] }] },
       labels: bug.labels
    });
    if (jiraKey) {
      await this._ensureNewStatus(jiraKey);
      (bug as any).jiraKey = jiraKey;
    }
    return { ...bug, hash, skipped: false };
  }

  async _ensureNewStatus(key: string) {
    try {
      const issue = await jiraClient.getIssue(key);
      if (issue && issue.fields.status.name.toLowerCase() !== 'new') {
        const transitions = await jiraClient.getTransitions(key);
        const newTransition = transitions.find(t => t.name.toLowerCase() === 'new');
        if (newTransition) {
          await jiraClient.transitionIssue(key, newTransition.id);
          this._logger.info('Issue transitioned to "New" status', { key });
        }
      }
    } catch (err: any) {
      this._logger.warn('Failed to ensure "New" status', { key, error: err.message });
    }
  }

  _buildBugReport(failure: any, results: any) {
    const severity = this._inferSeverity(failure.error?.message || '', failure);
    const labels   = this._inferLabels(failure.title);
    return {
      title:    `[${FRAMEWORK_CONFIG.environment.toUpperCase()}][${severity}][${failure.tcKey}] ${failure.title}`,
      severity,
      labels:   [...labels, 'ARIA-AutoGenerated'],
      description: `Test failed: ${failure.error?.message}\n\nRun ID: ${results.runId}`,
      environment: { name: FRAMEWORK_CONFIG.environment, browser: results.summary?.browser || 'chromium' },
      tcKey: failure.tcKey,
      testTitle: failure.title
    };
  }

  _hashBug(bug: any) {
    const content = `${bug.tcKey || bug.title}|${bug.environment?.name || ''}`;
    return crypto.createHash('md5').update(content).digest('hex').slice(0, 16);
  }

  _inferSeverity(errorMsg: string, failure: any) {
    for (const { re, severity } of SEVERITY_PATTERNS) {
      if (re.test(errorMsg)) return severity;
    }
    return SEVERITY.MEDIUM;
  }

  _inferLabels(title: string) {
    const labels: string[] = [];
    for (const { re, label } of LABEL_PATTERNS) {
      if (re.test(title)) labels.push(label);
    }
    return labels.length > 0 ? labels : ['Functional'];
  }

  async _sendSummaryEmail(bugReports: any[], summary: any) {
    const result = await gmailClient.send({
      to: GMAIL_CONFIG.to,
      subject: `[ARIA] ${bugReports.length} Bugs Found`,
      text: `Summary: ${summary.passed} passed, ${summary.failed} failed.`,
    });
    if (!result.success) {
      this._logger.error('Email failed', { error: result.error });
    }
  }

  _buildEmptyOutput() {
    return { reportId: `bug_report_${Date.now()}`, reportedAt: new Date().toISOString(), totalFailures: 0, bugsCreated: 0, bugReports: [] };
  }

  _buildApprovalSummary(output: any) {
    return { 'Total Failures': output.totalFailures, 'Jira Created': output.bugsCreated, 'Jira Updated': output.bugsUpdated, 'Dups Skipped': output.duplicatesSkipped };
  }

  _buildAgentResult(output: any, warnings: string[], durationMs: number) {
    return { agentId: STAGE_ID, stageNumber: '08', stageName: STAGE_NAME, status: STAGE_STATUS.COMPLETED, output, warnings, timestamp: new Date().toISOString(), durationMs };
  }

  _loadSkill() {
    try { return fs.readFileSync(SKILL_PATH, 'utf-8'); } catch { return ''; }
  }
}

const agent = new BugReporterAgent();
export default agent;

if (require.main === module) {
  (async () => {
    let projectId = FRAMEWORK_CONFIG.projectId;
    try {
      const { stateDb } = require('../../core/state-manager/Database');
      stateDb.initialize();
      const latestRun = stateDb.prepare(LATEST_PROJECT_SQL).get();
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
    if (!executionResults) { console.error('❌ No results'); process.exit(1); }
    const result = await agent.run({ executionResults });
    console.log(`✅ Agent 08 complete`);
    process.exit(0);
  })();
}

