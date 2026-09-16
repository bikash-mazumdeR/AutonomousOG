/**
 * @fileoverview Agent 10 rewrites source files in place with no gate and no backup, so the Agent 10
 * console snapshots the tree first and offers a byte-exact revert. That revert is the only rollback
 * in the framework and it deletes files, so it is covered here rather than trusted.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  takeSnapshot, diffSnapshot, restoreSnapshot, discardSnapshot, Snapshot,
} from '../../ui/healSnapshot';

const FRAMEWORK_DIR = path.resolve(__dirname, '../..');
/** Lives under .state/ so it is git-ignored and shares a root with FRAMEWORK_DIR, as real specs do. */
const SANDBOX = path.join(FRAMEWORK_DIR, '.state', 'heal-snapshot-test');

/**
 * @param {string} relative - Path within the sandbox
 * @param {string} content
 */
function write(relative: string, content: string): void {
  const target = path.join(SANDBOX, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

/**
 * @param {string} relative - Path within the sandbox
 * @returns {string}
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(SANDBOX, relative), 'utf-8');
}

describe('Agent 10 heal snapshot', () => {
  let snapshot: Snapshot | null = null;

  beforeEach(() => {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
    write('specs/F-01.spec.ts', 'await expect(x).toBe("a");\n');
    write('specs/F-02.spec.ts', 'await page.waitForTimeout(5000);\n');
    write('pages/F01Page.ts', 'export class F01Page {}\n');
    write('specs/notes.md', 'not source, must be ignored\n');
    snapshot = takeSnapshot([path.join(SANDBOX, 'specs'), path.join(SANDBOX, 'pages')]);
  });

  afterEach(() => {
    if (snapshot) discardSnapshot(snapshot);
    snapshot = null;
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  });

  it('captures only source files', () => {
    expect(snapshot!.fileCount).toBe(3); // the .md is skipped
    expect(fs.existsSync(snapshot!.dir)).toBe(true);
  });

  it('reports no changes when nothing was healed', () => {
    expect(diffSnapshot(snapshot!)).toEqual([]);
  });

  it('detects a modified file and exposes both sides', () => {
    write('specs/F-01.spec.ts', 'await expect(x).toContain("a");\n');

    const changes = diffSnapshot(snapshot!);
    expect(changes).toHaveLength(1);
    expect(changes[0].status).toBe('modified');
    expect(changes[0].relPath.endsWith('specs/F-01.spec.ts')).toBe(true);

    // The before side must come from the snapshot, which is what lets the UI show a real diff even
    // for the strategies whose reported `diff` is a bare boolean.
    const before = fs.readFileSync(path.join(snapshot!.dir, changes[0].relPath), 'utf-8');
    expect(before).toContain('toBe(');
  });

  it('detects added and deleted files', () => {
    write('specs/F-03.spec.ts', 'const added = true;\n');
    fs.rmSync(path.join(SANDBOX, 'specs/F-02.spec.ts'));

    const statuses = diffSnapshot(snapshot!).map((c) => c.status).sort();
    expect(statuses).toEqual(['added', 'deleted']);
  });

  it('reverts modifications, additions and deletions byte-for-byte', () => {
    const original = read('specs/F-01.spec.ts');
    write('specs/F-01.spec.ts', 'LLM REWROTE THE WHOLE FILE\n');
    write('specs/F-99.spec.ts', 'const stray = true;\n');
    fs.rmSync(path.join(SANDBOX, 'pages/F01Page.ts'));

    const reverted = restoreSnapshot(snapshot!);

    expect(reverted).toBe(3);
    expect(read('specs/F-01.spec.ts')).toBe(original);
    expect(fs.existsSync(path.join(SANDBOX, 'specs/F-99.spec.ts'))).toBe(false);
    expect(read('pages/F01Page.ts')).toBe('export class F01Page {}\n');
    expect(diffSnapshot(snapshot!)).toEqual([]);
  });

  it('leaves untracked file types alone on revert', () => {
    write('specs/notes.md', 'edited by hand\n');
    restoreSnapshot(snapshot!);
    expect(read('specs/notes.md')).toBe('edited by hand\n');
  });

  it('tolerates a root that does not exist', () => {
    const partial = takeSnapshot([path.join(SANDBOX, 'specs'), path.join(SANDBOX, 'k6')]);
    expect(partial.fileCount).toBe(2);
    expect(diffSnapshot(partial)).toEqual([]);
    discardSnapshot(partial);
  });
});
