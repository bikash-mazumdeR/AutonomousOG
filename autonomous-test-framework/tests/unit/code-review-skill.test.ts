/**
 * @fileoverview Guards the Agent 06 review guidance against advice that contradicts the Agent 05 contract
 * (which previously made Agents 05 and 06 reject each other's output).
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf-8');

describe('Agent 06 review guidance matches the Agent 05 contract', () => {
  const guidance = `${read('skills/code-review.md')}\n${read('agents/06-automation-reviewer/learnings/reviewer-learnings.md')}`;

  it.each([
    'testData.baseURL',
    'sleep(1)',
    "waitForLoadState('networkidle')",
    'Action methods exist for all interactions',
    'try/catch on API',
    'afterEach takes screenshot',
    '.first()',
    'test.skip(true',
    'bg.includes(',
    'AUTO-PATCH',
  ])('does not recommend "%s"', (phrase) => {
    expect(guidance).not.toContain(phrase);
  });

  it('keeps LLM findings advisory so only deterministic rules can reject', () => {
    expect(guidance).toMatch(/capped at MAJOR/);
  });
});
