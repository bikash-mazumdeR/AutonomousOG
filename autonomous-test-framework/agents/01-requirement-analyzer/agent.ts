'use strict';

/**
 * @fileoverview Agent 01 — Requirement Deep Analyzer & Business Logic Understander.
 * Entry point of the ARIA pipeline. Transforms raw requirements into a
 * structured analysis report that all downstream agents consume.
 *
 * @module RequirementAnalyzerAgent
 * @version 1.1.0
 */

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

import { stateManager, STAGE_STATUS, APPROVAL_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { llmClient } from '../../core/llm/LLMClient';
import { contextSqueezer } from '../../core/llm/ContextSqueezer';
import { AgentResult } from '../../core/types';
import { jiraClient } from '../../mcp/jira/jira-mcp-client';
import { computeInputFingerprint, findReusableAnalysis, ANALYSIS_SOURCE } from './inputFingerprint';
import { clarificationRequestFor, normalizeAmbiguities, normalizeQuestion } from './ambiguities';
import { ClarificationStore } from '../../core/clarifications/ClarificationStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_ID   = '01-requirement-analyzer';
const STAGE_NAME = 'Requirement Deep Analyzer';
const NEXT_STAGE = '02-test-case-generator';
const ANALYSIS_SEED = 42;

export class RequirementAnalyzerAgent {
  private _logger: Logger;
  private _skill: string;

  constructor() {
    this._logger = new Logger(STAGE_ID);
    this._skill  = this._loadSkill();
  }

  /**
   * Main execution method.
   */
  async run(input: any): Promise<any> {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID, { format: input.format });

    try {
      const memoryContext = await memoryEngine.getContextForStage(STAGE_ID);
      await stateManager.markStageRunning(STAGE_ID);

      let rawRequirements = await this._parseInput(input);
      // Fingerprint before squeezing: squeeze is itself an LLM call and not reproducible.
      const inputFingerprint = computeInputFingerprint({
        rawRequirements,
        skill: this._skill,
        // Only answers to Agent 01's own questions change the analysis; answers owned by later stages must not force a re-analysis.
        resolvedClarifications: (memoryContext.resolvedClarifications || []).filter((c: any) => c.stageId === STAGE_ID),
        improvementRules: memoryContext.improvementRules || [],
      });
      rawRequirements = await contextSqueezer.squeeze(rawRequirements, input.projectName || 'Requirements');
      
      // Save raw requirements for the chatbot and downstream agents
      await stateManager.setPipelineArtifact('requirements', rawRequirements);
      
      const analysisReport = await this._resolveAnalysis(rawRequirements, inputFingerprint, input, memoryContext);
      analysisReport.featureFilePaths = [];

      const resolvedAmbiguities = await this._autoResolveClarifications(
        analysisReport.ambiguities || [],
        memoryContext.resolvedClarifications
      );
      analysisReport.ambiguities = resolvedAmbiguities;
      analysisReport.ambiguitiesPending = resolvedAmbiguities.filter((a: any) => !a.resolved).length;

      const pendingAmbiguities = resolvedAmbiguities.filter((a: any) => !a.resolved);
      await this._requestClarifications(pendingAmbiguities, inputFingerprint);

      const usage = llmClient.getStageUsage(STAGE_ID);
      await stateManager.setPipelineArtifact('analyzedRequirements', analysisReport);

      // Invalidate any downstream stages and artifacts from prior requirement analyses
      await stateManager.update((state) => {
        const downstreamStages = [
          '02-test-case-generator', '03-test-case-reviewer', '04-test-data-generator',
          '05-playwright-script-generator', '06-automation-reviewer', '07-test-runner',
          '08-bug-reporter', '09-report-generator', '10-auto-healer', '11-retest-agent'
        ];
        downstreamStages.forEach(sId => {
          if (state.stages[sId]) {
            state.stages[sId].status = STAGE_STATUS.PENDING;
            state.stages[sId].output = null;
            state.stages[sId].approval = APPROVAL_STATUS.PENDING;
            state.stages[sId].completedAt = null;
            state.stages[sId].approvedAt = null;
          }
        });
        state.pipeline.testCases = null;
        state.pipeline.reviewedTestCases = null;
        state.pipeline.testData = null;
        state.pipeline.playwrightScripts = null;
        state.pipeline.reviewedScripts = null;
        state.pipeline.executionResults = null;
        state.pipeline.bugReports = null;
        state.pipeline.publishedReports = null;
        state.pipeline.healingPatches = null;
        state.pipeline.retestResults = null;
        try {
          const db = stateManager.getDatabase();
          db.prepare("DELETE FROM artifacts WHERE run_id = ? AND key NOT IN ('requirements', 'analyzedRequirements')").run(state.runId);
        } catch (_) {}
        return state;
      });

      await stateManager.markStageCompleted(STAGE_ID, analysisReport, usage);

      this._saveReportToDisk(analysisReport);

      const durationMs = Date.now() - startMs;
      const agentResult = this._buildAgentResult(analysisReport, [], durationMs);

      const gateResult = await approvalGate.waitForApproval({
        stageId:       STAGE_ID,
        stageName:     STAGE_NAME,
        nextStageName: NEXT_STAGE,
        summary:       this._buildApprovalSummary(analysisReport),
        fullOutput:    analysisReport,
        warnings:      [],
        clarifications: pendingAmbiguities.map((a: any) => a.question),
        usage,
      });

      agentResult.approvalStatus  = gateResult.status;
      agentResult.approvalComment = gateResult.comment;

      await memoryEngine.recordApprovalFeedback(
        STAGE_ID, gateResult.status, gateResult.comment,
        `Features: ${analysisReport.totalFeatures}, Stories: ${analysisReport.totalUserStories}`
      );

      return agentResult;

    } catch (error: any) {
      this._logger.error('Agent 01 execution failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  /**
   * Reuses the previous analysis when the requirement inputs are unchanged (unless --reanalyze),
   * otherwise runs the LLM analysis and stamps it with the input fingerprint.
   */
  private async _resolveAnalysis(rawRequirements: string, inputFingerprint: string, input: any, memoryContext: any) {
    const previous = input.reanalyze ? null : await stateManager.getLatestArtifactForProject('analyzedRequirements');
    const reusable = findReusableAnalysis(previous, inputFingerprint);
    if (reusable) {
      this._logger.info(`Reused analysis — requirement inputs unchanged (fingerprint ${inputFingerprint.slice(0, 12)})`);
      return { ...reusable, analysisSource: ANALYSIS_SOURCE.REUSED };
    }
    this._logger.info('Executing LLM-driven requirements decomposition...', { reanalyze: Boolean(input.reanalyze) });
    const report = await this._performLLMAnalysis(rawRequirements, input.projectName, memoryContext);
    return { ...report, inputFingerprint, analysisSource: ANALYSIS_SOURCE.REGENERATED };
  }

  private async _performLLMAnalysis(rawRequirements: string, projectName: string, memoryContext: any) {
    const prompt = `
You are a senior QA architect performing an exhaustive requirements decomposition for: ${projectName}

MEMORY / IMPROVEMENT RULES FROM PAST RUNS:
${JSON.stringify(memoryContext.improvementRules)}

RESOLVED CLARIFICATIONS / ANSWERS FROM HUMAN:
${JSON.stringify((memoryContext.resolvedClarifications || [])
    .filter((c: any) => c.stageId === STAGE_ID)
    .map((c: any) => ({ question: c.question, answer: c.answer })))}

CRITICAL INSTRUCTION: A topic answered in RESOLVED CLARIFICATIONS is settled, even though the requirement text itself does
not state it. Integrate the answer into your analysis and acceptance criteria, and never raise an ambiguity about the same
topic again, however it is worded.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FULL REQUIREMENTS INPUT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${rawRequirements}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MANDATORY ANALYSIS MANDATE:
Extract and cover the requirements comprehensively. You must consolidate the provided requirements into a SINGLE Feature.
Cover the following aspects using Scenario tags instead of separate features:
- Functional Requirements (@functional)
- UI / UX Requirements (@ui)
- Performance Requirements (@performance)
- Security & Authentication Requirements (@security)
- Accessibility Requirements (@accessibility)
- Error Handling & Edge Cases (@error-handling)

ACCEPTANCE CRITERIA FORMAT (strict): every acceptance criterion string MUST start with exactly one category
prefix in square brackets — [@functional], [@ui], [@performance], [@security], [@accessibility] or [@error-handling] —
followed by the criterion text. Never put the category at the end or in parentheses.
Example: "[@error-handling] The system displays 'Username is required' when the username field is empty"

AUTOMATION PREREQUISITES — raise an ambiguity for each one that neither the requirement nor the RESOLVED CLARIFICATIONS
settle; never invent the answer. Ask only what a person who knows the requirement can answer. Never ask for details that
test automation discovers from the running application (locators, element ids or attributes, image sources, CSS values
the requirement does not state) or for tooling choices (browsers, browser versions, frameworks).
For every acceptance criterion, check that the requirement states:
- ELEMENT_IDENTIFICATION: the exact visible text, label or name of every element or message the criterion refers to,
  including the exact wording of errors and dialogs and whether a "dialog" is part of the page or a browser pop-up.
- STORAGE_OR_STATE: how a stored or internal state becomes visible to the user. Storage keys, cookies and database
  contents cannot be observed through the user interface, so ask what the user can see instead.
- PAGE_URL: the URL path or page the user lands on after an action.
- TEST_VALUE: concrete input values, lengths and boundaries, and whether a boundary value is accepted or rejected.
- PRECONDITION: the state and navigation needed before the criterion can be exercised.
- ENVIRONMENT_AUTH: the environment, accounts or authentication the test needs.
Set "blockingTestGeneration": true ONLY for a contradiction or missing requirement that makes the whole feature
untestable. Automation prerequisites are never blocking — they are asked while the rest is generated.

TEST DATA VALUES: list every concrete test input value the requirement states in the user story's "testDataValues" as
{ "name": "<camelCase name>", "value": "<value exactly as written>", "sourceRef": "AC-n or BR-n", "sensitive": false }.
For passwords, tokens and other secrets set "sensitive": true and omit "value".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIRED JSON OUTPUT FORMAT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY a single valid JSON object (no prose, no markdown outside the JSON block):

{
  "totalFeatures": 1,
  "totalUserStories": 2,

  "features": [
    {
      "id": "F-01",
      "name": "E-Commerce Checkout",
      "description": "Core checkout flow functionality.",
      "riskLevel": "High",
      "userStories": [
        {
          "id": "US-01",
          "title": "Add to cart",
          "goal": "Allow users to add items to their cart",
          "acceptanceCriteria": ["[@functional] Clicking Add to cart adds the item to the cart"],
          "testDataValues": [{ "name": "productName", "value": "<value quoted in the requirement>", "sourceRef": "AC-1", "sensitive": false }],
          "testTypes": ["Functional", "UI"]
        }
      ]
    }
  ],

  "integrationPoints": [
    {
      "id": "IP-01",
      "name": "Database",
      "type": "INTERNAL",
      "endpoint": "N/A",
      "criticality": "High"
    }
  ],

  "ambiguities": [
    {
      "id": "AMB-01",
      "featureId": "F-01",
      "userStoryId": "US-01",
      "acceptanceCriterion": "<exact acceptance criterion text the question is about>",
      "category": "REQUIREMENT | ELEMENT_IDENTIFICATION | STORAGE_OR_STATE | PAGE_URL | TEST_VALUE | PRECONDITION | ENVIRONMENT_AUTH",
      "description": "what the requirement leaves open",
      "question": "the specific question to ask",
      "blockingTestGeneration": false
    }
  ]
}

CRITICAL:
- Consolidate requirements into a SINGLE primary feature.
- Extract concrete, unambiguous acceptance criteria (concise 1-2 sentence statements or standard BDD format).
- Avoid repetitive or circular text to ensure clean, structured JSON output.
`;

    const response = await llmClient.chat(STAGE_ID, {
      messages: [
        { role: 'system', content: this._skill },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
      seed: ANALYSIS_SEED,
      max_tokens: 16384,
      json: true,
    });

    try {
      const report = this._repairAndParseJson(response.text);
      report.features = report.features || [];
      report.businessRules = report.businessRules || [];
      report.stateTransitions = report.stateTransitions || [];
      report.integrationPoints = report.integrationPoints || [];
      report.ambiguities = normalizeAmbiguities(report.ambiguities || [], report.features);
      report.totalFeatures = report.totalFeatures ?? report.features.length;
      report.totalUserStories = report.totalUserStories ?? report.features.reduce((acc: number, f: any) => acc + (f.userStories?.length || 0), 0);
      return report;
    } catch (error: any) {
      this._logger.error('Failed to parse LLM JSON', { response: response.text });
      throw new Error('LLM did not return valid JSON analysis.');
    }
  }

  private _repairAndParseJson(rawText: string): any {
    let cleaned = (rawText || '').trim();

    // Strip markdown code fences if present
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    } else {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    const firstBrace = cleaned.indexOf('{');
    if (firstBrace !== -1) {
      cleaned = cleaned.slice(firstBrace);
    }

    // Attempt 1: Direct parse
    try {
      return JSON.parse(cleaned);
    } catch (_) {
      // Proceed to repair
    }

    // Attempt 2: Trailing comma removal
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(cleaned);
    } catch (_) {
      // Proceed to truncation repair
    }

    // Attempt 3: Truncation recovery (unclosed strings, brackets, braces)
    let inString = false;
    let escaped = false;
    const stack: string[] = [];

    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (c === '{' || c === '[') {
          stack.push(c);
        } else if (c === '}' || c === ']') {
          stack.pop();
        }
      }
    }

    if (inString) {
      cleaned += '"';
    }

    cleaned = cleaned.replace(/,\s*$/, '');

    while (stack.length > 0) {
      const open = stack.pop();
      cleaned += open === '{' ? '}' : ']';
    }

    return JSON.parse(cleaned);
  }

  private async _parseInput(input: any): Promise<string> {
    const { requirements, format = 'text' } = input;

    if (!requirements) {
      throw new Error('No requirements provided. Please supply requirements using --requirements=<path or text>');
    }

    if (format === 'jira') {
      this._logger.info(`Fetching requirements from Jira issue: ${requirements}`);
      const issue = await jiraClient.getIssue(requirements);
      if (!issue) {
        throw new Error(`Could not fetch Jira issue: ${requirements}`);
      }

      const fields = issue.fields || {};
      const rendered = issue.renderedFields || {};

      // ── Core Fields ──────────────────────────────────────────────────────
      const summary     = fields.summary || '';
      const issueType   = fields.issuetype?.name || 'Story';
      const priority    = fields.priority?.name || 'Medium';
      const status      = fields.status?.name || '';
      const labels      = (fields.labels || []).join(', ');
      const reporter    = fields.reporter?.displayName || '';
      const assignee    = fields.assignee?.displayName || 'Unassigned';

      // ── Description: prefer rendered HTML fallback, then ADF, then raw ──
      let description = '';
      if (rendered.description) {
        // rendered HTML → strip tags to get clean text
        description = rendered.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      } else {
        description = this._adfToText(fields.description);
      }

      // ── Acceptance Criteria: auto-discover the correct custom field ───────
      // Try known AC field IDs across common Atlassian configurations.
      const AC_FIELD_CANDIDATES = [
        'customfield_10104', // Acceptance Criteria (most common)
        'customfield_10105', // Acceptance Criteria (alternate)
        'customfield_10101', // fallback
      ];
      let acceptanceCriteria = '';
      for (const fieldId of AC_FIELD_CANDIDATES) {
        const val = fields[fieldId];
        if (val) {
          // rendered version takes priority
          const renderedAC = rendered[fieldId];
          if (renderedAC && typeof renderedAC === 'string') {
            acceptanceCriteria = renderedAC.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          } else {
            acceptanceCriteria = this._adfToText(val);
          }
          this._logger.info(`Acceptance Criteria found in ${fieldId}`);
          break;
        }
      }

      // ── Comments ─────────────────────────────────────────────────────────
      let commentsText = '';
      const comments = fields.comment?.comments || [];
      if (comments.length > 0) {
        commentsText = comments
          .slice(0, 10) // cap at 10 most recent comments to avoid context bloat
          .map((c: any) => {
            const author = c.author?.displayName || 'Unknown';
            const body   = rendered.comment?.comments?.find((rc: any) => rc.id === c.id)?.body
              ? rendered.comment.comments.find((rc: any) => rc.id === c.id).body
                  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
              : this._adfToText(c.body);
            return `  [${author}]: ${body}`;
          })
          .join('\n');
      }

      // ── Sub-tasks ─────────────────────────────────────────────────────────
      const subtasks = (fields.subtasks || []).map((s: any) =>
        `  - [${s.key}] ${s.fields?.summary || ''} (${s.fields?.status?.name || ''})`
      ).join('\n');

      // ── Attachments ───────────────────────────────────────────────────────
      const attachments = (fields.attachment || []).map((a: any) =>
        `  - ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)}KB)`
      ).join('\n');

      // ── Story Points ──────────────────────────────────────────────────────
      const storyPoints = fields.customfield_10016 || 'N/A';

      // ── Assemble full requirements string ─────────────────────────────────
      const parts: string[] = [
        `Jira Issue : ${requirements}`,
        `Issue Type : ${issueType}`,
        `Summary    : ${summary}`,
        `Priority   : ${priority}`,
        `Status     : ${status}`,
        `Reporter   : ${reporter}`,
        `Assignee   : ${assignee}`,
        `Labels     : ${labels || 'None'}`,
        `Story Pts  : ${storyPoints}`,
        '',
        '=== DESCRIPTION ===',
        description || '(No description provided)',
        '',
        '=== ACCEPTANCE CRITERIA ===',
        acceptanceCriteria || '(No acceptance criteria provided)',
      ];

      if (commentsText) {
        parts.push('', '=== COMMENTS ===', commentsText);
      }
      if (subtasks) {
        parts.push('', '=== SUB-TASKS ===', subtasks);
      }
      if (attachments) {
        parts.push('', '=== ATTACHMENTS ===', attachments);
      }

      return parts.join('\n').trim();
    }

    // If format is 'file' or requirements looks like a file path, resolve and read it
    if (typeof requirements === 'string' && (format === 'file' || requirements.endsWith('.md') || requirements.endsWith('.txt') || requirements.startsWith('./') || requirements.startsWith('../'))) {
      const candidates = [
        path.resolve(process.cwd(), requirements),
        path.resolve(process.cwd(), '..', requirements),
        path.resolve(process.cwd(), 'requirements', path.basename(requirements)),
        path.resolve(__dirname, '../../', requirements),
        path.resolve(__dirname, '../../requirements', path.basename(requirements)),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          this._logger.info('Requirements file resolved in agent — reading contents', { path: candidate });
          return fs.readFileSync(candidate, 'utf-8');
        }
      }

      if (format === 'file' || requirements.endsWith('.md') || requirements.endsWith('.txt')) {
        throw new Error(`Requirements file not found at "${requirements}". Checked locations:\n  - ${candidates.join('\n  - ')}`);
      }
    }

    return typeof requirements === 'string' ? requirements : JSON.stringify(requirements);
  }

  /**
   * Converts Atlassian Document Format (ADF) JSON to plain text.
   * Handles all standard ADF node types: paragraphs, headings, lists,
   * tables, code blocks, blockquotes, expands, and inline elements.
   * @private
   */
  private _adfToText(adf: any): string {
    if (!adf) return '';
    if (typeof adf === 'string') return adf;

    const lines: string[] = [];
    let currentLine = '';
    let listDepth   = 0;
    let listCounter: number[] = [];

    const flush = () => {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = '';
    };

    const walk = (node: any, depth: number = 0): void => {
      if (!node || typeof node !== 'object') return;

      switch (node.type) {
        // ── Inline text ──────────────────────────────────────────────────
        case 'text':
          currentLine += node.text || '';
          break;

        case 'hardBreak':
          flush();
          break;

        case 'mention':
          currentLine += `@${node.attrs?.text || node.attrs?.id || 'user'}`;
          break;

        case 'inlineCard':
        case 'blockCard':
          currentLine += node.attrs?.url || node.attrs?.data?.url || '[link]';
          break;

        case 'emoji':
          currentLine += node.attrs?.text || '';
          break;

        // ── Block: Paragraph ────────────────────────────────────────────
        case 'paragraph':
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          flush();
          break;

        // ── Block: Headings ─────────────────────────────────────────────
        case 'heading': {
          const level = node.attrs?.level || 1;
          const prefix = '#'.repeat(level) + ' ';
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          currentLine = prefix + currentLine;
          flush();
          lines.push(''); // blank line after heading
          break;
        }

        // ── Block: Bullet List ──────────────────────────────────────────
        case 'bulletList':
          listDepth++;
          listCounter.push(0);
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          listDepth--;
          listCounter.pop();
          if (listDepth === 0) lines.push('');
          break;

        // ── Block: Ordered List ─────────────────────────────────────────
        case 'orderedList':
          listDepth++;
          listCounter.push(0);
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          listDepth--;
          listCounter.pop();
          if (listDepth === 0) lines.push('');
          break;

        // ── Block: List Item ────────────────────────────────────────────
        case 'listItem': {
          const indent  = '  '.repeat(Math.max(0, listDepth - 1));
          const isOrdered = listCounter.length > 0;
          if (isOrdered) {
            listCounter[listCounter.length - 1]++;
            currentLine = `${indent}${listCounter[listCounter.length - 1]}. `;
          } else {
            currentLine = `${indent}- `;
          }
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          flush();
          break;
        }

        // ── Block: Table ────────────────────────────────────────────────
        case 'table':
          lines.push('');
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          lines.push('');
          break;

        case 'tableRow':
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          flush();
          break;

        case 'tableHeader':
        case 'tableCell':
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          currentLine += ' | ';
          break;

        // ── Block: Code Block ───────────────────────────────────────────
        case 'codeBlock':
          flush();
          lines.push('```' + (node.attrs?.language || ''));
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          flush();
          lines.push('```');
          lines.push('');
          break;

        // ── Block: Blockquote ───────────────────────────────────────────
        case 'blockquote':
          if (node.content) {
            node.content.forEach((c: any) => {
              walk(c, depth);
              if (currentLine.trim()) {
                lines.push('> ' + currentLine.trim());
                currentLine = '';
              }
            });
          }
          break;

        // ── Block: Expand / Details ─────────────────────────────────────
        case 'expand':
        case 'nestedExpand':
          flush();
          lines.push(`[Expand: ${node.attrs?.title || 'Details'}]`);
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          lines.push('');
          break;

        // ── Block: Rule (horizontal line) ───────────────────────────────
        case 'rule':
          flush();
          lines.push('---');
          break;

        // ── Block: Media / Images ───────────────────────────────────────
        case 'media':
          currentLine += `[${node.attrs?.type || 'media'}: ${node.attrs?.url || node.attrs?.id || ''}]`;
          break;

        case 'mediaSingle':
        case 'mediaGroup':
          if (node.content) node.content.forEach((c: any) => walk(c, depth));
          flush();
          break;

        // ── Document root ───────────────────────────────────────────────
        case 'doc':
        default:
          if (node.content && Array.isArray(node.content)) {
            node.content.forEach((c: any) => walk(c, depth));
          }
          break;
      }
    };

    walk(adf);
    flush(); // flush any remaining buffer

    return lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n') // collapse excessive blank lines
      .trim();
  }

  private async _clarificationStore(): Promise<ClarificationStore> {
    const { runId } = await stateManager.getFullState();
    return new ClarificationStore(stateManager.getProjectId(), runId);
  }

  /**
   * Marks ambiguities answered in memory or in the clarification store (exact question match after normalisation — never fuzzy).
   */
  private async _autoResolveClarifications(ambiguities: any[], resolved: any[]) {
    const answers = new Map<string, string>();
    (resolved || []).forEach((r: any) => answers.set(normalizeQuestion(r.question), r.answer));
    (await this._clarificationStore()).listResolvedFor(STAGE_ID)
      .filter((c) => c.owningStage === STAGE_ID && c.answer)
      .forEach((c) => answers.set(normalizeQuestion(c.question), c.answer as string));
    return ambiguities.map((amb) => {
      const answer = answers.get(normalizeQuestion(amb.question));
      return answer ? { ...amb, resolved: true, resolution: answer } : { ...amb, resolved: false };
    });
  }

  /**
   * Raises open ambiguities as clarifications owned by Agent 01 and marks questions asked about other inputs stale.
   */
  private async _requestClarifications(pending: any[], inputFingerprint: string) {
    const store = await this._clarificationStore();
    pending.forEach((amb) => {
      amb.clarificationId = store.raise(clarificationRequestFor(amb, inputFingerprint)).id;
    });
    const stale = store.markStale({ owningStage: STAGE_ID, subjectHash: inputFingerprint });
    if (pending.length > 0 || stale > 0) {
      this._logger.warn(`${pending.length} ambiguities require human input.`, { staleQuestions: stale });
    }
  }

  private _saveReportToDisk(report: any) {
    const outDir = path.resolve(__dirname, '../../reports/json');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'requirement-analysis.json'), JSON.stringify(report, null, 2), 'utf-8');
  }

  private _buildApprovalSummary(report: any) {
    return {
      'Project': report.projectName || 'ARIA',
      'Analysis': report.analysisSource === ANALYSIS_SOURCE.REUSED ? 'Reused (requirements unchanged)' : 'Regenerated',
      'Input Fingerprint': String(report.inputFingerprint || '').slice(0, 12),
      'Features': report.totalFeatures,
      'User Stories': report.totalUserStories,
      'Integration Points': (report.integrationPoints || []).length,
      'Ambiguities': report.ambiguitiesPending
    };
  }

  private _buildAgentResult(report: any, warnings: string[], durationMs: number): AgentResult {
    return {
      agentId: STAGE_ID, stageNumber: '01', stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED as any, output: report, clarifications: [], warnings,
      timestamp: new Date().toISOString(), durationMs,
      approvalStatus: 'PENDING'
    };
  }

  private _loadSkill(): string {
    const skillPath = path.resolve(__dirname, '../../skills/requirement-analysis.md');
    return fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf-8') : 'You are a requirements analyst.';
  }
}

const agent = new RequirementAnalyzerAgent();
export default agent;

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const opts: any = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const [key, val] = arg.slice(2).split('=');
        if (val !== undefined) {
          opts[key] = val;
        } else if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
          opts[key] = args[i + 1];
          i++;
        } else {
          opts[key] = true;
        }
      }
    }

    await stateManager.startNewRun(opts.project || 'default');
    await memoryEngine.initialize(opts.project || 'default');

    const result = await agent.run({
      requirements: opts.requirements || opts.req,
      projectName: opts.project || 'ARIA Test Project',
      format: opts.format || 'text',
      reanalyze: Boolean(opts.reanalyze),
    });

    console.log(`\n✅ Agent 01 complete — Status: ${result.status} | Approval: ${result.approvalStatus}`);
    process.exit(0);
  })().catch(err => {
    console.error('Fatal error in Agent 01 CLI:', err);
    process.exit(1);
  });
}

