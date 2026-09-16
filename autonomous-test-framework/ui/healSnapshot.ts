'use strict';

/**
 * @fileoverview Snapshot / diff / restore for the source trees Agent 10 rewrites.
 *
 * Agent 10 is the only agent that edits source files, and it does so with no approval gate and no
 * backup — `skills/auto-healing.md` states outright that "git history preserves rollback". It also
 * reports its own changes badly: `diff` is a bare boolean for the WAIT_ADJUSTMENT, ASSERTION_RELAX
 * and DATA_FIX strategies and absent entirely for SELECTOR_HEAL, so only the LLM path carries real
 * before/after text.
 *
 * Snapshotting the tree before the healer runs supplies both missing halves from the outside: a true
 * before/after for every changed file regardless of what the agent reported, and a byte-exact
 * revert — the only rollback in the framework.
 *
 * This lives apart from agent10Routes.ts so the destructive parts can be unit-tested without pulling
 * in the LLM client, whose ESM-only dependencies Jest cannot transform.
 *
 * @module healSnapshot
 */

import fs from 'fs';
import path from 'path';

/** Framework root (the parent of ui/). */
const FRAMEWORK_DIR = path.resolve(__dirname, '..');

/** Snapshots live under .state/, which is git-ignored and already holds pipeline scratch data. */
const SNAPSHOT_ROOT = path.join(FRAMEWORK_DIR, '.state', 'heal-snapshots');

/** Files worth snapshotting — the healer only ever rewrites source. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs']);

/** A file that differs between the snapshot and the working tree. */
export interface FileChange {
  relPath: string;
  status: 'modified' | 'added' | 'deleted';
  beforeBytes: number;
  afterBytes: number;
}

/** State of the snapshot taken for the current or most recent run. */
export interface Snapshot {
  id: string;
  dir: string;
  roots: string[];
  takenAt: string;
  fileCount: number;
}

/**
 * Every source file under a directory, recursively.
 * @param {string} dir
 * @returns {string[]} Absolute paths
 */
function walkFiles(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // a project may legitimately have no k6/ or pages/ directory
  }

  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(full);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

/**
 * Forward-slashed relative path, so snapshot and working-tree keys match on Windows too.
 * @param {string} from - Absolute base directory
 * @param {string} absolute - Absolute file path beneath it
 * @returns {string}
 */
function toRelPath(from: string, absolute: string): string {
  return path.relative(from, absolute).split(path.sep).join('/');
}

/**
 * Copies every source file under `roots` into a fresh snapshot directory, mirroring the
 * framework-relative layout so a later diff can key both sides identically.
 *
 * @param {string[]} roots - Absolute directories
 * @returns {Snapshot}
 */
export function takeSnapshot(roots: string[]): Snapshot {
  const id = `heal_${Date.now()}`;
  const dir = path.join(SNAPSHOT_ROOT, id);
  let fileCount = 0;

  for (const root of roots) {
    for (const file of walkFiles(root)) {
      const destination = path.join(dir, toRelPath(FRAMEWORK_DIR, file));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file, destination);
      fileCount += 1;
    }
  }

  return {
    id, dir, roots, takenAt: new Date().toISOString(), fileCount,
  };
}

/**
 * Compares a snapshot against the working tree.
 * @param {Snapshot} snapshot
 * @returns {FileChange[]} Sorted by path
 */
export function diffSnapshot(snapshot: Snapshot): FileChange[] {
  // Keys are framework-relative on both sides: the snapshot mirrors that layout under its own root.
  const before = new Map<string, string>();
  for (const file of walkFiles(snapshot.dir)) {
    before.set(toRelPath(snapshot.dir, file), fs.readFileSync(file, 'utf-8'));
  }

  const after = new Map<string, string>();
  for (const root of snapshot.roots) {
    for (const file of walkFiles(root)) {
      after.set(toRelPath(FRAMEWORK_DIR, file), fs.readFileSync(file, 'utf-8'));
    }
  }

  const changes: FileChange[] = [];

  after.forEach((content, relPath) => {
    const original = before.get(relPath);
    if (original === undefined) {
      changes.push({
        relPath, status: 'added', beforeBytes: 0, afterBytes: Buffer.byteLength(content),
      });
    } else if (original !== content) {
      changes.push({
        relPath,
        status: 'modified',
        beforeBytes: Buffer.byteLength(original),
        afterBytes: Buffer.byteLength(content),
      });
    }
  });

  before.forEach((content, relPath) => {
    if (!after.has(relPath)) {
      changes.push({
        relPath, status: 'deleted', beforeBytes: Buffer.byteLength(content), afterBytes: 0,
      });
    }
  });

  return changes.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * Reads one side of a change out of the snapshot or the working tree.
 * @param {Snapshot} snapshot
 * @param {string} relPath - Framework-relative, forward-slashed
 * @returns {{before: string, after: string}}
 */
export function readBothSides(snapshot: Snapshot, relPath: string): { before: string; after: string } {
  const snapshotFile = path.join(snapshot.dir, relPath);
  const workingFile = path.join(FRAMEWORK_DIR, relPath);
  return {
    before: fs.existsSync(snapshotFile) ? fs.readFileSync(snapshotFile, 'utf-8') : '',
    after: fs.existsSync(workingFile) ? fs.readFileSync(workingFile, 'utf-8') : '',
  };
}

/**
 * Restores every file the healer changed and removes anything it added.
 * @param {Snapshot} snapshot
 * @returns {number} Files restored or removed
 */
export function restoreSnapshot(snapshot: Snapshot): number {
  let touched = 0;

  for (const change of diffSnapshot(snapshot)) {
    const target = path.join(FRAMEWORK_DIR, change.relPath);
    if (change.status === 'added') {
      fs.rmSync(target, { force: true });
    } else {
      const source = path.join(snapshot.dir, change.relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    touched += 1;
  }

  return touched;
}

/**
 * Deletes a snapshot directory. Failure is non-fatal — a stale snapshot costs disk, nothing more.
 * @param {Snapshot} snapshot
 */
export function discardSnapshot(snapshot: Snapshot): void {
  try {
    fs.rmSync(snapshot.dir, { recursive: true, force: true });
  } catch { /* best effort */ }
}
