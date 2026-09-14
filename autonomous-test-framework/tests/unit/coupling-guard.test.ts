/**
 * @fileoverview Coupling guard: generic framework layers must not contain application-specific knowledge.
 * Tokens come from every AUT profile's `couplingGuardTokens`, so the guard itself stays application-agnostic.
 */

import * as fs from 'fs';
import * as path from 'path';
import { listAutProfiles } from '../../core/aut/AutProfile';

const ROOT = path.resolve(__dirname, '../..');

const GENERIC_LAYERS = [
  'agents/05-playwright-script-generator',
  'core/automation-reviewer',
  'core/aut',
  'core/state-manager/FixtureSync.ts',
  'core/state-manager/TestDataFreshness.ts',
  'agents/04-test-data-generator/placeholderIntent.ts',
  'tests/pages/BasePage.ts',
  'tests/helpers/env.ts',
  'playwright.config.ts',
  'skills/automation-scripting.md',
  'skills/automation-discovery.md',
  'skills/ui-scripting.md',
  'skills/api-scripting.md',
  'skills/k6-scripting.md',
];

const ABSOLUTE_HOST = /https?:\/\/(?!localhost|127\.0\.0\.1|playwright\.dev)[a-z0-9-]+(\.[a-z0-9-]+)+/i;

function listFiles(relative: string): string[] {
  const full = path.join(ROOT, relative);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => listFiles(path.join(relative, entry.name)))
    .filter((file) => /\.(ts|js|md)$/.test(file));
}

describe('Coupling guard — generic layers stay application-agnostic', () => {
  const files = GENERIC_LAYERS.flatMap(listFiles);
  const tokens = [...new Set(listAutProfiles().flatMap((profile) => profile.couplingGuardTokens))];

  it('has application tokens to guard against', () => {
    expect(tokens.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(10);
  });

  it('contains no application-specific tokens', () => {
    const offenders = files.flatMap((file) => {
      const content = fs.readFileSync(file, 'utf-8').toLowerCase();
      return tokens.filter((token) => content.includes(token.toLowerCase())).map((token) => `${path.relative(ROOT, file)}: "${token}"`);
    });
    expect(offenders).toEqual([]);
  });

  it('contains no hard-coded application hosts in code', () => {
    const offenders = files
      .filter((file) => /\.(ts|js)$/.test(file))
      .filter((file) => ABSOLUTE_HOST.test(fs.readFileSync(file, 'utf-8')))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
