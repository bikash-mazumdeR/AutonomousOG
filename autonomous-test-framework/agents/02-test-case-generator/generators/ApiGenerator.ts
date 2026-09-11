/**
 * @fileoverview API test case generator for Agent 02.
 */

import { TC_TYPE, API_ERROR_CODES, PRIORITY } from '../constants';
import { buildTC, inferHTTPMethod, inferRequestBody } from '../utils';
import { FRAMEWORK_CONFIG } from '../../../config/framework.config';

/**
 * Checks whether an integration point contains strictly defined, non-placeholder API details.
 */
export function hasStrictApiDetails(integration: any): boolean {
  if (!integration || !integration.endpoint) return false;
  const ep = String(integration.endpoint).trim().toLowerCase();
  const invalidPlaceholders = ['not specified', 'unknown', 'undefined', 'none', 'n/a', '', '/api', '/api/endpoint', '{{targetendpoint}}'];
  if (invalidPlaceholders.includes(ep)) {
    return false;
  }
  return ep.startsWith('/') || ep.startsWith('http://') || ep.startsWith('https://');
}

/**
 *
 */
export function generateAPITCs(counter, feature, story, analysis) {
  const tcs = [];
  const relevantInts = (analysis.integrationPoints || []).filter(
    (i) => (i.type === 'REST_API' || i.type === 'GRAPHQL') && hasStrictApiDetails(i),
  );

  if (relevantInts.length === 0) {
    return [];
  }

  for (const integration of relevantInts) {
    // Positive API TC
    tcs.push(buildTC(counter, {
      type: TC_TYPE.API,
      feature,
      story,
      name: `[API][POS] ${story.title} — Valid Request to ${integration.name}`,
      objective: `Verify ${integration.name} returns expected response for valid request`,
      precondition: 'API server is running. Valid auth token available.',
      priority: integration.criticality === 'HIGH' ? PRIORITY.HIGH : PRIORITY.MEDIUM,
      labels: ['API', 'Functional'],
      steps: buildAPIPositiveSteps(story, integration),
      acIndex: 0,
      apiDetails: {
        method: inferHTTPMethod(story.goal),
        endpoint: integration.endpoint,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {{authToken}}' },
        requestBody: inferRequestBody(story),
        expectedStatusCode: 200,
        expectedResponseSchema: {},
        authRequired: true,
        mockDependencies: integration.mockRequired ? [integration.name] : [],
      },
      performanceRef: null,
    }));

    // Negative API TCs
    const errorCodes = selectAPIErrorCodes(story, feature);
    for (const err of errorCodes) {
      tcs.push(buildTC(counter, {
        type: TC_TYPE.API,
        feature,
        story,
        name: `[API][NEG] ${story.title} — ${err.code} ${err.description}`,
        objective: `Verify API returns ${err.code} for: ${err.description}`,
        precondition: 'API server is running.',
        priority: err.code === 401 || err.code === 403 ? PRIORITY.HIGH : PRIORITY.MEDIUM,
        labels: ['API', 'Negative'],
        steps: buildAPIErrorSteps(story, integration, err),
        acIndex: 0,
        apiDetails: {
          method: inferHTTPMethod(story.goal),
          endpoint: integration.endpoint,
          headers: getInvalidHeadersForCode(err.code),
          requestBody: getInvalidBodyForCode(err.code),
          expectedStatusCode: err.code,
          expectedResponseSchema: {},
          authRequired: err.code !== 401,
          mockDependencies: [],
        },
        performanceRef: null,
      }));
    }
  }

  // Generic fallback
  if (tcs.length === 0 && story.testTypes.includes('API')) {
    tcs.push(buildTC(counter, {
      type: TC_TYPE.API,
      feature,
      story,
      name: `[API][POS] ${story.title} — Generic API Happy Path`,
      objective: `Verify API endpoint responds correctly for: ${story.goal}`,
      precondition: 'API server running. Valid credentials available.',
      priority: PRIORITY.MEDIUM,
      labels: ['API', 'Functional'],
      steps: [
        {
          index: 1, description: 'Prepare valid API request payload', testData: '{{validPayload}}', expectedResult: 'Payload is valid JSON',
        },
        {
          index: 2, description: 'Send POST request to endpoint', testData: '{{apiEndpoint}}', expectedResult: 'Request is accepted',
        },
        {
          index: 3, description: 'Verify response status code is 200/201', testData: '', expectedResult: 'HTTP 200 or 201 returned',
        },
        {
          index: 4, description: 'Verify response body schema', testData: '', expectedResult: 'Response matches expected schema',
        },
      ],
      acIndex: 0,
      apiDetails: {
        method: 'POST',
        endpoint: '{{apiEndpoint}}',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {{authToken}}' },
        requestBody: {},
        expectedStatusCode: 200,
        expectedResponseSchema: {},
        authRequired: true,
        mockDependencies: [],
      },
      performanceRef: null,
    }));
  }

  return tcs;
}

