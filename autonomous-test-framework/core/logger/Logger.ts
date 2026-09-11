'use strict';

/**
 * @fileoverview Structured JSON Logger for the ARIA Framework.
 * Outputs machine-readable log lines with level, timestamp,
 * component, and contextual metadata.
 *
 * @module Logger
 * @version 1.0.0
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
const LOG_DIR = path.resolve(__dirname, '../../.logs');
const LOG_FILE = path.join(LOG_DIR, `framework-${new Date().toISOString().slice(0, 10)}.log`);

const COLORS: Record<string, string> = {
  debug: '\x1b[36m',  // Cyan
  info:  '\x1b[32m',  // Green
  warn:  '\x1b[33m',  // Yellow
  error: '\x1b[31m',  // Red
  fatal: '\x1b[35m',  // Magenta
  reset: '\x1b[0m',
};

interface LoggerOptions {
  level?: LogLevel;
  colorize?: boolean;
  writeToFile?: boolean;
}

// ─── Logger Class ─────────────────────────────────────────────────────────────

/**
 * @class Logger
 * @description Structured logger with console + file output.
 */
export class Logger {
  private _component: string;
  private _minLevel: number;
  private _colorize: boolean;
  private _writeFile: boolean;

  /**
   * @param {string} component - Name of the component using this logger
   * @param {LoggerOptions} [options]
   */
  constructor(component: string, options: LoggerOptions = {}) {
    this._component = component;
    const defaultLevel = (process.env.FRAMEWORK_LOG_LEVEL as LogLevel) || 'info';
    this._minLevel = LOG_LEVELS[options.level || defaultLevel] ?? 1;
    this._colorize = options.colorize !== false;
    this._writeFile = options.writeToFile !== false;

    if (this._writeFile && !fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  // ── Level Methods ────────────────────────────────────────────────────────

  debug(message: string, meta: Record<string, any> = {}): void { this._log('debug', message, meta); }
  info(message: string, meta: Record<string, any> = {}): void { this._log('info', message, meta); }
  warn(message: string, meta: Record<string, any> = {}): void { this._log('warn', message, meta); }
  error(message: string, meta: Record<string, any> = {}): void { this._log('error', message, meta); }
  fatal(message: string, meta: Record<string, any> = {}): void { this._log('fatal', message, meta); }

  /**
   * Logs a stage lifecycle event in a standardized format.
   * @param {string} event - Lifecycle event name
   * @param {string} stageId - Stage identifier
   * @param {Record<string, any>} [meta] - Additional metadata
   */
  stage(event: string, stageId: string, meta: Record<string, any> = {}): void {
    this._log('info', `[STAGE:${event.toUpperCase()}] ${stageId}`, { stageId, event, ...meta });
  }

  /**
   * Logs an agent clarification request.
   * @param {string} stageId - The asking agent
   * @param {string} question - The question text
   */
  clarification(stageId: string, question: string): void {
    this._log('warn', `[CLARIFICATION] ${stageId}`, { stageId, question });
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /** @private */
  private _log(level: LogLevel, message: string, meta: Record<string, any> = {}): void {
    if (LOG_LEVELS[level] < this._minLevel) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      component: this._component,
      message,
      ...meta,
    };

    // Console output
    const color = this._colorize ? (COLORS[level] || '') : '';
    const reset = this._colorize ? COLORS.reset : '';
    const prefix = `${color}[${entry.level.padEnd(5)}]${reset}`;
    const ts = `\x1b[90m${entry.timestamp}\x1b[0m`;
    const comp = `\x1b[90m[${this._component}]\x1b[0m`;

    const metaStr = Object.keys(meta).length > 0
      ? ` ${JSON.stringify(meta)}`
      : '';

    console.log(`${ts} ${prefix} ${comp} ${message}${metaStr}`);

    // File output
    if (this._writeFile) {
      try {
        fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
      } catch {
        // Silently fail file logging — never crash the framework for logging
      }
    }
  }
}

