'use strict';

require('ts-node').register({ transpileOnly: true });
import express from 'express';
import fileUpload from 'express-fileupload';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { stateManager } from '../core/state-manager/StateManager';
import { FRAMEWORK_CONFIG, PIPELINE_STAGES } from '../config/framework.config';

const app = express();
const PORT = process.env.ARIA_DASHBOARD_PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});
app.use(fileUpload({
    createParentPath: true,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
}));

app.post('/api/analyze-jira-story', async (req, res) => {
    try {
        const { jiraUrl } = req.body;
        if (!jiraUrl) {
            return res.status(400).json({ error: 'Jira URL is required.' });
        }

        // Extract issue key (e.g., SD-123) from URL or accept direct key
        const keyMatch = jiraUrl.match(/([A-Z][A-Z0-9]+-[0-9]+)/i);
        const issueKey = keyMatch ? keyMatch[1].toUpperCase() : jiraUrl.trim().toUpperCase();

        if (!issueKey.includes('-')) {
            return res.status(400).json({ error: 'Invalid Jira Story URL or Key format.' });
        }

        console.log(`🚀 Triggering orchestrator for Jira Story: ${issueKey}`);
        
        const logFile = path.join(process.cwd(), '.logs', `orchestrator_jira_${issueKey}_${Date.now()}.log`);
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });

        const child = spawn('node', ['-r', 'ts-node/register', 'orchestrator.ts', `--requirements="${issueKey}"`, '--format=jira', '--new-run'], {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
            windowsHide: false 
        });

        child.stdout?.pipe(logStream);
        child.stderr?.pipe(logStream);
        child.unref();

        res.json({ message: `Jira Story ${issueKey} analysis started!`, key: issueKey, debugLog: logFile });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/upload-requirements', async (req, res) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ error: 'No files were uploaded.' });
        }

        const reqFile = req.files.requirementFile as fileUpload.UploadedFile;
        const ext = path.extname(reqFile.name).toLowerCase();
        
        if (!['.pdf', '.doc', '.docx', '.md', '.xlsx', '.xls'].includes(ext)) {
            return res.status(400).json({ error: 'Unsupported file type. Supported: .pdf, .doc, .md, .xlsx' });
        }

        const uploadPath = path.join(process.cwd(), 'requirements', reqFile.name);
        await reqFile.mv(uploadPath);

        // Trigger Orchestrator in background
        console.log(`🚀 Triggering orchestrator for: ${uploadPath}`);
        
        const logFile = path.join(process.cwd(), '.logs', `orchestrator_debug_${Date.now()}.log`);
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });

        const child = spawn('node', ['-r', 'ts-node/register', 'orchestrator.ts', `--requirements="${uploadPath}"`, '--new-run'], {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
            windowsHide: false 
        });

        child.stdout?.pipe(logStream);
        child.stderr?.pipe(logStream);

        child.unref();

        child.on('error', (err) => {
            console.error('❌ Failed to start orchestrator:', err);
            fs.appendFileSync(logFile, `SPAWN_ERROR: ${err.message}\n`);
        });

        res.json({ message: 'File uploaded successfully! Analysis started.', path: uploadPath, debugLog: logFile });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/reset', async (req, res) => {
  try {
    const freshState = await stateManager.resetForNewRun(FRAMEWORK_CONFIG.projectId);
    res.json({ message: 'Pipeline state reset successfully. Fresh run initialized.', runId: freshState.runId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/state', async (req, res) => {
  try {
    await stateManager.initialize(FRAMEWORK_CONFIG.projectId);
    const state = await stateManager.getFullState();
    res.json(state);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/breadcrumbs', async (req, res) => {
  try {
    await stateManager.initialize(FRAMEWORK_CONFIG.projectId);
    const logs = await stateManager.getBreadcrumbs();
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ARIA Framework Dashboard</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; }
        h1 { color: #38bdf8; display: flex; align-items: center; gap: 10px; }
        .meta { color: #94a3b8; font-size: 0.9em; margin-bottom: 20px; }
        .stage-list { display: grid; gap: 10px; }
        .stage-card { background: #1e293b; border-radius: 8px; padding: 15px; display: flex; align-items: center; border: 1px solid #334155; }
        .stage-icon { width: 30px; font-size: 1.2em; }
        .stage-info { flex-grow: 1; }
        .stage-name { font-weight: bold; }
        .stage-status { font-size: 0.8em; color: #94a3b8; margin-top: 4px; }
        .progress-container { width: 200px; height: 10px; background: #334155; border-radius: 5px; margin: 0 20px; overflow: hidden; }
        .progress-bar { height: 100%; transition: width 0.5s; }
        .status-tag { padding: 4px 8px; border-radius: 4px; font-size: 0.75em; font-weight: bold; text-transform: uppercase; min-width: 80px; text-align: center; }
        
        .PENDING { background: #475569; color: #cbd5e1; }
        .RUNNING { background: #854d0e; color: #fef08a; }
        .COMPLETED { background: #166534; color: #bbf7d0; }
        .APPROVED { background: #166534; color: #bbf7d0; }
        .REJECTED { background: #991b1b; color: #fecaca; }
        .FAILED { background: #991b1b; color: #fecaca; }
        
        .progress-COMPLETED, .progress-APPROVED { background: #22c55e; width: 100%; }
        .progress-RUNNING { background: #eab308; width: 50%; animation: pulse 1.5s infinite; }
        .progress-PENDING { width: 0%; }
        
        @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
        .error-log { margin-top: 40px; background: #450a0a; border: 1px solid #991b1b; padding: 15px; border-radius: 8px; }
        .error-title { color: #fecaca; font-weight: bold; margin-bottom: 10px; }

        /* Breadcrumb Trace Styling */
        .trace-log { margin-top: 20px; background: #111827; border: 1px solid #334155; padding: 15px; border-radius: 8px; max-height: 400px; overflow-y: auto; }
        .trace-title { color: #38bdf8; font-weight: bold; margin-bottom: 10px; display: flex; justify-content: space-between; }
        .trace-item { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.8em; padding: 4px 0; border-bottom: 1px solid #1e293b; display: flex; gap: 10px; }
        .trace-ts { color: #64748b; min-width: 170px; }
        .trace-stage { color: #eab308; min-width: 140px; font-weight: bold; }
        .trace-msg { color: #cbd5e1; flex-grow: 1; }
        .trace-msg.click { color: #f472b6; }
        .trace-msg.assert { color: #34d399; }
        .trace-msg.navigate { color: #60a5fa; }
        .trace-msg.error { color: #f87171; }

        /* Diff Styling */
        .diff-container { margin-top: 20px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; overflow: hidden; }
        .diff-header { background: #334155; padding: 10px 15px; font-weight: bold; display: flex; justify-content: space-between; }
        .diff-body { padding: 0; font-family: monospace; font-size: 0.85em; white-space: pre; overflow-x: auto; }
        .diff-line { display: flex; }
        .diff-num { width: 40px; text-align: right; padding-right: 10px; color: #64748b; background: #0f172a; user-select: none; }
        .diff-content { padding-left: 10px; flex-grow: 1; }
        .diff-added { background: #064e3b; color: #6ee7b7; }
        .diff-removed { background: #7f1d1d; color: #fca5a5; }
        .btn-view { background: #38bdf8; color: #0f172a; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-weight: bold; margin-left: 10px; }
        .modal { display: none; position: fixed; z-index: 100; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); }
        .modal-content { background: #0f172a; margin: 5% auto; padding: 20px; border: 1px solid #334155; width: 90%; max-height: 80%; border-radius: 12px; overflow-y: auto; }
        .close { color: #94a3b8; float: right; font-size: 28px; font-weight: bold; cursor: pointer; }

        /* Upload Section Styling */
        .upload-section { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 15px; margin-bottom: 20px; display: flex; align-items: center; gap: 15px; }
        .upload-title { font-weight: bold; color: #38bdf8; min-width: 150px; }
        .file-input { flex-grow: 1; color: #94a3b8; }
        .btn-upload { background: #38bdf8; color: #0f172a; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; transition: opacity 0.2s; }
        .btn-upload:disabled { opacity: 0.5; cursor: not-allowed; }
        .upload-status { font-size: 0.85em; margin-top: 5px; }

        /* Usage Metrics Styling */
        .usage-metrics { display: flex; gap: 15px; margin-top: 5px; font-size: 0.75em; color: #94a3b8; }
        .usage-item { display: flex; align-items: center; gap: 4px; }
        .usage-icon { font-size: 0.9em; opacity: 0.8; }
        .cost-value { color: #34d399; font-weight: bold; }
        .total-usage-box { background: #1e293b; border: 1px solid #334155; padding: 10px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 30px; align-items: center; }
        .total-usage-label { font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        .total-usage-value { font-size: 1.2em; font-weight: bold; color: #38bdf8; }
    </style>
</head>
<body>
    <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h1 style="margin: 0;">🤖 ARIA Dashboard</h1>
            <button class="btn-upload" style="background:#ef4444; color:#ffffff;" onclick="resetPipeline()">Reset / New Run</button>
        </div>
        <div id="meta" class="meta">Loading pipeline state...</div>

        <div class="upload-section">
            <div class="upload-title">📄 Requirements File</div>
            <input type="file" id="reqFile" class="file-input" accept=".pdf,.doc,.docx,.md,.xlsx,.xls">
            <button id="uploadBtn" class="btn-upload" onclick="uploadFile()">Upload & Analyze</button>
        </div>
        
        <div class="upload-section">
            <div class="upload-title">🔗 Jira Story URL</div>
            <input type="text" id="jiraUrl" class="file-input" placeholder="https://your-domain.atlassian.net/browse/SD-123" style="background:#0f172a; border:1px solid #334155; padding:8px; border-radius:4px; color:#f8fafc;">
            <button id="jiraBtn" class="btn-upload" onclick="analyzeJiraStory()">Analyze Jira Story</button>
        </div>

        <div id="uploadMsg" class="upload-status" style="display:none"></div>
        
        <div id="stages" class="stage-list"></div>

        <div id="trace" class="trace-log">
            <div class="trace-title">Activity Trace (Flight Recorder)</div>
            <div id="trace-list"></div>
        </div>
        
        <div id="errors" class="error-log" style="display:none">
            <div class="error-title">Latest Errors</div>
            <div id="error-list"></div>
        </div>
    </div>

    <div id="diffModal" class="modal">
        <div class="modal-content">
            <span class="close" onclick="document.getElementById('diffModal').style.display='none'">&times;</span>
            <h2 id="diffTitle">Healing Diffs</h2>
            <div id="diffContent"></div>
        </div>
    </div>

    <script>
        const STAGES = ${JSON.stringify(PIPELINE_STAGES)};
        let lastState = null;
        let lastLogId = 0;
        
        async function resetPipeline() {
            if (!confirm('Are you sure you want to reset the pipeline state for a fresh run?')) return;
            try {
                const res = await fetch('/api/reset', { method: 'POST' });
                const data = await res.json();
                if (res.ok) {
                    alert('✅ ' + (data.message || 'Pipeline state reset successfully.'));
                    await update();
                } else {
                    alert('❌ Reset failed: ' + data.error);
                }
            } catch (err) {
                alert('❌ Connection failed: ' + err.message);
            }
        }

        async function update() {
            try {
                const res = await fetch('/api/state?t=' + Date.now());
                const state = await res.json();
                lastState = state;
                
                document.getElementById('meta').innerHTML = \`Project: <b>\${state.projectId}</b> | Run ID: <b>\${state.runId}</b> | Status: <b>\${state.globalStatus}</b>\`;
                
                const stagesHtml = STAGES.map((s, i) => {
                    const stageState = state.stages[s.id] || { status: 'PENDING' };
                    let actionBtn = '';
                    if (s.id === '10-auto-healer' && stageState.status === 'COMPLETED' && stageState.output?.healingPatches?.length > 0) {
                        actionBtn = \`<button class="btn-view" onclick="showHeals()">View Diffs</button>\`;
                    }
                    
                    let usageHtml = '';
                    if (stageState.usage) {
                        usageHtml = \`
                            <div class="usage-metrics">
                                <div class="usage-item" title="Tokens (Prompt / Completion)"><span class="usage-icon">🪙</span> \${stageState.usage.promptTokens} / \${stageState.usage.completionTokens}</div>
                                <div class="usage-item"><span class="usage-icon">💵</span> <span class="cost-value">₹\${(stageState.usage.estimatedCostINR ?? stageState.usage.estimatedCost).toFixed(2)}</span></div>
                            </div>
                        \`;
                    }

                    return \`
                        <div class="stage-card">
                            <div class="stage-icon">\${i+1}</div>
                            <div class="stage-info">
                                <div class="stage-name">\${s.name} \${actionBtn}</div>
                                <div class="stage-status">\${s.description}</div>
                                \${usageHtml}
                            </div>
                            <div class="progress-container">
                                <div class="progress-bar progress-\${stageState.status}"></div>
                            </div>
                            <div class="status-tag \${stageState.status}">\${stageState.status}</div>
                        </div>
                    \`;
                }).join('');
                
                document.getElementById('stages').innerHTML = stagesHtml;
                
                const errorBox = document.getElementById('errors');
                if (state.errors && state.errors.length > 0) {
                    errorBox.style.display = 'block';
                    document.getElementById('error-list').innerHTML = state.errors.slice(-5).map(e => \`<div>[\${e.timestamp}] \${e.message}</div>\`).join('');
                } else {
                    errorBox.style.display = 'none';
                    document.getElementById('error-list').innerHTML = '';
                }

                // Fetch Breadcrumbs
                const logRes = await fetch('/api/breadcrumbs?t=' + Date.now());
                const logs = await logRes.json();
                const traceList = document.getElementById('trace-list');
                
                if (logs && logs.length > 0) {
                    const html = logs.map(l => {
                        let cls = '';
                        if (l.message.includes('[CLICK]')) cls = 'click';
                        if (l.message.includes('[ASSERT]')) cls = 'assert';
                        if (l.message.includes('[NAVIGATE]')) cls = 'navigate';
                        if (l.message.includes('_ERROR') || l.message.includes('_CRASH')) cls = 'error';
                        
                        return \`
                            <div class="trace-item">
                                <div class="trace-ts">\${l.timestamp.split('T')[1].split('.')[0]}</div>
                                <div class="trace-stage">\${l.stage_id}</div>
                                <div class="trace-msg \${cls}">\${escapeHtml(l.message)}</div>
                            </div>
                        \`;
                    }).join('');
                    traceList.innerHTML = html;
                } else {
                    traceList.innerHTML = '<div style="color:#64748b; font-size:0.8em; padding:8px 0; font-family:sans-serif;">No activity logged yet for this run.</div>';
                }
            } catch (err) {
                console.error('Update failed:', err);
            }
        }

        function showHeals() {
            const healer = lastState.stages['10-auto-healer'];
            if (!healer || !healer.output?.healingPatches) return;
            
            const html = healer.output.healingPatches.map(patch => {
                if (!patch.diff) return '';
                return \`
                    <div class="diff-container">
                        <div class="diff-header">
                            <span>\${patch.tcKey} → \${patch.strategyUsed}</span>
                            <span style="font-size:0.8em; color:#94a3b8">\${patch.context}</span>
                        </div>
                        <div class="diff-body">\${renderDiff(patch.diff.before, patch.diff.after)}</div>
                    </div>
                \`;
            }).join('');
            
            document.getElementById('diffContent').innerHTML = html;
            document.getElementById('diffModal').style.display = 'block';
        }

        function renderDiff(before, after) {
            const beforeLines = (before || '').split('\\n');
            const afterLines = (after || '').split('\\n');
            let html = '';
            
            // Simple diff logic - find changed blocks
            let i = 0, j = 0;
            while (i < beforeLines.length || j < afterLines.length) {
                if (beforeLines[i] === afterLines[j]) {
                    html += \`<div class="diff-line"><div class="diff-num">\${i+1}</div><div class="diff-content">\${escapeHtml(beforeLines[i])}</div></div>\`;
                    i++; j++;
                } else {
                    // Look ahead for match to show removal/addition
                    let nextMatch = -1;
                    for (let k = i + 1; k < beforeLines.length; k++) {
                        if (beforeLines[k] === afterLines[j]) { nextMatch = k; break; }
                    }
                    
                    if (nextMatch !== -1) {
                        while (i < nextMatch) {
                            html += \`<div class="diff-line diff-removed"><div class="diff-num">\${i+1}</div><div class="diff-content">- \${escapeHtml(beforeLines[i])}</div></div>\`;
                            i++;
                        }
                    } else {
                        html += \`<div class="diff-line diff-added"><div class="diff-num">\${j+1}</div><div class="diff-content">+ \${escapeHtml(afterLines[j])}</div></div>\`;
                        j++;
                    }
                }
                if (i > 1000 || j > 1000) break; // Safety
            }
            return html;
        }

        function escapeHtml(text) {
            if (!text) return '';
            return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }

        async function uploadFile() {
            const fileInput = document.getElementById('reqFile');
            const uploadBtn = document.getElementById('uploadBtn');
            const msg = document.getElementById('uploadMsg');
            
            if (!fileInput.files || fileInput.files.length === 0) {
                alert('Please select a file first.');
                return;
            }

            const formData = new FormData();
            formData.append('requirementFile', fileInput.files[0]);

            try {
                uploadBtn.disabled = true;
                uploadBtn.innerText = 'Uploading...';
                msg.style.display = 'block';
                msg.style.color = '#38bdf8';
                msg.innerText = 'Uploading file to ARIA...';

                const response = await fetch('/api/upload-requirements', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                
                if (response.ok) {
                    msg.style.color = '#34d399';
                    msg.innerText = '✅ ' + result.message;
                    setTimeout(() => { msg.style.display = 'none'; }, 5000);
                } else {
                    msg.style.color = '#f87171';
                    msg.innerText = '❌ Error: ' + result.error;
                }
            } catch (err) {
                msg.style.color = '#f87171';
                msg.innerText = '❌ Connection failed: ' + err.message;
            } finally {
                uploadBtn.disabled = false;
                uploadBtn.innerText = 'Upload & Analyze';
                fileInput.value = '';
            }
        }
        
        async function analyzeJiraStory() {
            const jiraUrlInput = document.getElementById('jiraUrl');
            const jiraBtn = document.getElementById('jiraBtn');
            const msg = document.getElementById('uploadMsg');
            const jiraUrl = jiraUrlInput.value.trim();

            if (!jiraUrl) {
                alert('Please enter a Jira Story URL or Key.');
                return;
            }

            try {
                jiraBtn.disabled = true;
                jiraBtn.innerText = 'Analyzing...';
                msg.style.display = 'block';
                msg.style.color = '#38bdf8';
                msg.innerText = 'Fetching and analyzing Jira Story...';

                const response = await fetch('/api/analyze-jira-story', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jiraUrl })
                });

                const result = await response.json();

                if (response.ok) {
                    msg.style.color = '#34d399';
                    msg.innerText = '✅ ' + result.message;
                    setTimeout(() => { msg.style.display = 'none'; }, 5000);
                } else {
                    msg.style.color = '#f87171';
                    msg.innerText = '❌ Error: ' + result.error;
                }
            } catch (err) {
                msg.style.color = '#f87171';
                msg.innerText = '❌ Connection failed: ' + err.message;
            } finally {
                jiraBtn.disabled = false;
                jiraBtn.innerText = 'Analyze Jira Story';
                jiraUrlInput.value = '';
            }
        }
        
        update();
        setInterval(update, 2000);
    </script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`\n🚀 ARIA Web Dashboard active: http://localhost:${PORT}`);
});

