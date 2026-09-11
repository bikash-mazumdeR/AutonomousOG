/**
 * @fileoverview Positive test case generator for Agent 02.
 */

import { TC_TYPE } from '../constants';
import {
  buildTC, inferPrecondition, riskToPriority,
  inferLabels, inferTestData, acToAction, acToExpectedResult, truncate,
} from '../utils';

/**
 *
 */
export function generatePositiveTCs(counter, feature, story, analysis) {
  const tcs = [];

  story.acceptanceCriteria.forEach((ac, idx) => {
    if (ac.includes('not specified')) return;
    tcs.push(buildTC(counter, {
      type: TC_TYPE.POSITIVE,
      feature,
      story,
      name: `[POS] ${story.title} — ${truncate(ac, 60)}`,
      objective: `Verify that: ${ac}`,
      precondition: inferPrecondition(story, feature),
      priority: riskToPriority(feature.riskLevel),
      labels: inferLabels(story, TC_TYPE.POSITIVE),
      steps: buildPositiveSteps(story, ac, analysis),
      acIndex: idx,
      apiDetails: null,
      performanceRef: null,
    }));
  });

  if (tcs.length === 0) {
    tcs.push(buildTC(counter, {
      type: TC_TYPE.POSITIVE,
      feature,
      story,
      name: `[POS] ${story.title} — Happy Path`,
      objective: `Verify the primary success path for: ${story.goal}`,
      precondition: inferPrecondition(story, feature),
      priority: riskToPriority(feature.riskLevel),
      labels: inferLabels(story, TC_TYPE.POSITIVE),
      steps: buildGenericPositiveSteps(story),
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
function buildPositiveSteps(story, ac, analysis) {
  const steps = [];
  let idx = 1;

  steps.push({
    index: idx++,
    description: `Navigate to the feature: ${story.title}`,
    testData: '{{validBaseURL}}',
    expectedResult: 'Feature is accessible and loaded correctly',
  });

  if (/auth|login|account|user/i.test(story.goal)) {
    steps.push({
      index: idx++,
      description: 'Authenticate with valid credentials',
      testData: '{{validUsername}} / {{validPassword}}',
      expectedResult: 'User is authenticated and redirected to correct page',
    });
  }

  steps.push({
    index: idx++,
    description: `Perform action: ${acToAction(ac)}`,
    testData: inferTestData(ac, story),
    expectedResult: acToExpectedResult(ac),
  });

  steps.push({
    index: idx++,
    description: 'Verify the expected outcome is displayed',
    testData: '',
    expectedResult: `System confirms: ${ac}`,
  });

  if (/save|submit|create|update|delete/i.test(ac)) {
    steps.push({
      index: idx++,
      description: 'Verify data persists after page refresh',
      testData: '',
      expectedResult: 'Changes are retained after page reload',
    });
  }

  return steps;
}

/**
 *
 */
function buildGenericPositiveSteps(story) {
  return [
    {
      index: 1, description: `Navigate to the relevant section for: ${story.title}`, testData: '{{validBaseURL}}', expectedResult: 'Page loads without errors',
    },
    {
      index: 2, description: `Perform the action: ${story.goal}`, testData: '{{validTestData}}', expectedResult: 'Action completes successfully',
    },
    {
      index: 3, description: 'Verify the success state is displayed', testData: '', expectedResult: 'Success message or expected UI state is shown',
    },
  ];
}
