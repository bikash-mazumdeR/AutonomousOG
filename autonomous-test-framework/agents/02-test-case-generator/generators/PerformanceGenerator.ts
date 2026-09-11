/**
 * @fileoverview Performance test case generator for Agent 02.
 */

import { TC_TYPE, PRIORITY } from '../constants';
import { buildTC, inferPrecondition } from '../utils';
import { FRAMEWORK_CONFIG } from '../../../config/framework.config';

/**
 * Checks whether performance testing conditions and endpoints are strictly defined in requirements.
 */
export function hasStrictPerformanceConditions(analysis: any, feature: any, story: any): boolean {
  // Check if target endpoint is strictly defined
  const validEndpoints = (analysis.integrationPoints || []).filter(
    (i: any) => i.endpoint && !['not specified', 'unknown', 'undefined', 'none', 'n/a', '', '{{targetendpoint}}'].includes(String(i.endpoint).trim().toLowerCase())
  );
  if (validEndpoints.length === 0) {
    return false;
  }

  // Check if acceptance criteria or story explicitly define throughput or load conditions (e.g. VUs, RPS, latency)
  const acText = (story.acceptanceCriteria || []).concat(feature.acceptanceCriteria || []).join(' ');
  return /\b(\d+\s*ms|\d+\s*s(econds?)?|\d+\s*(vus?|users?|rps|tps))\b/i.test(acText);
}

/**
 *
 */
export function generatePerformanceTCs(counter, feature, story, analysis) {
  if (!hasStrictPerformanceConditions(analysis, feature, story)) {
    return [];
  }

  const tcs = [];
  const scenarios = ['load', 'stress', 'spike'];
  const activeScenarios = (feature.riskLevel === 'CRITICAL' || feature.riskLevel === 'HIGH')
    ? scenarios
    : ['load'];

  for (const scenario of activeScenarios) {
    const scriptRef = `tests/k6/${feature.id}-${story.id}-${scenario}-test.js`;

    tcs.push(buildTC(counter, {
      type: TC_TYPE.PERFORMANCE,
      feature,
      story,
      name: `[PERF][${scenario.toUpperCase()}] ${story.title} — ${scenario} test`,
      objective: `Verify system performance under ${scenario} conditions for: ${story.goal}`,
      precondition: 'Environment is stable. Monitoring tools are active. No other load tests running.',
      priority: feature.riskLevel === 'CRITICAL' ? PRIORITY.HIGH : PRIORITY.MEDIUM,
      labels: ['Performance', scenario.charAt(0).toUpperCase() + scenario.slice(1)],
      steps: [
        {
          index: 1, description: `Configure K6 ${scenario} test scenario`, testData: `VUs: ${FRAMEWORK_CONFIG.k6.vus}, Duration: ${FRAMEWORK_CONFIG.k6.duration}`, expectedResult: 'K6 script is configured correctly',
        },
        {
          index: 2, description: `Execute K6 script: ${scriptRef}`, testData: `k6 run ${scriptRef}`, expectedResult: 'K6 test executes without script errors',
        },
        {
          index: 3, description: 'Verify p95 response time threshold', testData: `Threshold: ${FRAMEWORK_CONFIG.k6.thresholds.http_req_duration[0]}`, expectedResult: '95th percentile response time is within defined threshold (global K6 config)',
        },
        {
          index: 4, description: 'Verify error rate threshold', testData: `Threshold: ${FRAMEWORK_CONFIG.k6.thresholds.http_req_failed[0]}`, expectedResult: 'HTTP error rate is within acceptable limits',
        },
        {
          index: 5, description: 'Review K6 HTML/JSON output report', testData: '', expectedResult: 'All configured thresholds pass. No unexpected errors.',
        },
      ],
      acIndex: 0,
      apiDetails: null,
      performanceRef: {
        k6ScriptPath: scriptRef,
        scenario,
        vus: FRAMEWORK_CONFIG.k6.vus,
        duration: FRAMEWORK_CONFIG.k6.duration,
        thresholds: 'global',
        targetEndpoint: (analysis.integrationPoints && analysis.integrationPoints[0]?.endpoint) || '{{targetEndpoint}}',
        description: `${scenario} test for ${story.title}`,
      },
    }));
  }

  return tcs;
}
