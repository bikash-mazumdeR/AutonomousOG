/**
 * @fileoverview Unit tests for requirement isolation.
 *
 * A project accumulates one requirement document after another, and Agent 01 numbers features,
 * stories and test cases from the start of each one. These tests pin the rules that keep a newly
 * ingested requirement from landing on the previous requirement's generated output.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requirementScope, scopedFeatureKey, DEFAULT_SCOPE, featureStemsOf } from '../../core/aut/requirementScope';
import {
  findUnclaimedGeneratedFiles, readManifest, removeSupersededFiles, writeManifest, AutomationManifest,
} from '../../agents/05-playwright-script-generator/output/manifest';
import { GENERATED_MARKER } from '../../agents/05-playwright-script-generator/constants';
import { syncFeatureFiles, featureFolderName, featureFileBaseName } from '../../agents/02-test-case-generator/utils';
import { projectPaths } from '../../core/aut/projectPaths';
import { requiresIsolatedRun } from '../../agents/01-requirement-analyzer/inputFingerprint';
import { stateManager } from '../../core/state-manager/StateManager';

const PROJECT = 'test-unit-features';
const FEATURES_DIR = projectPaths(PROJECT).featuresDir;

const analysisFor = (featureName: string, storyTitle: string) => ({
  features: [{
    id: 'F-01',
    name: featureName,
    userStories: [{ id: 'US-01', title: storyTitle, role: 'user', goal: 'do the thing' }],
  }],
});

const testCaseFor = (key: string, name: string) => ({
  key,
  name,
  type: 'Positive',
  userStoryId: 'US-01',
  testSteps: [{ keyword: 'When', description: 'the user acts', expectedResult: 'it happens' }],
});

describe('requirementScope', () => {
  it('slugs the feature name so generated files read as the requirement they belong to', () => {
    expect(requirementScope(analysisFor('Logout Feature – Nexo Desk', 'Logout'))).toBe('logout-feature-nexo-desk');
    expect(requirementScope(analysisFor('Login', 'Login'))).toBe('login');
  });

  it('falls back to the requirement fingerprint, then to a constant, when no feature is named', () => {
    expect(requirementScope({ features: [], requirementFingerprint: 'ec89d0de82df1f7b' })).toBe('ec89d0de82df');
    expect(requirementScope(null)).toBe(DEFAULT_SCOPE);
  });

  it('keeps the feature id intact while making the file name unique per requirement', () => {
    expect(scopedFeatureKey('login', 'F-01')).toBe('login-F-01');
    expect(scopedFeatureKey('logout', 'F-01')).toBe('logout-F-01');
    expect(scopedFeatureKey('', 'F-01')).toBe('F-01');
  });
});

describe('Agent 02 feature files', () => {
  afterAll(() => fs.rmSync(projectPaths(PROJECT).testsRoot, { recursive: true, force: true }));

  it('writes inside the project, never into a folder shared with other projects', () => {
    const [file] = syncFeatureFiles(PROJECT, analysisFor('Isolation Login Fixture', 'Sign in'), [testCaseFor('TC-001', 'Sign in')]);

    expect(path.resolve(file).startsWith(path.resolve(projectPaths(PROJECT).testsRoot))).toBe(true);
    expect(path.relative(FEATURES_DIR, file).split(path.sep)[0]).toBe('Isolation Login Fixture');
  });

  it('gives each requirement its own folder, so a second US-01 cannot claim the first one', () => {
    const login = syncFeatureFiles(
      PROJECT,
      analysisFor('Isolation Login Fixture', 'Sign in'),
      [testCaseFor('TC-001', 'Sign in with valid credentials')],
    );
    const logout = syncFeatureFiles(
      PROJECT,
      analysisFor('Isolation Logout Fixture', 'Sign out'),
      [testCaseFor('TC-001', 'Sign out from the dashboard')],
    );
    expect(login).toHaveLength(1);
    expect(logout).toHaveLength(1);
    expect(logout[0]).not.toBe(login[0]);
    expect(fs.readFileSync(login[0], 'utf-8')).toContain('Sign in with valid credentials');
    expect(fs.readFileSync(logout[0], 'utf-8')).toContain('Sign out from the dashboard');
  });
});

describe('Agent 02 feature file naming', () => {
  afterAll(() => fs.rmSync(projectPaths(PROJECT).testsRoot, { recursive: true, force: true }));

  it('reduces the requirement title Agent 01 copied into the feature name to the bare feature', () => {
    expect(featureFolderName('Profile Feature')).toBe('Profile');
    expect(featureFolderName('Logout Feature – Nexo Desk')).toBe('Logout');
    expect(featureFolderName('Login')).toBe('Login');
    expect(featureFolderName('PRD – Password Reset')).toBe('Password Reset');
    expect(featureFolderName('Checkout Requirements Document')).toBe('Checkout');
    expect(featureFolderName('')).toBe('General');
  });

  it('names the file "<Feature> Feature- <App>" inside the "<Feature>" folder', () => {
    expect(featureFileBaseName('Profile', 'Nexo')).toBe('Profile Feature- Nexo');
    const [file] = syncFeatureFiles(PROJECT, analysisFor('Settings Feature', 'Change theme'), [testCaseFor('TC-001', 'Change theme')]);
    expect(path.relative(FEATURES_DIR, file).split(path.sep)).toEqual(['Settings', `Settings Feature- ${PROJECT}.feature`]);
  });

  it('keeps every story of a feature in its one file, one Rule per story', () => {
    const analysis = {
      features: [{
        id: 'F-01',
        name: 'Account Feature',
        userStories: [{ id: 'US-01', title: 'View account' }, { id: 'US-02', title: 'Edit account' }],
      }],
    };
    const files = syncFeatureFiles(PROJECT, analysis, [
      testCaseFor('TC-001', 'View the account page'),
      { ...testCaseFor('TC-002', 'Edit the account name'), userStoryId: 'US-02' },
    ]);
    expect(files).toHaveLength(1);
    const text = fs.readFileSync(files[0], 'utf-8');
    expect(text).toContain('Rule: US-01 View account');
    expect(text).toContain('Rule: US-02 Edit account');
  });
});

describe('Agent 05 file naming', () => {
  it('names spec, page object and page map after the bare feature', () => {
    const stems = featureStemsOf({ features: [
      { id: 'F-01', name: 'Profile Feature' },
      { id: 'F-02', name: 'Password Reset – Nexo Desk' },
    ] });
    expect(stems.get('F-01')).toBe('Profile');
    expect(stems.get('F-02')).toBe('PasswordReset');
  });

  it('leaves out a stem two features would share, so they keep the scoped key', () => {
    const stems = featureStemsOf({ features: [{ id: 'F-01', name: 'Profile' }, { id: 'F-02', name: 'Profile Feature' }] });
    expect(stems.size).toBe(0);
  });
});

describe('Agent 05 scoped ownership', () => {
  let root: string;

  const generated = (file: string, body = 'x') => {
    fs.writeFileSync(file, `// ${GENERATED_MARKER} project=sample\n${body}\n`, 'utf-8');
    return file;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-scope-'));
    fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('removes only the files the same requirement wrote last time', () => {
    const loginSpec = generated(path.join(root, 'specs', 'login-F-01.spec.ts'));
    const logoutSpec = generated(path.join(root, 'specs', 'logout-F-01.spec.ts'));
    const retiredSpec = generated(path.join(root, 'specs', 'logout-F-02.spec.ts'));

    const removed = removeSupersededFiles(root, ['specs/logout-F-01.spec.ts', 'specs/logout-F-02.spec.ts'], new Set([logoutSpec]));

    expect(removed).toEqual([retiredSpec]);
    expect(fs.existsSync(loginSpec)).toBe(true);
    expect(fs.existsSync(logoutSpec)).toBe(true);
    expect(fs.existsSync(retiredSpec)).toBe(false);
  });

  it('never deletes a hand-written file, even one this scope claims', () => {
    const handWritten = path.join(root, 'specs', 'logout-F-01.spec.ts');
    fs.writeFileSync(handWritten, 'test("written by a human", () => {});\n', 'utf-8');

    expect(removeSupersededFiles(root, ['specs/logout-F-01.spec.ts'], new Set())).toEqual([]);
    expect(fs.existsSync(handWritten)).toBe(true);
  });

  it('reports generated files that no requirement claims instead of deleting them', () => {
    const legacy = generated(path.join(root, 'specs', 'F-01.spec.ts'));
    const current = generated(path.join(root, 'specs', 'logout-F-01.spec.ts'));

    const unclaimed = findUnclaimedGeneratedFiles([path.join(root, 'specs')], new Set([current]));

    expect(unclaimed).toEqual([legacy]);
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it('keeps every requirement in the manifest across generations', () => {
    const file = path.join(root, 'automation-manifest.json');
    const manifest: AutomationManifest = {
      version: 2,
      projectSlug: 'sample',
      scopes: { login: { sourceReviewId: 'r1', files: ['specs/login-F-01.spec.ts'], testCases: [{ tcKey: 'TC-001', status: 'GENERATED' }] } },
    };
    writeManifest(file, manifest);

    const reopened = readManifest(file, 'sample');
    reopened.scopes.logout = { sourceReviewId: 'r2', files: ['specs/logout-F-01.spec.ts'], testCases: [] };
    writeManifest(file, reopened);

    expect(Object.keys(readManifest(file, 'sample').scopes).sort()).toEqual(['login', 'logout']);
  });

  it('claims nothing from an unscoped manifest, so an older layout is never deleted', () => {
    const file = path.join(root, 'automation-manifest.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, projectSlug: 'sample', files: ['specs/F-01.spec.ts'] }), 'utf-8');

    expect(readManifest(file, 'sample')).toEqual({ version: 2, projectSlug: 'sample', scopes: {} });
  });
});

describe('Agent 01 run isolation', () => {
  it('branches a run only when the incoming requirement differs from the one the run holds', () => {
    const login = { requirementFingerprint: 'fp-login', features: [{ id: 'F-01', name: 'Login' }] };

    expect(requiresIsolatedRun(login, 'fp-logout')).toBe(true);
    expect(requiresIsolatedRun(login, 'fp-login')).toBe(false);
  });

  it('stays in the current run when it holds no requirement yet', () => {
    expect(requiresIsolatedRun(null, 'fp-login')).toBe(false);
    expect(requiresIsolatedRun({}, 'fp-login')).toBe(false);
    expect(requiresIsolatedRun({ requirementFingerprint: '' }, 'fp-login')).toBe(false);
  });

  it('leaves the analysis and test cases of the previous run intact when a new run starts', async () => {
    const project = `test-unit-isolation-${Date.now()}`;
    await stateManager.initialize(project);
    await stateManager.setPipelineArtifact('analyzedRequirements', { requirementFingerprint: 'fp-login', features: [{ name: 'Login' }] });
    await stateManager.setPipelineArtifact('testCases', { zephyrExport: { totalTestCases: 12 } });
    const loginRunId = (await stateManager.getFullState()).runId;

    await new Promise((resolve) => { setTimeout(resolve, 20); });
    const fresh = await stateManager.startNewRun(project);
    await stateManager.setPipelineArtifact('analyzedRequirements', { requirementFingerprint: 'fp-logout', features: [{ name: 'Logout' }] });

    expect(fresh.runId).not.toBe(loginRunId);

    // The open run describes the new requirement and carries none of the previous output.
    const current = await stateManager.getFullState();
    expect(current.pipeline.analyzedRequirements?.features[0].name).toBe('Logout');
    expect(current.pipeline.testCases).toBeUndefined();

    // The first requirement's run still holds its own analysis and its own test cases.
    const db = stateManager.getDatabase();
    const artifact = (key: string) => JSON.parse((db.prepare('SELECT value FROM artifacts WHERE run_id = ? AND key = ?')
      .get(loginRunId, key) as any).value);
    expect(artifact('analyzedRequirements').features[0].name).toBe('Login');
    expect(artifact('testCases').zephyrExport.totalTestCases).toBe(12);
  });
});

describe('pipeline artifacts are run-scoped', () => {
  it('reports a missing stage input instead of answering from the previous requirement', async () => {
    const project = `test-unit-scoped-${Date.now()}`;
    await stateManager.initialize(project);
    await stateManager.setPipelineArtifact('testCases', { zephyrExport: { totalTestCases: 12 } });

    await new Promise((resolve) => { setTimeout(resolve, 20); });
    await stateManager.startNewRun(project);

    // The new run has no test cases of its own: Agent 03 must be told to run Agent 02, not handed
    // the test cases of the requirement this run replaced.
    expect(await stateManager.getPipelineArtifact('testCases')).toBeNull();

    // The deliberate cross-run question still has its answer.
    expect((await stateManager.getLatestArtifactForProject('testCases')).zephyrExport.totalTestCases).toBe(12);
  });
});
