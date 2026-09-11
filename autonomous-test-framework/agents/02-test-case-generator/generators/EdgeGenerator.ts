/**
 * @fileoverview Edge case test case generator for Agent 02.
 */

import {
  TC_TYPE, EDGE_TEMPLATES, MIN_TC_BY_RISK, PRIORITY,
} from '../constants';
import { buildTC, inferPrecondition, inferLabels } from '../utils';

/**
 *
 */
export function generateEdgeTCs(counter, feature, story, analysis) {
  const tcs = [];
  const mins = MIN_TC_BY_RISK[feature.riskLevel] || MIN_TC_BY_RISK.MEDIUM;
  if (mins.edge === 0 && feature.riskLevel === 'LOW') return tcs;

  let relevant = EDGE_TEMPLATES.filter((t) => isEdgeTemplateRelevant(t, story, feature));

  // If relevant edge templates are fewer than minimum required, pick top general boundary templates to meet requirement
  if (relevant.length < mins.edge) {
    const fallbackTemplates = EDGE_TEMPLATES.filter((t) => !relevant.includes(t));
    for (const fb of fallbackTemplates) {
      relevant.push(fb);
      if (relevant.length >= mins.edge) break;
    }
  }

  // Cap at mins.edge to avoid over-generating while satisfying exact risk requirement
  if (relevant.length > mins.edge) {
    relevant = relevant.slice(0, mins.edge);
  }

  for (const template of relevant) {
    tcs.push(buildTC(counter, {
      type: TC_TYPE.EDGE,
      feature,
      story,
      name: `[EDGE] ${story.title} — ${template.title}`,
      objective: `Verify system behaviour at boundary: ${template.title}`,
      precondition: inferPrecondition(story, feature),
      priority: feature.riskLevel === 'CRITICAL' ? PRIORITY.HIGH : PRIORITY.MEDIUM,
      labels: inferLabels(story, TC_TYPE.EDGE),
      steps: buildEdgeSteps(story, template),
      acIndex: 0,
      apiDetails: null,
      performanceRef: null,
    }));
  }

  return tcs;
}

/**
 *
 */
function isEdgeTemplateRelevant(template, story, feature) {
  const acs = (story.acceptanceCriteria || []).join(' ');
  const rules = (story.businessRules || []).join(' ');
  const ctx = `${story.goal} ${story.title} ${feature.name} ${acs} ${rules}`.toLowerCase();
  const tagMap = {
    MIN_BOUNDARY: /amount|age|quantity|length|size|count|number|minimum|min|character|credential|password|user/i.test(ctx),
    MAX_BOUNDARY: /amount|age|quantity|length|size|count|number|maximum|max|limit|character|credential|password|user/i.test(ctx),
    ZERO_VALUE: /amount|count|quantity|number|zero/i.test(ctx),
    LONG_STRING: /name|description|comment|text|input|field|password|username|string/i.test(ctx),
    SPECIAL_CHARS: /name|description|input|search|query|password|username|character/i.test(ctx),
    UNICODE: /name|text|description|comment|international|global|unicode/i.test(ctx),
    WHITESPACE: /name|input|field|text|whitespace|space/i.test(ctx),
    CONCURRENT: /submit|create|purchase|order|book|reserve|concurrent/i.test(ctx),
    SESSION_TIMEOUT: /session|auth|login|timeout|expire/i.test(ctx),
  };
  return tagMap[template.tag] !== false;
}

/**
 *
 */
function buildEdgeSteps(story, template) {
  return [
    {
      index: 1, description: `Navigate to: ${story.title}`, testData: '{{validBaseURL}}', expectedResult: 'Feature loads correctly',
    },
    {
      index: 2, description: template.stepDesc, testData: getEdgeTestData(template.tag), expectedResult: getEdgeExpectedResult(template.tag),
    },
    {
      index: 3, description: 'Verify system handles the edge condition gracefully', testData: '', expectedResult: 'System shows appropriate message or accepts valid boundary value without error',
    },
  ];
}

/**
 *
 */
function getEdgeTestData(tag) {
  const map = {
    MIN_BOUNDARY: '{{exactMinimumValue}}',
    MAX_BOUNDARY: '{{exactMaximumValue}}',
    ZERO_VALUE: '0 or empty string',
    LONG_STRING: `${'A'.repeat(1000)} (1000 characters)`,
    SPECIAL_CHARS: '#%&<>!@$^*()',
    UNICODE: '🚀 中文 العربية Ñoño',
    WHITESPACE: '   (spaces only)',
    CONCURRENT: '2 parallel requests from separate sessions',
    SESSION_TIMEOUT: 'Action performed at session near-expiry',
  };
  return map[tag] || '{{edgeCaseData}}';
}

/**
 *
 */
function getEdgeExpectedResult(tag) {
  const map = {
    MIN_BOUNDARY: 'System accepts exact minimum. No error shown.',
    MAX_BOUNDARY: 'System accepts exact maximum. No error shown.',
    ZERO_VALUE: 'System handles zero gracefully. Appropriate validation shown.',
    LONG_STRING: 'System truncates or rejects long input. No crash. No stack overflow.',
    SPECIAL_CHARS: 'Special characters are sanitized or rejected gracefully.',
    UNICODE: 'Unicode input is handled without encoding errors.',
    WHITESPACE: 'Whitespace-only input is treated as empty. Validation error shown.',
    CONCURRENT: 'Only one request succeeds. No data corruption or duplicate records.',
    SESSION_TIMEOUT: 'System prompts for re-authentication. No data loss.',
  };
  return map[tag] || 'System handles edge case gracefully without errors.';
}
