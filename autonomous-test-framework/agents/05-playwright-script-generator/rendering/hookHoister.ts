'use strict';

/**
 * @fileoverview Moves the statements every test in a spec starts with into `test.beforeEach`.
 * Purely structural: only an identical leading run of simple statements moves, so what each test does is unchanged,
 * and every test keeps at least one assertion in its own body.
 */

import * as recast from 'recast';
import { parseTypeScript } from '../../../core/automation-reviewer/ReviewRules';
import { getAssertion } from '../../../core/automation-reviewer/IntegrityRules';
import { HOOK_MIN_TESTS } from '../constants';
import { normalizeStatement } from '../validation/integrityValidator';

/** Shared hook statements and each test's remaining body (in input order). */
export interface HoistResult {
  hook: string[];
  bodies: string[];
}

const BODY_WRAPPER = '__ariaHoistBody';
const UNHOISTABLE_IDENTIFIERS: ReadonlySet<string> = new Set(['browser']);

function topLevelStatements(body: string): any[] | null {
  try {
    return parseTypeScript(`async function ${BODY_WRAPPER}() {\n${body}\n}`).program.body[0].body.body;
  } catch {
    return null;
  }
}

function usesIdentifier(node: any, names: ReadonlySet<string>): boolean {
  let found = false;
  recast.visit(node, {
    visitIdentifier(path: any) {
      if (names.has(path.node.name)) {
        found = true;
        return false;
      }
      this.traverse(path);
      return undefined;
    },
  });
  return found;
}

function hasAssertion(node: any): boolean {
  let found = false;
  recast.visit(node, {
    visitCallExpression(path: any) {
      if (getAssertion(path.node)) {
        found = true;
        return false;
      }
      this.traverse(path);
      return undefined;
    },
  });
  return found;
}

function statementKey(node: any): string {
  return normalizeStatement(recast.print(node).code);
}

function commonPrefixLength(lists: any[][]): number {
  const [first, ...rest] = lists;
  let length = 0;
  while (length < first.length && first[length].type === 'ExpressionStatement' && !usesIdentifier(first[length], UNHOISTABLE_IDENTIFIERS)) {
    const key = statementKey(first[length]);
    if (!rest.every((list) => length < list.length && statementKey(list[length]) === key)) break;
    length += 1;
  }
  return length;
}

/**
 * Splits the identical leading statements of all test bodies into a shared hook.
 * @param {string[]} bodies - Test bodies of one describe block
 * @returns {HoistResult} `hook` is empty (and bodies unchanged) when nothing can be hoisted
 */
export function hoistCommonPrefix(bodies: string[]): HoistResult {
  const unchanged: HoistResult = { hook: [], bodies };
  if (bodies.length < HOOK_MIN_TESTS) return unchanged;
  const parsed = bodies.map(topLevelStatements);
  if (parsed.some((list) => !list)) return unchanged;
  const lists = parsed as any[][];
  let length = commonPrefixLength(lists);
  while (length > 0 && lists.some((list) => !list.slice(length).some(hasAssertion))) length -= 1;
  if (length === 0) return unchanged;
  const print = (nodes: any[]) => nodes.map((node) => recast.print(node).code);
  return { hook: print(lists[0].slice(0, length)), bodies: lists.map((list) => print(list.slice(length)).join('\n')) };
}
