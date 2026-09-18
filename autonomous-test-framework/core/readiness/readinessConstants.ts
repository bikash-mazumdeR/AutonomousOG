'use strict';

/**
 * @fileoverview Application-agnostic patterns and identifiers for the automation-readiness rules.
 */

/** @enum {string} Identifiers of readiness rules (used to route questions and deduplicate them). */
export const READINESS_RULE = Object.freeze({
  NO_EXPECTED_RESULTS: 'NO_EXPECTED_RESULTS',
  STEP_WITHOUT_EXPECTED_RESULT: 'STEP_WITHOUT_EXPECTED_RESULT',
  REVIEWER_MARKER: 'REVIEWER_MARKER',
  REWRITE_MARKER: 'REWRITE_MARKER',
  VAGUE_EXPECTED_RESULT: 'VAGUE_EXPECTED_RESULT',
  UNQUOTED_TEXT: 'UNQUOTED_TEXT',
  TIMING_WITHOUT_TARGET: 'TIMING_WITHOUT_TARGET',
  UNASSERTABLE_OBSERVATION: 'UNASSERTABLE_OBSERVATION',
  INPUT_WITHOUT_DATA: 'INPUT_WITHOUT_DATA',
  PRECONDITION_MISSING: 'PRECONDITION_MISSING',
  UNRESOLVED_BINDING: 'UNRESOLVED_BINDING',
  UNRESOLVED_REQUEST_BODY: 'UNRESOLVED_REQUEST_BODY',
  API_DETAILS: 'API_DETAILS',
  API_AUTH: 'API_AUTH',
  K6_DETAILS: 'K6_DETAILS',
  K6_SLA: 'K6_SLA',
  CREDENTIAL_ENV_VAR: 'CREDENTIAL_ENV_VAR',
  BROWSER_UNSUPPORTED: 'BROWSER_UNSUPPORTED',
  BROWSER_NOT_CONFIGURED: 'BROWSER_NOT_CONFIGURED',
  AUT_BASE_URL: 'AUT_BASE_URL',
} as const);

export const K6_SCENARIOS: readonly string[] = Object.freeze(['load', 'stress', 'spike', 'soak']);
export const HTTP_METHODS: readonly string[] = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
export const SLA_PATTERN = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)\b/i;
export const REVIEWER_CLARIFICATION_MARKER = /\[REQUIRES CLARIFICATION/i;
export const REVIEWER_REWRITE_MARKER = /\[REWRITTEN-BY-AGENT-03\]/i;

/** Concrete observables: quoted text, a URL path, a data placeholder, a number with a unit, or a hex colour. */
export const QUOTED_TEXT = /"[^"]+"|'[^']+'|“[^”]+”|‘[^’]+’/;
export const URL_PATH = /(?:^|[\s("'])\/[A-Za-z0-9._~\-/]+/;
export const PLACEHOLDER_TOKEN = /\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/;
export const NUMBER_WITH_UNIT = /\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|secs?|seconds?|minutes?|px|characters?|chars?|items?|rows?|results?|times?)\b|\b\d+(?:\.\d+)?\s*%/i;
export const HEX_COLOUR = /#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/i;

/** Outcome wording that states no observable result on its own. */
export const VAGUE_OUTCOME = /\b(properly|correctly|as expected|appropriately|successfully|works|working|is handled|fast|quickly|if applicable)\b/i;

/** Nouns whose expected result is a piece of text that has to be quoted exactly. */
export const TEXT_NOUNS = /\b(message|error|text|label|title|heading|notification|toast|alert|dialog|banner|tooltip|warning)\b/i;

/** Elements that carry no text of their own; "an error icon is displayed" has nothing to quote. */
export const NON_TEXT_ELEMENT_NOUNS = /\b(icons?|images?|imgs?|logos?|spinners?|loaders?|avatars?|badges?|checkbox(?:es)?|radio buttons?|toggles?|switch(?:es)?|progress bars?|charts?|graphs?|thumbnails?|svgs?)\b/i;

/** The verb that ends the subject of an expected result ("<subject> is displayed …"). */
export const SUBJECT_VERB = /\b(is|are|was|were|appears?|shows?|displays?|becomes?|remains?|stays?|should|must|will|gets?)\b/i;

/** Words that start a phrase qualifying the subject ("an error message with an icon", "the banner below the form"). */
export const SUBJECT_QUALIFIER = /\b(?:with|alongside|next to|beside|near|inside|within|in|on|under|below|above|of|for|containing)\b/i;

/** An element going away: asserted by its absence, so there is no text to quote. */
export const ABSENCE_OUTCOME = /\b(no longer (?:displayed|shown|visible|present)|(?:is|are) not (?:displayed|shown|visible|present)|disappears?|(?:is|are|gets?) (?:hidden|removed|dismissed|cleared)|not rendered)\b/i;

/** An element state asserted without text (masked input, disabled button, checked box). */
export const ELEMENT_STATE = /\b(masked|enabled|disabled|checked|unchecked|focused|read-?only|editable|empty)\b/i;

/** A time limit, and the UI targets that make a time limit observable. */
export const TIMING_CLAUSE = /\bwithin\s+\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|secs?|seconds?)\b/i;
export const UI_TARGET_NOUNS = /\b(page|screen|view|dialog|message|button|field|input|element|list|banner|heading|form|table|link|image|icon)\b/i;

/** Observations a browser-level UI test cannot make. */
/** Local storage: the one unsupported-looking subject the storage helpers can actually poll, by key. */
export const LOCAL_STORAGE = /\blocal ?storage\b/i;

export const UNSUPPORTED_OBSERVATION = /\b(local ?storage|session ?storage|cookies?|database|db record|e-?mail (?:is )?sent|inbox|server logs?|log files?|backend|audit log|screen ?readers?|assistive technolog(?:y|ies))\b/i;

/** Actions that enter a value. */
export const INPUT_VERBS = /\b(enters?|types?|fills?|inputs?|selects?|chooses?|uploads?|pastes?)\b/i;
