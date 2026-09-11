/**
 * @fileoverview Negative test case generator for Agent 02.
 */

import { TC_TYPE, NEGATIVE_TEMPLATES } from '../constants';
import {
  buildTC, inferPrecondition, riskToPriority, inferLabels,
} from '../utils';

/**
 *
 */
export function generateNegativeTCs(counter, feature, story, analysis) {
  const tcs = [];
  const relevant = NEGATIVE_TEMPLATES.filter((t) => isNegativeTemplateRelevant(t, story, feature));

  for (const template of relevant) {
    tcs.push(buildTC(counter, {
      type: TC_TYPE.NEGATIVE,
      feature,
      story,
      name: `[NEG] ${story.title} — ${template.title}`,
      objective: `Verify that the system correctly handles: ${template.title}`,
      precondition: inferPrecondition(story, feature),
      priority: riskToPriority(feature.riskLevel),
      labels: inferLabels(story, TC_TYPE.NEGATIVE),
      steps: buildNegativeSteps(story, template),
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
function isNegativeTemplateRelevant(template, story, feature) {
  const ctx = `${story.goal} ${story.title} ${feature.name}`.toLowerCase();
  const relevanceMap = {
    EMPTY_FIELD: /form|input|field|submit|register|login|create|update/i.test(ctx),
    INVALID_FORMAT: /email|phone|date|format|number|url|code/i.test(ctx),
    BOUNDARY_UNDER: /amount|age|quantity|limit|count|number|size/i.test(ctx),
    BOUNDARY_OVER: /amount|age|quantity|limit|count|number|size/i.test(ctx),
    UNAUTHORIZED: true,
    WRONG_ROLE: /role|permission|access|admin|user|manage/i.test(ctx),
    DUPLICATE: /email|username|register|create|add/i.test(ctx),
    SQL_INJECT: /search|login|input|query|filter/i.test(ctx),
    XSS: /comment|input|text|name|field|message/i.test(ctx),
    EXPIRED_TOKEN: /auth|session|login|token/i.test(ctx),
  };
  return relevanceMap[template.tag] !== false;
}

/**
 *
 */
function buildNegativeSteps(story, template) {
  const steps = [
    {
      index: 1, description: `Navigate to: ${story.title}`, testData: '{{validBaseURL}}', expectedResult: 'Feature is accessible',
    },
    {
      index: 2, description: template.stepDesc, testData: getNegativeTestData(template.tag), expectedResult: getNegativeExpectedResult(template.tag),
    },
  ];

  if (['BOUNDARY_UNDER', 'BOUNDARY_OVER', 'SQL_INJECT', 'XSS', 'INVALID_FORMAT'].includes(template.tag)) {
    steps.push({
      index: 3, description: 'Enter valid data for all other mandatory fields (e.g., password)', testData: '{{validMandatoryInputs}}', expectedResult: 'Mandatory fields populated to isolate target field validation',
    });
    steps.push({
      index: 4, description: 'Submit form and verify error handling response', testData: '', expectedResult: getNegativeExpectedResult(template.tag),
    });
  } else {
    steps.push({
      index: 3, description: 'Verify error handling response', testData: '', expectedResult: getNegativeExpectedResult(template.tag),
    });
  }

  return steps;
}

/**
 *
 */
function getNegativeTestData(tag) {
  const map = {
    EMPTY_FIELD: '(leave blank)',
    INVALID_FORMAT: 'invalidemail / 12345abc',
    BOUNDARY_UNDER: '-1 or value < minimum',
    BOUNDARY_OVER: 'value > maximum allowed',
    UNAUTHORIZED: '(no token / invalid token)',
    WRONG_ROLE: '{{lowPrivilegeUserCredentials}}',
    DUPLICATE: '{{existingEmail}} (already registered)',
    SQL_INJECT: "' OR '1'='1'; DROP TABLE users;--",
    XSS: '<script>alert("xss")</script>',
    EXPIRED_TOKEN: '{{expiredJwtToken}}',
  };
  return map[tag] || '{{invalidTestData}}';
}

/**
 *
 */
function getNegativeExpectedResult(tag) {
  const map = {
    EMPTY_FIELD: 'Inline validation error shown. Form not submitted.',
    INVALID_FORMAT: 'Format validation error message displayed.',
    BOUNDARY_UNDER: 'Boundary error shown. Value rejected.',
    BOUNDARY_OVER: 'Boundary error shown. Value rejected.',
    UNAUTHORIZED: 'HTTP 401 returned. Redirect to login page.',
    WRONG_ROLE: 'HTTP 403 returned. Access denied message shown.',
    DUPLICATE: 'Duplicate entry error shown. Record not created.',
    SQL_INJECT: 'Input is sanitized. No SQL error exposed. Input treated as plain text.',
    XSS: 'Script tag is escaped/rejected. No alert executes.',
    EXPIRED_TOKEN: 'Session expiry message shown. Redirect to login.',
  };
  return map[tag] || 'System displays appropriate error message. No crash or data exposure.';
}
