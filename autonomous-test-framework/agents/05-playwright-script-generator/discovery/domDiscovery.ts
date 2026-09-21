'use strict';

/**
 * @fileoverview Live DOM discovery harness. Opens the application under test with Playwright, inventories
 * interactive and assertable elements, and keeps only locators that resolve to exactly one element.
 * Application-agnostic: every application fact comes from the running application and the AUT profile.
 */

import {
  chromium, selectors, Browser, BrowserContext, Page, Locator,
} from '@playwright/test';
import { DISCOVERY_SETTINGS, DYNAMIC_ID_HEURISTICS } from '../constants';
import { ExtraLocator } from '../../../core/aut/AutProfile';
import {
  LocatorStrategy, PageElement, PageState, stateNameForPath, toCamel, uniqueName, locatorSignature,
} from './pageMap';

/** Element facts collected in the browser. */
export interface RawElement {
  tag: string;
  role?: string;
  name?: string;
  testId?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  inputType?: string;
}

/** Discovery session options (from the AUT profile). */
export interface DiscoveryOptions {
  baseURL: string;
  testIdAttribute?: string;
  dynamicIdPatterns: RegExp[];
  headless?: boolean;
  /** Profile-declared locators for elements discovery cannot identify by itself. */
  extraLocators?: ExtraLocator[];
}

/** A candidate locator. */
export interface Candidate {
  strategy: LocatorStrategy;
  args: string[];
}

const ROLE_SUFFIX: Readonly<Record<string, string>> = Object.freeze({
  button: 'Button',
  link: 'Link',
  textbox: 'Input',
  searchbox: 'Input',
  spinbutton: 'Input',
  combobox: 'Select',
  checkbox: 'Checkbox',
  radio: 'Radio',
  heading: 'Heading',
  img: 'Image',
});

/**
 * Whether a value looks auto-generated and therefore unstable.
 * @param {string} value
 * @param {RegExp[]} patterns - Profile-specific patterns
 * @returns {boolean}
 */
export function isDynamicValue(value: string, patterns: RegExp[]): boolean {
  return [...DYNAMIC_ID_HEURISTICS, ...patterns].some((pattern) => pattern.test(value));
}

/**
 * Candidate locators for an element in preference order.
 * @param {RawElement} raw
 * @param {Pick<DiscoveryOptions, 'testIdAttribute'|'dynamicIdPatterns'>} options
 * @returns {Candidate[]}
 */
export function candidateLocators(raw: RawElement, options: Pick<DiscoveryOptions, 'testIdAttribute' | 'dynamicIdPatterns'>): Candidate[] {
  const candidates: Candidate[] = [];
  if (raw.testId && options.testIdAttribute && !isDynamicValue(raw.testId, options.dynamicIdPatterns)) {
    candidates.push({ strategy: 'testId', args: [raw.testId] });
  }
  if (raw.role && raw.name) candidates.push({ strategy: 'role', args: [raw.role, raw.name] });
  if (raw.label) candidates.push({ strategy: 'label', args: [raw.label] });
  if (raw.placeholder) candidates.push({ strategy: 'placeholder', args: [raw.placeholder] });
  if (raw.text && ['button', 'link', 'heading'].includes(raw.role || '')) candidates.push({ strategy: 'text', args: [raw.text] });
  if (raw.id && !isDynamicValue(raw.id, options.dynamicIdPatterns)) candidates.push({ strategy: 'id', args: [raw.id] });
  return candidates;
}

/**
 * Escapes a CSS identifier.
 * @param {string} value
 * @returns {string}
 */
