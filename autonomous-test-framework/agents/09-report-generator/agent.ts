/**
 * @fileoverview Agent 09 — Test Execution Report Generator & Publisher.
 * Generates HTML + JSON reports and publishes via Gmail SMTP.
 * @module ReportGeneratorAgent
 * @version 1.0.0
 */

import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { gmailClient } from '../../notifications/gmail/GmailClient';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG, GMAIL_CONFIG } from '../../config/framework.config';
import { LATEST_PROJECT_SQL } from '../../core/state-manager/projectResolver';

const STAGE_ID = '09-report-generator';
const STAGE_NAME = 'Report Generator & Publisher';
const NEXT_STAGE = '10-auto-healer';

const REPORTS_DIR = path.resolve(__dirname, '../../reports');
const HTML_DIR = path.join(REPORTS_DIR, 'html');
const JSON_DIR = path.join(REPORTS_DIR, 'json');

class ReportGeneratorAgent {
  constructor() { this._logger = new Logger(STAGE_ID); }

  async run(input) {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);
    if (!input.executionResults) throw new Error('executionResults not found.');

    try {
      await stateManager.markStageRunning(STAGE_ID);
      [HTML_DIR, JSON_DIR].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

      const results = input.executionResults;
      const bugReports = input.bugReports || {};
      const memory = await memoryEngine.getFullMemory();

      const jsonReport = this._buildJSONReport(results, bugReports, memory);
      const htmlPath = this._buildHTMLReport(jsonReport);
      this._saveJSON(jsonReport);

      const output = {
        reportId: `exec_report_${Date.now()}`,
        generatedAt: new Date().toISOString(),
        jsonReport,
        htmlReportPath: htmlPath,
        emailSent: false, // Initially false, updated after approval
        summary: results.summary,
      };

      await stateManager.setPipelineArtifact('publishedReports', output);
      await stateManager.markStageCompleted(STAGE_ID, output);

      const durationMs = Date.now() - startMs;
      const agentResult = this._buildAgentResult(output, [], durationMs);

      const gateResult = await approvalGate.waitForApproval({
        stageId: STAGE_ID,
        stageName: STAGE_NAME,
        nextStageName: NEXT_STAGE,
        summary: {
          'HTML Report Path': htmlPath,
          'Pass Rate': `${results.summary?.passRate || 0}%`,
          'Total Tests': results.summary?.total || 0,
          'Failed Tests': results.summary?.failed || 0,
          'Bugs Reported': bugReports.bugsCreated || 0,
          'Trend vs Last Run': this._trendLabel(jsonReport),
          'Action Needed': 'Approve to send email report to stakeholders.',
        },
        fullOutput: output,
        warnings: [],
      });

      agentResult.approvalStatus = gateResult.status;
      agentResult.approvalComment = gateResult.comment;

      // Send email ONLY if approved
      if (gateResult.status === STAGE_STATUS.COMPLETED || gateResult.status === 'APPROVED') {
        this._logger.info('Approval received. Publishing report via email...');
        const emailSent = await this._publishViaEmail(jsonReport, htmlPath);
        agentResult.output.emailSent = emailSent;
        agentResult.memoryUpdate.reportPublished = emailSent;

        // Update the artifact with emailSent status
        output.emailSent = emailSent;
        await stateManager.setPipelineArtifact('publishedReports', output);
      } else {
        this._logger.warn('Report not approved (or rejected). Skipping email publication.');
      }

      return agentResult;
    } catch (error) {
      this._logger.error('Agent 09 failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  _buildJSONReport(results, bugReports, memory) {
    const lastCycle = memory.cycles?.[0];
    const s = results.summary || {};
    return {
      reportId: `exec_report_${Date.now()}`,
      project: FRAMEWORK_CONFIG.projectId,
      environment: FRAMEWORK_CONFIG.environment,
      generatedAt: new Date().toISOString(),
      summary: s,
      failedTests: results.failedTests || [],
      flakyTests: results.flakyTests || [],
      k6Results: results.k6Results || [],
      bugsSummary: {
        total: bugReports.bugsCreated || 0,
        skipped: bugReports.duplicatesSkipped || 0,
        critical: (bugReports.bugReports || []).filter((b) => b.severity === 'Critical').length,
        high: (bugReports.bugReports || []).filter((b) => b.severity === 'High').length,
      },
      trend: {
        previousPassRate: lastCycle?.passRate || null,
        currentPassRate: s.passRate || 0,
        delta: lastCycle ? (s.passRate || 0) - lastCycle.passRate : null,
      },
      frameworkMetrics: memory.metrics || {},
    };
  }

  _buildHTMLReport(report) {
    const s = report.summary || {};
    const passRate = s.passRate || 0;
    const statusColor = passRate >= 95 ? '#059669' : passRate >= 80 ? '#D97706' : '#DC2626';
    const trendIcon = report.trend?.delta >= 0 ? '↗' : '↘';
    const trendColor = report.trend?.delta >= 0 ? '#059669' : '#DC2626';

    const failedRows = (report.failedTests || []).map((t) => `
      <tr class="hover:bg-gray-50 transition-colors">
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${t.tcKey || 'N/A'}</td>
        <td class="px-6 py-4 text-sm text-gray-500">${(t.title || '').slice(0, 80)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">FAILED</span></td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono text-xs">${(t.error?.message || 'Unknown error').slice(0, 120)}...</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Executive Test Summary | ARIA Framework</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #F9FAFB; }
    .glass-effect { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(8px); }
    .status-bar-bg { background-color: #E5E7EB; }
    .status-bar-fill { background-color: ${statusColor}; width: ${passRate}%; }
  </style>
</head>
<body class="text-gray-900 antialiased">
  <!-- Header -->
  <header class="bg-white border-b border-gray-200 sticky top-0 z-50 glass-effect">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
      <div class="flex items-center space-x-3">
        <div class="bg-indigo-600 p-2 rounded-lg">
          <svg class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 class="text-xl font-bold tracking-tight text-gray-900">ARIA <span class="text-indigo-600 font-medium">Autonomous Quality Insights</span></h1>
      </div>
      <div class="text-right">
        <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">Generation Date</p>
        <p class="text-sm font-medium text-gray-600">${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
    <!-- Executive Overview Section -->
    <div class="mb-10">
      <h2 class="text-2xl font-bold text-gray-900 mb-2">Executive Summary</h2>
      <p class="text-gray-500 max-w-2xl">This report provides a high-level overview of the recent autonomous test execution cycle for the <span class="font-semibold text-gray-700">${FRAMEWORK_CONFIG.environment.toUpperCase()}</span> environment.</p>
    </div>

    <!-- KPI Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
      <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
        <p class="text-sm font-medium text-gray-400 uppercase tracking-wider mb-1">Pass Rate</p>
        <div class="flex items-baseline justify-between">
          <h3 class="text-3xl font-bold" style="color: ${statusColor}">${passRate}%</h3>
          <span class="text-xs font-semibold px-2 py-1 rounded-md bg-gray-50" style="color: ${trendColor}">
            ${trendIcon} ${report.trend?.delta || 0}%
          </span>
        </div>
        <div class="mt-4 h-2 w-full status-bar-bg rounded-full overflow-hidden">
          <div class="h-full status-bar-fill rounded-full"></div>
        </div>
      </div>

      <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
        <p class="text-sm font-medium text-gray-400 uppercase tracking-wider mb-1">Total Assets</p>
        <h3 class="text-3xl font-bold text-gray-900">${s.total || 0} <span class="text-lg font-normal text-gray-400 ml-1">Test Scenarios</span></h3>
        <p class="text-xs text-gray-400 mt-2">${s.passed || 0} Passed | ${s.failed || 0} Failed</p>
      </div>

      <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
        <p class="text-sm font-medium text-gray-400 uppercase tracking-wider mb-1">Bugs Identified</p>
        <h3 class="text-3xl font-bold text-gray-900">${report.bugsSummary?.total || 0}</h3>
        <div class="flex space-x-2 mt-2">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-600">CRITICAL: ${report.bugsSummary?.critical || 0}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-50 text-orange-600">HIGH: ${report.bugsSummary?.high || 0}</span>
        </div>
      </div>

      <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
        <p class="text-sm font-medium text-gray-400 uppercase tracking-wider mb-1">Autonomous Savings</p>
        <h3 class="text-3xl font-bold text-indigo-600">${Math.round((s.durationMs || 0) / 60000 * 3)}m</h3>
        <p class="text-xs text-gray-400 mt-2">Manual Execution Equivalency</p>
      </div>
    </div>

    <!-- Environment Context -->
    <div class="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 mb-10 flex flex-wrap gap-8 items-center">
      <div>
        <p class="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Testing Environment</p>
        <p class="text-sm font-semibold text-indigo-900">${FRAMEWORK_CONFIG.environment.toUpperCase()}</p>
      </div>
      <div>
        <p class="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Endpoint Under Test</p>
        <p class="text-sm font-semibold text-indigo-900 font-mono">${FRAMEWORK_CONFIG.playwright?.baseURL || 'N/A'}</p>
      </div>
      <div>
        <p class="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Engine Version</p>
        <p class="text-sm font-semibold text-indigo-900">ARIA v1.0.0 (Proprietary AI)</p>
      </div>
    </div>

    <!-- Detailed Insights -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- Left Column: Failures & Details -->
      <div class="lg:col-span-2">
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <h3 class="font-bold text-gray-900">Failure Analysis</h3>
            <span class="px-2.5 py-0.5 rounded-full text-xs font-medium ${report.failedTests?.length > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}">
              ${report.failedTests?.length || 0} Issues Detected
            </span>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Key</th>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Scenario</th>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Primary Error</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-100">
                ${failedRows || '<tr><td colspan="4" class="px-6 py-10 text-center text-sm text-gray-400 italic">No failures detected in this cycle. Baseline stability maintained.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Right Column: Historical Context -->
      <div class="space-y-8">
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 class="font-bold text-gray-900 mb-6">Framework Reliability</h3>
          <div class="space-y-4">
            <div class="flex justify-between items-center">
              <p class="text-sm text-gray-500">Auto-Healed Selectors</p>
              <p class="text-sm font-bold text-green-600">${report.frameworkMetrics?.totalAutoHeals || 0}</p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-sm text-gray-500">Average Stability</p>
              <p class="text-sm font-bold text-gray-900">${report.frameworkMetrics?.avgPassRate || 0}%</p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-sm text-gray-500">Historical Bug Yield</p>
              <p class="text-sm font-bold text-gray-900">${report.frameworkMetrics?.totalBugsFound || 0}</p>
            </div>
          </div>
        </div>

        <div class="bg-indigo-900 rounded-2xl shadow-xl p-6 text-white relative overflow-hidden">
          <div class="relative z-10">
            <h3 class="font-bold text-lg mb-2">Next Steps</h3>
            <p class="text-indigo-200 text-sm mb-4 leading-relaxed">Agent 10 (Auto-Healer) is currently analyzing failures to propose automated patches.</p>
            <button class="w-full bg-white text-indigo-900 font-bold py-2 px-4 rounded-lg text-sm transition-transform active:scale-95">
              Review Detailed Logs
            </button>
          </div>
          <!-- Abstract SVG background for flair -->
          <svg class="absolute -right-10 -bottom-10 h-40 w-40 text-indigo-800 opacity-50" fill="currentColor" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" />
          </svg>
        </div>
      </div>
    </div>
  </main>

  <footer class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 border-t border-gray-100">
    <div class="flex flex-col md:flex-row justify-between items-center text-gray-400 text-xs gap-4">
      <p>© 2026 ARIA Autonomous Systems. Confidental Stakeholder Report.</p>
      <div class="flex space-x-6">
        <a href="#" class="hover:text-indigo-500 transition-colors">Documentation</a>
        <a href="#" class="hover:text-indigo-500 transition-colors">Privacy Policy</a>
        <a href="#" class="hover:text-indigo-500 transition-colors">System Status</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

    const outPath = path.join(HTML_DIR, `report-${Date.now()}.html`);
    fs.writeFileSync(outPath, html, 'utf-8');
    fs.writeFileSync(path.join(HTML_DIR, 'latest.html'), html, 'utf-8');
    this._logger.info('HTML report generated', { path: outPath });
    return outPath;
  }

  async _publishViaEmail(report, htmlPath) {
    const s = report.summary || {};
    const result = await gmailClient.send({
      to: GMAIL_CONFIG.to,
      subject: `[ARIA][${(FRAMEWORK_CONFIG.environment || '').toUpperCase()}] Test Report — ${s.passRate || 0}% Pass | ${s.failed || 0} Failed`,
      html: fs.readFileSync(htmlPath, 'utf-8'),
      attachments: [{ filename: 'execution-report.html', path: htmlPath }],
    });
    if (result.success) {
      this._logger.info('Report email sent', { to: GMAIL_CONFIG.to });
    } else {
      this._logger.error('Email send failed', { error: result.error });
    }
    return result.success;
  }

  _saveJSON(report) {
    const outPath = path.join(JSON_DIR, `exec-report-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  }

  _trendLabel(report) {
    if (report.trend?.delta == null) return 'N/A';
    const d = report.trend.delta;
    return `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}% vs previous run`;
  }

  _buildAgentResult(output, warnings, durationMs) {
    return {
      agentId: STAGE_ID,
      stageNumber: '09',
      stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED,
      output,
      clarifications: [],
      warnings,
      memoryUpdate: { reportPublished: output.emailSent },
      timestamp: new Date().toISOString(),
      durationMs,
      approvalStatus: 'PENDING',
      approvalComment: '',
    };
  }
}

export { ReportGeneratorAgent };

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
    const agent = new ReportGeneratorAgent();
    let executionResults = await stateManager.getPipelineArtifact('executionResults');
    const bugReports = await stateManager.getPipelineArtifact('bugReports');
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
    await agent.run({ executionResults, bugReports });
    process.exit(0);
  })();
}
