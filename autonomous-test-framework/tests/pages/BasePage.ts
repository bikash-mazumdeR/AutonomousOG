'use strict';

/**
 * @fileoverview BasePage — Base Page Object for all ARIA-generated POMs.
 * Provides shared navigation, waiting, screenshot, network capture,
 * and assertion utilities inherited by every feature page object.
 *
 * @module BasePage
 * @version 1.1.0
 */

import * as path from 'path';
import * as fs from 'fs';
import { stateManager } from '../../core/state-manager/StateManager';
import { Page, Locator, Response, expect } from '@playwright/test';

const SCREENSHOT_DIR  = path.resolve(__dirname, '../../reports/attachments/screenshots');
const NETWORK_LOG_DIR = path.resolve(__dirname, '../../reports/attachments/network-logs');
const CONSOLE_LOG_DIR = path.resolve(__dirname, '../../reports/attachments/console-logs');

export class BasePage {
  public page: Page;
  protected _name: string;
  private _network: any[];
  private _console: string[];

  /**
   * @param {Page} page - Playwright page instance
   * @param {string} [pageName='BasePage'] - Identifier for logging
   */
  constructor(page: Page, pageName: string = 'BasePage') {
    this.page     = page;
    this._name    = pageName;
    this._network = [];
    this._console = [];
    this._ensureDirs();
    this._attachCaptures();
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  /**
   * Navigates and returns as soon as the navigation commits.
   *
   * Not 'domcontentloaded' or 'load': both wait for the parser to finish, so an application served
   * behind one large blocking script does not fire them until that script has fully arrived —
   * long after the page is usable, or never on a degraded link, failing the test as a navigation
   * timeout rather than reporting the slow asset it is. Nothing is lost by committing early:
   * locator actions and web-first assertions auto-wait for the elements they name.
   */
  async navigate(url: string): Promise<void> {
    await this._logAction(`[NAVIGATE] → ${url}`);
    await this.page.goto(url, { waitUntil: 'commit' });
  }

  async reload(): Promise<void> {
    await this._logAction('[RELOAD] Page refresh');
    await this.page.reload({ waitUntil: 'commit' });
  }

  async goBack(): Promise<void> {
    await this._logAction('[NAVIGATE] History back');
    await this.page.goBack({ waitUntil: 'domcontentloaded' });
  }

  // ── Waiting ──────────────────────────────────────────────────────────────

  async waitForVisible(locator: Locator, timeoutMs: number = 10000): Promise<void> {
    const desc = await this._getLocatorDesc(locator);
    await this._logAction(`[WAIT] Visibility: ${desc}`);
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
  }

  async waitForURL(urlPattern: string | RegExp, timeoutMs: number = 15000): Promise<void> {
    await this._logAction(`[WAIT] URL Match: ${urlPattern}`);
    await this.page.waitForURL(urlPattern, { timeout: timeoutMs });
  }

  async waitForResponse(urlPattern: string | RegExp, timeoutMs: number = 15000): Promise<Response> {
    await this._logAction(`[WAIT] Network Response: ${urlPattern}`);
    return this.page.waitForResponse(urlPattern, { timeout: timeoutMs });
  }

  async waitForLoad(state: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle'): Promise<void> {
    await this._logAction(`[WAIT] Load State: ${state}`);
    await this.page.waitForLoadState(state);
  }

  // ── Interactions ─────────────────────────────────────────────────────────

  async safeClick(locator: Locator): Promise<void> {
    await this.waitForVisible(locator);
    const desc = await this._getLocatorDesc(locator);
    await this._logAction(`[CLICK] ${desc}`);
    await locator.click();
  }

  async safeFill(locator: Locator, value: string): Promise<void> {
    await this.waitForVisible(locator);
    const desc = await this._getLocatorDesc(locator);
    const isSecret = /password|token|secret|key/i.test(desc) || /password|token|secret|key/i.test(value);
    await this._logAction(`[FILL] ${desc} ➔ ${isSecret ? '********' : value}`);
    await locator.clear();
    await locator.fill(String(value));
  }

  async safeSelect(locator: Locator, value: string): Promise<void> {
    await this.waitForVisible(locator);
    const desc = await this._getLocatorDesc(locator);
    await this._logAction(`[SELECT] ${desc} ➔ ${value}`);
    await locator.selectOption(value);
  }

  async uploadFile(locator: Locator, filePath: string): Promise<void> {
    const desc = await this._getLocatorDesc(locator);
    await this._logAction(`[UPLOAD] ${desc} ➔ ${path.basename(filePath)}`);
    await locator.setInputFiles(filePath);
  }

  async scrollIntoView(locator: Locator): Promise<void> {
    const desc = await this._getLocatorDesc(locator);
    await this._logAction(`[SCROLL] ${desc}`);
    await locator.scrollIntoViewIfNeeded();
  }

  /**
   * Logs an action breadcrumb to the central database.
   * @private
   */
  async _logAction(message: string): Promise<void> {
    try {
      const stageId = process.env.ARIA_CURRENT_STAGE || '07-test-runner';
      // We use the singleton stateManager which is now TS
      await stateManager.logBreadcrumb(stageId, `[${this._name}] ${message}`);
    } catch {
      // Non-blocking
    }
  }

  private async _getLocatorDesc(locator: Locator): Promise<string> {
    try {
      // Internal Playwright property to get selector string
      return (locator as any)._selector || 'unknown-locator';
    } catch {
      return 'locator';
    }
  }

  // ── Assertions ───────────────────────────────────────────────────────────

  async assertVisible(locator: Locator, message?: string): Promise<void> {
    const desc = await this._getLocatorDesc(locator);
    await this._logAction(`[ASSERT] Visible: ${desc}`);
    await expect(locator, message).toBeVisible();
  }

  async assertHidden(locator: Locator): Promise<void> {
    const desc = await this._getLocatorDesc(locator);
    await this._logAction(`[ASSERT] Hidden: ${desc}`);
    await expect(locator).toBeHidden();
  }

  async assertText(locator: Locator, text: string | RegExp): Promise<void> {
    const desc = await this._getLocatorDesc(locator);
    await this._logAction(`[ASSERT] Text: ${desc} contains "${text}"`);
    await expect(locator).toContainText(text);
  }

  async assertURL(pattern: string | RegExp): Promise<void> {
    await this._logAction(`[ASSERT] URL matches ${pattern}`);
    await expect(this.page).toHaveURL(pattern);
  }

  async assertTitle(title: string | RegExp): Promise<void> {
    await this._logAction(`[ASSERT] Title matches "${title}"`);
    await expect(this.page).toHaveTitle(title);
  }

  // ── Screenshot ───────────────────────────────────────────────────────────

  async takeScreenshot(tcKey: string): Promise<string> {
    const filename = `${tcKey}-${Date.now()}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);

    await this.page.screenshot({
      path:      filepath,
      fullPage:  false,
    });

    await this._logAction(`[SCREENSHOT] Saved to ${filename}`);
    return filepath;
  }

  // ── Network & Console Capture ────────────────────────────────────────────

  async saveNetworkLog(tcKey: string): Promise<string> {
    const filename = `${tcKey}-${Date.now()}.json`;
    const filepath = path.join(NETWORK_LOG_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(this._network, null, 2), 'utf-8');
    return filepath;
  }

  async saveConsoleLog(tcKey: string): Promise<string> {
    const filename = `${tcKey}-${Date.now()}.log`;
    const filepath = path.join(CONSOLE_LOG_DIR, filename);
    fs.writeFileSync(filepath, this._console.join('\\n'), 'utf-8');
    return filepath;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _attachCaptures(): void {
    this.page.on('request', (req) => {
      this._network.push({
        type:      'request',
        timestamp: new Date().toISOString(),
        method:    req.method(),
        url:       req.url(),
      });
    });

    this.page.on('response', (res) => {
      if (res.status() >= 400) {
        this._logAction(`[NETWORK_ERROR] ${res.status()} ${res.url()}`);
      }
    });

    this.page.on('console', (msg) => {
      const txt = msg.text();
      this._console.push(`[${msg.type().toUpperCase()}] ${new Date().toISOString()} ${txt}`);
      if (msg.type() === 'error') {
        this._logAction(`[BROWSER_CONSOLE_ERROR] ${txt.slice(0, 100)}`);
      }
    });

    this.page.on('pageerror', (err) => {
      this._console.push(`[PAGE_ERROR] ${new Date().toISOString()} ${err.message}`);
      this._logAction(`[BROWSER_CRASH] ${err.message}`);
    });
  }

  private _ensureDirs(): void {
    [SCREENSHOT_DIR, NETWORK_LOG_DIR, CONSOLE_LOG_DIR].forEach((dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }
}