export function cssEscape(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

/**
 * Playwright locator for a candidate or page element.
 * @param {Page} page
 * @param {Candidate} candidate
 * @returns {Locator}
 */
export function toLocator(page: Page, candidate: Candidate): Locator {
  const [first, second] = candidate.args;
  switch (candidate.strategy) {
    case 'testId': return page.getByTestId(first);
    case 'role': return page.getByRole(first as any, { name: second, exact: true });
    case 'label': return page.getByLabel(first, { exact: true });
    case 'placeholder': return page.getByPlaceholder(first, { exact: true });
    case 'text': return page.getByText(first, { exact: true });
    case 'css': return page.locator(first);
    default: return page.locator(`#${cssEscape(first)}`);
  }
}

/**
 * Deterministic identifier for an element.
 * @param {RawElement} raw
 * @returns {string}
 */
export function elementBaseName(raw: RawElement): string {
  const source = raw.testId || raw.label || raw.placeholder || raw.name || raw.id || raw.tag;
  const words = source.split(/[^a-zA-Z0-9]+/).filter(Boolean).slice(0, 5);
  let base = toCamel(words.length > 0 ? words : [raw.tag]);
  if (/^[0-9]/.test(base)) base = `element${base}`;
  const suffix = raw.inputType === 'password' || (raw.tag === 'input' && !raw.role)
    ? 'Input'
    : (ROLE_SUFFIX[raw.role || ''] || 'Element');
  return base.toLowerCase().endsWith(suffix.toLowerCase()) ? base : `${base}${suffix}`;
}

/**
 * Collects element facts from the current page (runs in the browser).
 * @param {Page} page
 * @param {string} [testIdAttribute]
 * @returns {Promise<RawElement[]>}
 */
export async function collectRawElements(page: Page, testIdAttribute?: string): Promise<RawElement[]> {
  return page.evaluate(({ attr, maxText, maxElements }) => {
    const win: any = globalThis as any;
    const doc: any = win.document;
    const clean = (value: any) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
    const selector = [
      'input:not([type="hidden"])', 'textarea', 'select', 'button', 'a[href]', '[role]',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img[alt]', '[aria-live]', attr ? `[${attr}]` : '',
    ].filter(Boolean).join(',');
    const implicitRole = (el: any, tag: string, type: string): string | undefined => {
      if (el.getAttribute('role')) return el.getAttribute('role');
      if (tag === 'button' || (tag === 'input' && ['submit', 'button', 'reset'].includes(type))) return 'button';
      if (tag === 'a') return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input' && ['checkbox', 'radio'].includes(type)) return type;
      if (tag === 'input' && ['text', 'email', 'tel', 'url'].includes(type)) return 'textbox';
      if (tag === 'input' && type === 'search') return 'searchbox';
      if (tag === 'input' && type === 'number') return 'spinbutton';
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'img') return 'img';
      return undefined;
    };
    const isVisible = (el: any) => {
      const rect = el.getBoundingClientRect();
      const style = win.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const results: any[] = [];
    for (const el of Array.from(doc.querySelectorAll(selector)) as any[]) {
      if (results.length >= maxElements) break;
      const testId = attr ? clean(el.getAttribute(attr)) : '';
      if (!testId && !isVisible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const type = clean(el.getAttribute('type')).toLowerCase() || 'text';
      const role = implicitRole(el, tag, type);
      const label = clean(el.labels?.[0]?.innerText) || clean(el.getAttribute('aria-label'));
      const text = ['button', 'link', 'heading'].includes(role || '') ? clean(el.innerText || el.value).slice(0, maxText) : '';
      results.push({
        tag,
        role,
        name: label || text || clean(el.getAttribute('alt')) || undefined,
        testId: testId || undefined,
        id: clean(el.id) || undefined,
        label: label || undefined,
        placeholder: clean(el.getAttribute('placeholder')) || undefined,
        text: text || undefined,
        inputType: tag === 'input' ? type : undefined,
      });
    }
    return results;
  }, { attr: testIdAttribute || '', maxText: DISCOVERY_SETTINGS.MAX_TEXT_LENGTH, maxElements: DISCOVERY_SETTINGS.MAX_ELEMENTS_PER_STATE });
}

/** A live browser session used for discovery. */
export class DiscoverySession {
  private _context: BrowserContext;

  /** Current page. */
  page: Page;

  /** Requests the current page has started but not finished. */
  private _inFlight = 0;

  private constructor(private readonly _options: DiscoveryOptions, private readonly _browser: Browser, context: BrowserContext, page: Page) {
    this._context = context;
    this.page = page;
    this._trackRequests(page);
  }

  /**
   * Launches a browser session.
   * @param {DiscoveryOptions} options
   * @returns {Promise<DiscoverySession>}
   */
  static async open(options: DiscoveryOptions): Promise<DiscoverySession> {
    if (options.testIdAttribute) selectors.setTestIdAttribute(options.testIdAttribute);
    const browser = await chromium.launch({ headless: options.headless !== false });
    const { context, page } = await DiscoverySession._newContext(browser, options);
    return new DiscoverySession(options, browser, context, page);
  }

  private static async _newContext(browser: Browser, options: DiscoveryOptions): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ baseURL: options.baseURL, ignoreHTTPSErrors: true });
    context.setDefaultTimeout(DISCOVERY_SETTINGS.ACTION_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(DISCOVERY_SETTINGS.NAVIGATION_TIMEOUT_MS);
    return { context, page: await context.newPage() };
  }

  /** Starts a fresh browser context (clean cookies/storage). */
  async reset(): Promise<void> {
    await this._context.close();
    const { context, page } = await DiscoverySession._newContext(this._browser, this._options);
    this._context = context;
    this.page = page;
    this._trackRequests(page);
  }

  /**
   * Navigates to a relative path.
   * @param {string} pathname
   */
  async goto(pathname: string): Promise<void> {
    // 'commit', not 'load' or 'domcontentloaded': both events are gated on the parser finishing, so
    // an application served behind one large blocking script does not fire them until that script
    // has fully arrived — minutes after the page is interactive, or never on a degraded link. The
    // page would then time out with an empty map, reported as "no verifiable elements" on an
    // application that had in fact rendered. Readiness is judged by what the document contains.
    await this.page.goto(pathname, { waitUntil: 'commit' });
    await this._waitForInteractiveDom();
    await this.settle();
  }

  /**
   * Resolves once the document holds something discovery could verify, or the navigation budget
   * runs out. Bounded and non-throwing: a page that legitimately renders nothing is captured as the
   * empty state it is, and the test cases that needed an element report that precisely.
   */
  private async _waitForInteractiveDom(): Promise<void> {
    try {
      await this.page.waitForFunction(
        () => (globalThis as any).document.querySelectorAll('input, button, a, select, textarea, [role]').length > 0,
        undefined,
        { timeout: DISCOVERY_SETTINGS.NAVIGATION_TIMEOUT_MS },
      );
    } catch {
      // Nothing interactive appeared in time; capture whatever is there.
    }
  }

  /** Current URL path. */
  currentPath(): string {
    return new URL(this.page.url()).pathname;
  }

  /**
   * Waits until in-flight requests drain and the DOM stops changing (both bounded).
   *
   * A client-rendered application leaves the DOM quiet while a submit request is in flight — the button reads
   * "Signing in…" and nothing mutates — so DOM quiet alone captures the transient state instead of the one the action
   * leads to. `waitForLoadState('networkidle')` does not close the gap either: the request is dispatched a beat after
   * the click, so the idle window opens and closes before the request exists. Requests are therefore counted directly,
   * and an interaction is first given time to issue one.
   * @param {boolean} [afterInteraction] - Whether an interaction that may issue a request has just been performed
   */
  async settle(afterInteraction = false): Promise<void> {
    const deadline = Date.now() + DISCOVERY_SETTINGS.SETTLE_MAX_MS;
    try {
      if (afterInteraction) await this.page.waitForTimeout(DISCOVERY_SETTINGS.REQUEST_START_GRACE_MS);
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop -- the page is polled until it is quiet
        while (this._inFlight > 0 && Date.now() < deadline) await this.page.waitForTimeout(DISCOVERY_SETTINGS.IN_FLIGHT_POLL_MS);
        // eslint-disable-next-line no-await-in-loop
        await this._waitForDomQuiet();
        if (this._inFlight === 0) return;
      }
    } catch {
      // A navigation replaced the document while settling; wait for the new one to hold content.
      await this._waitForInteractiveDom();
    }
  }

  /** Counts requests the current page has started but not finished. */
  private _trackRequests(page: Page): void {
    this._inFlight = 0;
    const settled = () => { this._inFlight = Math.max(0, this._inFlight - 1); };
    page.on('request', () => { this._inFlight += 1; });
    page.on('requestfinished', settled);
    page.on('requestfailed', settled);
  }

  /** Resolves once the DOM has stopped mutating for a quiet window (bounded). */
  private async _waitForDomQuiet(): Promise<void> {
    await this.page.evaluate(({ quietMs, maxMs }) => new Promise<void>((resolve) => {
        const win: any = globalThis as any;
        let quietTimer: any;
        let observer: any;
        const finish = () => {
          observer?.disconnect();
          win.clearTimeout(quietTimer);
          resolve();
        };
        const hardTimer = win.setTimeout(finish, maxMs);
        const restart = () => {
          win.clearTimeout(quietTimer);
          quietTimer = win.setTimeout(() => { win.clearTimeout(hardTimer); finish(); }, quietMs);
        };
        observer = new win.MutationObserver(restart);
        observer.observe(win.document.documentElement, {
          subtree: true, childList: true, attributes: true, characterData: true,
        });
        restart();
    }), { quietMs: DISCOVERY_SETTINGS.DOM_QUIET_MS, maxMs: DISCOVERY_SETTINGS.DOM_SETTLE_MAX_MS });
  }

  /**
   * Captures the current state with verified unique locators.
   * @param {Set<string>} takenStateNames - Names used by states with other URL paths
   * @param {string} [entryPath] - Set when the state is reachable by direct navigation
   * @param {boolean} [reloadVerify] - Re-verify locators after a reload (entry states only)
   * @returns {Promise<PageState>}
   */
  async captureState(takenStateNames: Set<string>, entryPath?: string, reloadVerify = false): Promise<PageState> {
    const urlPath = this.currentPath();
    let elements = await this._verifyElements(await collectRawElements(this.page, this._options.testIdAttribute));
    elements = [...elements, ...await this._verifyExtraLocators(elements)];
    if (reloadVerify) {
      await this.page.reload({ waitUntil: 'commit' });
      await this._waitForInteractiveDom();
      await this.settle();
      const stable: PageElement[] = [];
      for (const element of elements) {
        if (await this._isUnique(element)) stable.push(element);
      }
      elements = stable;
    }
    return {
      name: stateNameForPath(urlPath, takenStateNames), urlPath, entryPath, elements,
    };
  }

  private async _isUnique(candidate: Candidate): Promise<boolean> {
    try {
      return (await toLocator(this.page, candidate).count()) === 1;
    } catch {
      return false;
    }
  }

  /** Profile-declared locators that match exactly one element in the current state (absent ones are skipped). */
  private async _verifyExtraLocators(found: PageElement[]): Promise<PageElement[]> {
    const taken = new Set(found.map((element) => element.name));
    const elements: PageElement[] = [];
    for (const extra of this._options.extraLocators || []) {
      const candidate: Candidate = { strategy: 'css', args: [extra.css] };
      // eslint-disable-next-line no-await-in-loop -- each locator is verified against the live page in turn
      if (!(await this._isUnique(candidate))) continue;
      // eslint-disable-next-line no-await-in-loop
      const tag = await toLocator(this.page, candidate).evaluate((el: any) => el.tagName.toLowerCase()).catch(() => 'element');
      const name = uniqueName(extra.name, taken);
      taken.add(name);
      elements.push({
        name, strategy: 'css', args: [extra.css], tag, ...(extra.description ? { description: extra.description } : {}),
      });
    }
    return elements;
  }

  private async _verifyElements(raws: RawElement[]): Promise<PageElement[]> {
    const taken = new Set<string>();
    const seen = new Set<string>();
    const elements: PageElement[] = [];
    for (const raw of raws) {
      for (const candidate of candidateLocators(raw, this._options)) {
        const signature = locatorSignature(candidate);
        if (seen.has(signature)) break;
        if (!(await this._isUnique(candidate))) continue;
        seen.add(signature);
        const name = uniqueName(elementBaseName(raw), taken);
        taken.add(name);
        elements.push({
          name, strategy: candidate.strategy, args: candidate.args, tag: raw.tag, role: raw.role, accessibleName: raw.name, inputType: raw.inputType,
        });
        break;
      }
    }
    return elements;
  }

  /**
   * Performs an action on a verified element.
   * @param {PageElement} element
   * @param {string} op
   * @param {string} [value]
   */
  async perform(element: PageElement, op: string, value?: string): Promise<void> {
    const locator = toLocator(this.page, element);
    const needsValue = ['fill', 'selectOption', 'press'].includes(op);
    if (needsValue && value === undefined) throw new Error(`Operation "${op}" on ${element.name} requires a value`);
    if (op === 'fill') await locator.fill(value as string);
    else if (op === 'click') await locator.click();
    else if (op === 'check') await locator.check();
    else if (op === 'uncheck') await locator.uncheck();
    else if (op === 'selectOption') await locator.selectOption(value as string);
    else if (op === 'press') await locator.press(value as string);
    else throw new Error(`Unsupported discovery operation "${op}"`);
    await this.settle(true);
  }

  /**
   * Performs a page-level navigation operation.
   * @param {string} op - reload | goBack | goForward
   */
  async performPage(op: string): Promise<void> {
    // 'commit' for the same reason as goto(): the lifecycle events are gated on a blocking script.
    if (op === 'reload') await this.page.reload({ waitUntil: 'commit' });
    else if (op === 'goBack') await this.page.goBack({ waitUntil: 'commit' });
    else if (op === 'goForward') await this.page.goForward({ waitUntil: 'commit' });
    if (['reload', 'goBack', 'goForward'].includes(op)) await this._waitForInteractiveDom();
    else throw new Error(`Unsupported page operation "${op}"`);
    await this.settle();
  }

  /** Closes the browser. */
  async close(): Promise<void> {
    await this._browser.close();
  }
}
