/**
 * ARIA pipeline navigation — shared by every agent page.
 * Renders the stage bar from live stage state and lets the user open any completed stage (and come back), instead of
 * only moving forward. On a stage that is already approved, "Proceed" goes straight to the next agent page rather than
 * asking for approval again.
 */
(function ariaPipelineNav() {
  'use strict';

  const STAGES = [
    { num: 1, id: '01-requirement-analyzer', name: 'Requirement Analyzer', page: '/agent01.html' },
    { num: 2, id: '02-test-case-generator', name: 'Test Case Generator', page: '/agent02.html' },
    { num: 3, id: '03-test-case-reviewer', name: 'Test Case Reviewer', page: '/agent03.html' },
    { num: 4, id: '04-test-data-generator', name: 'Test Data Generator', page: '/agent04.html' },
    { num: 5, id: '05-playwright-script-generator', name: 'Script Generator', page: '/agent05.html' },
    { num: 6, id: '06-automation-reviewer', name: 'Code Reviewer', page: '/agent06.html' },
    { num: 7, id: '07-test-runner', name: 'Test Runner', page: '/agent07.html' },
    { num: 8, id: '08-bug-reporter', name: 'Bug Reporter', page: '/agent08.html' },
    { num: 9, id: '09-report-generator', name: 'Report Generator', page: '/agent09.html' },
    { num: 10, id: '10-auto-healer', name: 'Auto Healer', page: '/agent10.html' },
    { num: 11, id: '11-retest-agent', name: 'Re-Test Agent', page: '/agent11.html' },
  ];
  const DONE_STATUSES = ['COMPLETED', 'AWAITING', 'APPROVED'];
  const APPROVED = 'APPROVED';
  const REFRESH_MS = 5000;
  const STYLE_ID = 'ariaPipelineNavStyles';
  /** The button that approves a stage and moves on (pages name it differently). */
  const PROCEED_SELECTOR = '#proceedBtn, #approveBtn';

  let currentStage = null;
  let stageStates = {};

  const pad = (num) => String(num).padStart(2, '0');
  const stageByNum = (num) => STAGES.find((stage) => stage.num === num);
  const isDone = (state) => !!state && (DONE_STATUSES.includes(state.status) || state.approval === APPROVED);

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      'a.step-node { text-decoration: none; }',
      '.step-node.navigable { cursor: pointer; }',
      '.step-node.navigable:hover { filter: brightness(1.15); box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.45); }',
      '.step-node.current { box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35); }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function renderBar() {
    const bar = document.getElementById('pipelineBar');
    if (!bar) return;
    bar.innerHTML = '';
    STAGES.forEach((stage, idx) => {
      const done = isDone(stageStates[stage.id]);
      const isCurrent = stage.num === currentStage;
      const navigable = Boolean(stage.page) && done && !isCurrent;
      const node = document.createElement(navigable ? 'a' : 'div');
      node.className = ['step-node', isCurrent ? 'active current' : done ? 'done' : '', navigable ? 'navigable' : ''].filter(Boolean).join(' ');
      node.textContent = done && !isCurrent ? '✓' : String(stage.num);
      const label = `Agent ${pad(stage.num)}: ${stage.name}`;
      node.title = isCurrent ? `${label} (this page)` : navigable ? `${label} — completed, click to open` : `${label}${done ? ' (completed)' : ''}`;
      if (navigable) {
        node.href = stage.page;
        node.setAttribute('aria-label', `Open ${label}`);
      }
      bar.appendChild(node);
      if (idx < STAGES.length - 1) {
        const connector = document.createElement('div');
        connector.className = `step-connector${done ? ' done' : ''}`;
        bar.appendChild(connector);
      }
    });
  }

  /** On an approved stage the Proceed button navigates to the next agent page instead of re-approving. */
  function nextPageIfApproved() {
    const stage = stageByNum(currentStage);
    if (!stage || stageStates[stage.id]?.approval !== APPROVED) return null;
    const next = stageByNum(currentStage + 1);
    return { next, page: next?.page || null };
  }

  function updateProceedButton() {
    const button = document.querySelector(PROCEED_SELECTOR);
    if (!button) return;
    if (button.dataset.originalLabel === undefined) button.dataset.originalLabel = button.innerHTML;
    const approved = nextPageIfApproved();
    if (!approved) {
      if (button.dataset.approvedLabel === 'true') {
        button.innerHTML = button.dataset.originalLabel;
        delete button.dataset.approvedLabel;
      }
      return;
    }
    button.dataset.approvedLabel = 'true';
    button.innerHTML = approved.page ? `✅ Approved — Go to Agent ${pad(approved.next.num)} →` : '✅ Approved';
  }

  // Capture phase runs before the page's own approval handler, so an approved stage never opens the approval dialog
  document.addEventListener('click', (event) => {
    const button = event.target.closest && event.target.closest(PROCEED_SELECTOR);
    const approved = button ? nextPageIfApproved() : null;
    if (!approved) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (approved.page) window.location.href = approved.page;
  }, true);

  async function refresh() {
    try {
      const response = await fetch('/api/pipeline/stages');
      if (response.ok) stageStates = (await response.json()).stages || {};
    } catch (_) {
      // Keep the last known state; the bar still renders the current stage
    }
    renderBar();
    updateProceedButton();
  }

  window.AriaPipelineNav = {
    /**
     * Page a stage is served at, so a caller can avoid navigating to a stage that has no UI yet.
     * STAGES is the single source of truth for which pages exist; a stage still carrying
     * `page: null` returns null and the caller should stay put.
     * @param {number} stageNumber - 1-based stage number
     * @returns {string|null} Page path, or null when that stage has no page
     */
    pageForStage(stageNumber) {
      const stage = STAGES.find((s) => s.num === stageNumber);
      return (stage && stage.page) || null;
    },

    /**
     * Renders the pipeline bar for the page's stage and keeps it in sync with the pipeline state.
     * @param {number} stageNumber - 1-based stage of the current page
     */
    start(stageNumber) {
      currentStage = stageNumber;
      injectStyles();
      renderBar();
      refresh();
      setInterval(refresh, REFRESH_MS);
    },
  };
}());
