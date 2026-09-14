'use strict';

/**
 * @fileoverview Ownership manifest and stale-file cleanup. Only files carrying the Agent 05 header marker are
 * ever deleted, so hand-written tests in the project folders are never touched.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GENERATED_MARKER } from '../constants';

const HEADER_BYTES = 512;

/** Manifest of files owned by Agent 05 for one project. */
export interface AutomationManifest {
  version: 1;
  projectSlug: string;
  sourceReviewId: string | null;
  files: string[];
  testCases: Array<{ tcKey: string; status: string; file?: string }>;
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
 * Deletes Agent 05-owned files that are not part of the current generation.
 * @param {string[]} dirs
 * @param {ReadonlySet<string>} keep - Absolute paths to keep
 * @returns {string[]} Removed file paths
 */
export function removeStaleGeneratedFiles(dirs: string[], keep: ReadonlySet<string>): string[] {
  const removed: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.resolve(dir, entry.name);
      if (!entry.isFile() || keep.has(file) || !isGeneratedFile(file)) continue;
      fs.unlinkSync(file);
      removed.push(file);
    }
  }
  return removed;
}

/**
 * Writes the manifest with stable ordering.
 * @param {string} file
 * @param {AutomationManifest} manifest
 */
export function writeManifest(file: string, manifest: AutomationManifest): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = { ...manifest, files: [...manifest.files].sort(), testCases: [...manifest.testCases].sort((a, b) => a.tcKey.localeCompare(b.tcKey)) };
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf-8');
}