/**
 *
 */
function buildAPIPositiveSteps(story, integration) {
  return [
    {
      index: 1, description: 'Obtain valid authentication token', testData: '{{validUsername}} / {{validPassword}}', expectedResult: 'Bearer token received',
    },
    {
      index: 2, description: `Send ${inferHTTPMethod(story.goal)} request to ${integration.endpoint}`, testData: '{{validRequestPayload}}', expectedResult: `HTTP ${inferHTTPMethod(story.goal) === 'GET' ? '200' : '200 or 201'} status returned`,
    },
    {
      index: 3, description: 'Validate response body structure', testData: '', expectedResult: 'Response body matches expected JSON schema',
    },
    {
      index: 4, description: 'Validate response time', testData: `Threshold: <${FRAMEWORK_CONFIG.k6.thresholds.http_req_duration[0]}`, expectedResult: 'Response received within defined SLA threshold',
    },
    {
      index: 5, description: 'Validate Content-Type header in response', testData: '', expectedResult: 'Content-Type: application/json is present',
    },
  ];
}

/**
 *
 */
function buildAPIErrorSteps(story, integration, errorInfo) {
  return [
    {
      index: 1, description: `Prepare invalid/malformed request for: ${errorInfo.description}`, testData: getInvalidPayloadForCode(errorInfo.code), expectedResult: 'Request prepared with invalid conditions',
    },
    {
      index: 2, description: `Send request to ${integration.endpoint}`, testData: '', expectedResult: `HTTP ${errorInfo.code} status returned`,
    },
    {
      index: 3, description: 'Validate error response body', testData: '', expectedResult: 'Response contains error code and descriptive message',
    },
    {
      index: 4, description: 'Verify no sensitive data is exposed in error response', testData: '', expectedResult: 'Stack traces, DB errors, or internal paths are not exposed',
    },
  ];
}

/**
 *
 */
function selectAPIErrorCodes(story, feature) {
  const codes = [
    API_ERROR_CODES.find((c) => c.code === 400),
    API_ERROR_CODES.find((c) => c.code === 401),
  ];
  if (/role|permission|admin/i.test(story.goal)) codes.push(API_ERROR_CODES.find((c) => c.code === 403));
  if (feature.riskLevel === 'CRITICAL' || feature.riskLevel === 'HIGH') {
    codes.push(API_ERROR_CODES.find((c) => c.code === 429));
    codes.push(API_ERROR_CODES.find((c) => c.code === 422));
  }
  return codes.filter(Boolean);
}

/**
 *
 */
function getInvalidHeadersForCode(code) {
  if (code === 401) return { 'Content-Type': 'application/json' };
  if (code === 403) return { 'Content-Type': 'application/json', Authorization: 'Bearer {{lowPrivToken}}' };
  return { 'Content-Type': 'application/json', Authorization: 'Bearer {{authToken}}' };
}

/**
 *
 */
function getInvalidBodyForCode(code) {
  if (code === 400) return '{ invalid json }';
  if (code === 413) return 'X'.repeat(1024 * 1024);
  if (code === 422) return { field: null };
  return {};
}

/**
 *
 */
function getInvalidPayloadForCode(code) {
  const map = {
    400: 'Malformed JSON payload', 401: 'Missing or invalid Authorization header', 403: 'Valid token with insufficient permissions', 404: 'Non-existent resource ID', 409: 'Duplicate unique field value', 413: '1MB+ payload exceeding size limit', 422: 'Payload with null required fields', 429: '100+ requests in rapid succession',
  };
  return map[code] || '{{invalidPayload}}';
}
