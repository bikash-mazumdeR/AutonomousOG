'use strict';

/**
 * @fileoverview Ownership manifest and stale-file cleanup. Only files carrying the Agent 05 header marker are
 * ever deleted, so hand-written tests in the project folders are never touched.
 *
 * Ownership is recorded per requirement scope. A project accumulates one scope per requirement it has
 * ingested, and a generation may only delete files its own scope wrote on a previous run — generating
 * for a second requirement never removes the first requirement's specs, page objects or K6 scripts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GENERATED_MARKER } from '../constants';

const HEADER_BYTES = 512;

/** Files one requirement scope owns. */
export interface ManifestScope {
  sourceReviewId: string | null;
  /** Root-relative POSIX paths. */
  files: string[];
  testCases: Array<{ tcKey: string; status: string; file?: string }>;
}

/** Manifest of files owned by Agent 05 for one project, partitioned by requirement scope. */
export interface AutomationManifest {
  version: 2;
  projectSlug: string;
  scopes: Record<string, ManifestScope>;
}

/**
 * Root-relative POSIX path.
 * @param {string} root
 * @param {string} file
 * @returns {string}
 */
export function toRelative(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, '/');
}

/**
 * Whether a file starts with the Agent 05 ownership marker.
 * @param {string} file
 * @returns {boolean}
 */
export function isGeneratedFile(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(HEADER_BYTES);
    const read = fs.readSync(fd, buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, read).toString('utf-8').includes(GENERATED_MARKER);
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Reads the manifest, tolerating a missing file and the unscoped v1 layout.
 * @param {string} file
 * @param {string} projectSlug
 * @returns {AutomationManifest}
 */
export function readManifest(file: string, projectSlug: string): AutomationManifest {
  const empty: AutomationManifest = { version: 2, projectSlug, scopes: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (parsed?.version !== 2 || !parsed.scopes) return empty;
    return { version: 2, projectSlug, scopes: parsed.scopes };
  } catch {
    // Missing, unreadable or v1: nothing is claimed, so nothing of an earlier layout is ever deleted.
    return empty;
  }
}

/**
 * Deletes the files this scope owned on its previous run that the current run did not write again.
 * Files owned by another scope, and files no scope claims, are left alone.
 * @param {string} root - Framework root the manifest paths are relative to
 * @param {string[]} previousFiles - Root-relative paths this scope wrote last time
 * @param {ReadonlySet<string>} keep - Absolute paths written by the current run
 * @returns {string[]} Removed absolute file paths
 */
export function removeSupersededFiles(root: string, previousFiles: string[], keep: ReadonlySet<string>): string[] {
  const removed: string[] = [];
  for (const relative of previousFiles) {
    const file = path.resolve(root, relative);
    if (keep.has(file) || !fs.existsSync(file) || !isGeneratedFile(file)) continue;
    fs.unlinkSync(file);
    removed.push(file);
  }
  return removed;
}

/**
 * Agent 05-owned files in the output folders that no scope of the manifest claims — generated before
 * ownership was scoped per requirement. Reported so a human can retire them; never deleted here,
 * because which requirement produced them is no longer recorded.
 * @param {string[]} dirs
 * @param {ReadonlySet<string>} claimed - Absolute paths claimed by the manifest or the current run
 * @returns {string[]} Absolute file paths
 */
export function findUnclaimedGeneratedFiles(dirs: string[], claimed: ReadonlySet<string>): string[] {
  const unclaimed: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.resolve(dir, entry.name);
      if (!entry.isFile() || claimed.has(file) || !isGeneratedFile(file)) continue;
      unclaimed.push(file);
    }
  }
  return unclaimed;
}

/**
 * Writes the manifest with stable ordering.
 * @param {string} file
 * @param {AutomationManifest} manifest
 */
export function writeManifest(file: string, manifest: AutomationManifest): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const scopes = Object.fromEntries(Object.entries(manifest.scopes).sort(([a], [b]) => a.localeCompare(b))
    .map(([scope, entry]) => [scope, {
      ...entry,
      files: [...entry.files].sort(),
      testCases: [...entry.testCases].sort((a, b) => a.tcKey.localeCompare(b.tcKey)),
    }]));
  fs.writeFileSync(file, `${JSON.stringify({ ...manifest, scopes }, null, 2)}\n`, 'utf-8');
}
