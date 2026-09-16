/**
 * @fileoverview Unit tests for profile-declared extra locators: schema validation and page-object rendering.
 */

import { validateAutProfile } from '../../core/aut/AutProfile';
import { locatorExpression } from '../../agents/05-playwright-script-generator/rendering/pomRenderer';
import { mergeState, PageMap } from '../../agents/05-playwright-script-generator/discovery/pageMap';

const profile = (extraLocators?: unknown) => ({
  projectId: 'demo',
  displayName: 'Demo',
  baseUrlEnv: 'AUT_BASE_URL',
  browsers: ['chromium'],
  discovery: {
    entryPaths: ['/'], maxDepth: 2, executeTestSteps: true, ...(extraLocators === undefined ? {} : { extraLocators }),
  },
  auth: { strategy: 'none' },
  secretsEnvVars: [],
  couplingGuardTokens: [],
});

describe('AUT profile — discovery.extraLocators', () => {
  it('is optional and accepts named CSS locators with a description', () => {
    expect(validateAutProfile(profile())).toEqual([]);
    expect(validateAutProfile(profile([
      { name: 'bannerContainer', css: '.banner', description: 'banner that carries the colour' },
      { name: 'fieldIcon', css: '.group:has(input) svg.icon' },
    ]))).toEqual([]);
  });

  it('rejects malformed entries', () => {
    expect(validateAutProfile(profile({}))).toEqual(['discovery.extraLocators must be an array']);
    const errors = validateAutProfile(profile([
      { name: 'Banner', css: '.banner' },
      { name: 'icon', css: '  ' },
      { name: 'icon', css: '.icon', description: 42 },
    ]));
    expect(errors).toEqual([
      'discovery.extraLocators[0].name must be a camelCase identifier',
      'discovery.extraLocators[1].css must be a non-empty CSS selector',
      'discovery.extraLocators[2].name "icon" is declared twice',
      'discovery.extraLocators[2].description must be a string',
    ]);
  });
});

describe('Page map and page object — css locators', () => {
  it('renders a css element as page.locator with the selector verbatim', () => {
    expect(locatorExpression({ strategy: 'css', args: ['.group:has([data-test="user"]) svg.icon'] }))
      .toBe('this.page.locator(".group:has([data-test=\\"user\\"]) svg.icon")');
    expect(locatorExpression({ strategy: 'id', args: ['main'] })).toBe('this.page.locator("#main")');
  });

  it('keeps a css element captured only in a later visit of the same state', () => {
    const map: PageMap = {
      version: 2, featureId: 'F-01', states: [], traces: [], flows: [],
    } as PageMap;
    mergeState(map, { name: 'start', urlPath: '/', elements: [{ name: 'submitButton', strategy: 'testId', args: ['submit'], tag: 'button' }] });
    const merged = mergeState(map, {
      name: 'start',
      urlPath: '/',
      elements: [
        { name: 'submitButton', strategy: 'testId', args: ['submit'], tag: 'button' },
        { name: 'fieldIcon', strategy: 'css', args: ['svg.icon'], tag: 'svg', description: 'icon in the field' },
      ],
    });
    expect(merged.elements.map((e) => e.name)).toEqual(['submitButton', 'fieldIcon']);
    expect(merged.elements[1]).toMatchObject({ strategy: 'css', description: 'icon in the field' });
  });
});
