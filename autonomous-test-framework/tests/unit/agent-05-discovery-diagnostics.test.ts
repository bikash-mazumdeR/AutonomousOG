/**
 * @fileoverview Unit tests for how Agent 05 reports a failed discovery.
 *
 * When discovery cannot load the application, every test case of the feature is parked as
 * NEEDS_CONTEXT. The reason it was parked has to survive that far: a page-load timeout, an
 * unreachable host and a page that genuinely has nothing to verify all produce an empty page map,
 * and they call for completely different fixes.
 */

import { DISCOVERY_SETTINGS } from '../../agents/05-playwright-script-generator/constants';
import {
  NO_VERIFIABLE_ELEMENTS, missingForTestCase,
} from '../../agents/05-playwright-script-generator/sub-agents/shared/featureContext';
import { MissingItem } from '../../core/readiness/readinessTypes';

describe('Agent 05 — reason a test case was parked', () => {
  it('reports the recorded cause when the page map came back empty', () => {
    const issues = new Map<string, MissingItem[]>([
      ['TC-001', [{ kind: 'AUT_UNREACHABLE', detail: 'Discovery could not open the application: page.goto: Timeout 30000ms exceeded.' }]],
    ]);

    const [reported] = missingForTestCase(issues, 'TC-001');

    expect(reported.kind).toBe('AUT_UNREACHABLE');
    expect(reported.detail).toContain('Timeout 30000ms exceeded');
    expect(reported.detail).not.toBe(NO_VERIFIABLE_ELEMENTS);
  });

  it('keeps a per-test-case step failure distinguishable from an unreachable application', () => {
    const issues = new Map<string, MissingItem[]>([
      ['TC-001', [{ kind: 'AUT_UNREACHABLE', detail: 'Discovery could not open the application: net::ERR_NAME_NOT_RESOLVED' }]],
      ['TC-002', [{ kind: 'STATE', detail: 'No valid navigation plan from verified elements.' }]],
    ]);

    expect(missingForTestCase(issues, 'TC-001')[0].kind).toBe('AUT_UNREACHABLE');
    expect(missingForTestCase(issues, 'TC-002')[0].kind).toBe('STATE');
  });

  it('falls back to the generic message only when discovery recorded nothing', () => {
    const [reported] = missingForTestCase(new Map(), 'TC-003');

    expect(reported.kind).toBe('LOCATOR');
    expect(reported.detail).toBe(NO_VERIFIABLE_ELEMENTS);
  });

  it('treats an empty recorded list as nothing recorded', () => {
    const issues = new Map<string, MissingItem[]>([['TC-004', []]]);

    expect(missingForTestCase(issues, 'TC-004')).toEqual([{ kind: 'LOCATOR', detail: NO_VERIFIABLE_ELEMENTS }]);
  });
});

describe('Agent 05 — discovery navigation budget', () => {
  const original = process.env.DISCOVERY_NAVIGATION_TIMEOUT_MS;

  afterEach(() => {
    if (original === undefined) delete process.env.DISCOVERY_NAVIGATION_TIMEOUT_MS;
    else process.env.DISCOVERY_NAVIGATION_TIMEOUT_MS = original;
  });

  it('defaults to 30s when unset', () => {
    delete process.env.DISCOVERY_NAVIGATION_TIMEOUT_MS;
    expect(DISCOVERY_SETTINGS.NAVIGATION_TIMEOUT_MS).toBe(30000);
  });

  it('honours an override, read on access so dotenv load order cannot defeat it', () => {
    process.env.DISCOVERY_NAVIGATION_TIMEOUT_MS = '180000';
    expect(DISCOVERY_SETTINGS.NAVIGATION_TIMEOUT_MS).toBe(180000);
  });

  it('ignores a malformed or non-positive override rather than disabling the timeout', () => {
    for (const value of ['abc', '0', '-5', '']) {
      process.env.DISCOVERY_NAVIGATION_TIMEOUT_MS = value;
      expect(DISCOVERY_SETTINGS.NAVIGATION_TIMEOUT_MS).toBe(30000);
    }
  });
});
