'use strict';

/**
 * @fileoverview Project-scoped filesystem layout.
 * Every application under test gets its own configuration folder (`projects/<slug>`) and its own
 * generated-test root (`tests/projects/<slug>`), so switching or adding applications never mixes
 * or overwrites another project's artifacts.
 */

import * as fs from 'fs';
import * as path from 'path';

export const FRAMEWORK_ROOT = path.resolve(__dirname, '../..');
export const PROJECTS_CONFIG_ROOT = path.join(FRAMEWORK_ROOT, 'projects');
export const PROJECT_TESTS_ROOT = path.join(FRAMEWORK_ROOT, 'tests', 'projects');
export const ACTIVE_PROJECT_FILE = path.join(PROJECT_TESTS_ROOT, '.active-project');
export const FRAMEWORK_BASE_PAGE = path.join(FRAMEWORK_ROOT, 'tests', 'pages', 'BasePage.ts');
export const FRAMEWORK_ENV_HELPER = path.join(FRAMEWORK_ROOT, 'tests', 'helpers', 'env.ts');
export const FRAMEWORK_STORAGE_HELPER = path.join(FRAMEWORK_ROOT, 'tests', 'helpers', 'storage.ts');

/** Resolved paths for one project. */
export interface ProjectPaths {
  slug: string;
  configDir: string;
  profileFile: string;
  learningsDir: string;
  testsRoot: string;
  specsDir: string;
  pagesDir: string;
  pageMapsDir: string;
  fixturesDir: string;
  fixtureFile: string;
  k6Dir: string;
  manifestFile: string;
}

/**
 * Folder-safe slug for a project id ("ARIA Project" → "aria-project").
 * @param {string} projectId
 * @returns {string}
 */
export function toProjectSlug(projectId: string): string {
  const slug = String(projectId || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`Invalid projectId "${projectId}"`);
  return slug;
}

/**
 * All project-scoped paths.
 * @param {string} projectId
 * @returns {ProjectPaths}
 */
export function projectPaths(projectId: string): ProjectPaths {
  const slug = toProjectSlug(projectId);
  const configDir = path.join(PROJECTS_CONFIG_ROOT, slug);
  const testsRoot = path.join(PROJECT_TESTS_ROOT, slug);
  return {
    slug,
    configDir,
    profileFile: path.join(configDir, 'aut-profile.json'),
    learningsDir: path.join(configDir, 'learnings'),
    testsRoot,
    specsDir: path.join(testsRoot, 'specs'),
    pagesDir: path.join(testsRoot, 'pages'),
    pageMapsDir: path.join(testsRoot, 'page-maps'),
    fixturesDir: path.join(testsRoot, 'fixtures'),
    fixtureFile: path.join(testsRoot, 'fixtures', 'test-data.json'),
    k6Dir: path.join(testsRoot, 'k6'),
    manifestFile: path.join(testsRoot, 'automation-manifest.json'),
  };
}

/**
 * Records the project whose generated tests Playwright should run when ARIA_PROJECT_ID is not set.
 * @param {string} projectId
 */
export function writeActiveProject(projectId: string): void {
  fs.mkdirSync(PROJECT_TESTS_ROOT, { recursive: true });
  fs.writeFileSync(ACTIVE_PROJECT_FILE, `${toProjectSlug(projectId)}\n`, 'utf-8');
}

/**
 * Active project slug: ARIA_PROJECT_ID env first, then the marker written by Agent 05.
 * @returns {string|null}
 */
export function readActiveProjectSlug(): string | null {
  if (process.env.ARIA_PROJECT_ID) return toProjectSlug(process.env.ARIA_PROJECT_ID);
  if (!fs.existsSync(ACTIVE_PROJECT_FILE)) return null;
  const slug = fs.readFileSync(ACTIVE_PROJECT_FILE, 'utf-8').trim();
  return slug || null;
}
