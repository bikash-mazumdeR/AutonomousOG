/**
 * @fileoverview Shared constants for Agent 02 — Test Case Generator.
 */

import * as path from 'path';

/** @enum {string} */
export const TC_TYPE = Object.freeze({
  POSITIVE: 'Positive',
  NEGATIVE: 'Negative',
  EDGE: 'Edge',
  API: 'API',
  PERFORMANCE: 'Performance',
});

/** @enum {string} */
export const TC_STATUS = Object.freeze({
  DRAFT: 'Draft',
  APPROVED: 'Approved',
});

/** @enum {string} */
export const AUTOMATION_STATUS = Object.freeze({
  NOT_AUTOMATED: 'Not Automated',
  IN_PROGRESS: 'In Progress',
  AUTOMATED: 'Automated',
});

/** @enum {string} */
export const PRIORITY = Object.freeze({
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
});

/** Minimum test cases required per risk level */
export const MIN_TC_BY_RISK = Object.freeze({
  CRITICAL: { positive: 5, negative: 5, edge: 3 },
  HIGH: { positive: 3, negative: 3, edge: 2 },
  MEDIUM: { positive: 2, negative: 2, edge: 1 },
  LOW: { positive: 1, negative: 1, edge: 0 },
});

/** Common negative scenario templates */
export const NEGATIVE_TEMPLATES = Object.freeze([
  { tag: 'EMPTY_FIELD', title: 'Submit with empty mandatory field', stepDesc: 'Leave required field blank and submit' },
  { tag: 'INVALID_FORMAT', title: 'Submit with invalid format', stepDesc: 'Enter data in incorrect format and submit' },
  { tag: 'BOUNDARY_UNDER', title: 'Submit value below minimum boundary', stepDesc: 'Enter value one unit below the minimum allowed' },
  { tag: 'BOUNDARY_OVER', title: 'Submit value above maximum boundary', stepDesc: 'Enter value one unit above the maximum allowed' },
  { tag: 'UNAUTHORIZED', title: 'Access without authentication', stepDesc: 'Attempt action without logging in or with invalid token' },
  { tag: 'WRONG_ROLE', title: 'Access with insufficient permissions', stepDesc: 'Log in as a role that lacks required permission' },
  { tag: 'DUPLICATE', title: 'Submit duplicate where unique required', stepDesc: 'Submit same unique value (e.g., email) twice' },
  { tag: 'SQL_INJECT', title: 'Enter SQL injection payload', stepDesc: "Enter SQL injection string: ' OR '1'='1" },
  { tag: 'XSS', title: 'Enter XSS payload in text field', stepDesc: 'Enter <script>alert("xss")</script> in input' },
  { tag: 'EXPIRED_TOKEN', title: 'Use expired session token', stepDesc: 'Wait for session to expire, then perform action' },
]);

/** Common edge case templates */
export const EDGE_TEMPLATES = Object.freeze([
  { tag: 'MIN_BOUNDARY', title: 'Exact minimum boundary value', stepDesc: 'Enter exact minimum allowed value' },
  { tag: 'MAX_BOUNDARY', title: 'Exact maximum boundary value', stepDesc: 'Enter exact maximum allowed value' },
  { tag: 'ZERO_VALUE', title: 'Submit zero or empty value', stepDesc: 'Enter zero or empty string where applicable' },
  { tag: 'LONG_STRING', title: 'Submit extremely long string input', stepDesc: 'Enter 1000+ character string in text field' },
  { tag: 'SPECIAL_CHARS', title: 'Submit special characters', stepDesc: 'Enter special characters: #%&<>!@$^*()' },
  { tag: 'UNICODE', title: 'Submit Unicode / emoji input', stepDesc: 'Enter Unicode characters and emoji: 🚀 中文 العربية' },
  { tag: 'WHITESPACE', title: 'Submit whitespace-only input', stepDesc: 'Enter only spaces/tabs in a text field' },
  { tag: 'CONCURRENT', title: 'Concurrent simultaneous requests', stepDesc: 'Send same request from 2 sessions simultaneously' },
  { tag: 'SESSION_TIMEOUT', title: 'Operation at session timeout boundary', stepDesc: 'Let session near-expire, then complete action' },
]);

/** HTTP status codes for API negative tests */
export const API_ERROR_CODES = Object.freeze([
  { code: 400, description: 'Bad Request — invalid payload' },
  { code: 401, description: 'Unauthorized — missing/invalid token' },
  { code: 403, description: 'Forbidden — insufficient permissions' },
  { code: 404, description: 'Not Found — resource does not exist' },
  { code: 409, description: 'Conflict — duplicate resource' },
  { code: 413, description: 'Payload Too Large' },
  { code: 422, description: 'Unprocessable Entity — validation failure' },
  { code: 429, description: 'Too Many Requests — rate limit exceeded' },
]);

export const STAGE_ID = '02-test-case-generator';
export const STAGE_NAME = 'Test Case Generator';
export const NEXT_STAGE = '03-test-case-reviewer';
export const SKILL_PATH = path.resolve(__dirname, '../../skills/test-case-generation.md');
