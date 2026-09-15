'use strict';

/**
 * @fileoverview SQLite Database Wrapper for ARIA State Management.
 * Uses better-sqlite3 for high-performance synchronous-style I/O with async safety.
 *
 * @module Database
 * @version 1.0.0
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../logger/Logger';

const logger = new Logger('Database');
const DB_PATH = path.resolve(__dirname, '../../.state/pipeline-state.db');

export class StateDatabase {
  private _db: Database.Database | null;
  private _initialized: boolean;

  constructor() {
    this._db = null;
    this._initialized = false;
  }

  /**
   * Initializes the database and creates tables if they don't exist.
   */
  initialize(): void {
    if (this._initialized) return;

    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    try {
      this._db = new Database(DB_PATH);
      this._db.pragma('journal_mode = WAL'); // High concurrency mode

      this._createTables();
      this._initialized = true;
      logger.info('SQLite Database initialized', { path: DB_PATH });
    } catch (error: any) {
      logger.error('Failed to initialize SQLite Database', { error: error.message });
      throw error;
    }
  }

  /**
   * @private
   */
  private _createTables(): void {
    if (!this._db) return;

    // Runs table: Tracks global state of a test run
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        project_id TEXT,
        version TEXT,
        started_at TEXT,
        updated_at TEXT,
        current_stage TEXT,
        global_status TEXT
      )
    `);

    // Stages table: Tracks status and output of each stage
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS stages (
        run_id TEXT,
        stage_id TEXT,
        status TEXT,
        output TEXT, -- JSON string
        approval TEXT,
        attempts INTEGER DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        approved_at TEXT,
        rejection_reason TEXT,
        error TEXT, -- JSON string
        usage TEXT, -- JSON string
        PRIMARY KEY (run_id, stage_id),
        FOREIGN KEY (run_id) REFERENCES runs (run_id)
      )
    `);

    // Artifacts table: Stores specific pipeline outputs (requirements, scripts, etc.)
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        run_id TEXT,
        key TEXT,
        value TEXT, -- JSON string
        PRIMARY KEY (run_id, key),
        FOREIGN KEY (run_id) REFERENCES runs (run_id)
      )
    `);

    // Clarifications table: Tracks agent questions
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS clarifications (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        stage_id TEXT,
        question TEXT,
        status TEXT,
        asked_at TEXT,
        answer TEXT,
        answered_at TEXT,
        FOREIGN KEY (run_id) REFERENCES runs (run_id)
      )
    `);

    // Project clarifications: questions routed to the stage that owns the answer, kept across pipeline runs
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS project_clarifications (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        source_stage TEXT NOT NULL,
        owning_stage TEXT NOT NULL,
        kind TEXT NOT NULL,
        rule_id TEXT,
        tc_key TEXT,
        feature_id TEXT,
        requirement_ref TEXT,
        question TEXT NOT NULL,
        context_json TEXT,
        status TEXT NOT NULL,
        answer TEXT,
        answered_by TEXT,
        ask_rounds INTEGER NOT NULL DEFAULT 1,
        subject_hash TEXT,
        raised_run_id TEXT,
        last_seen_run_id TEXT,
        asked_at TEXT NOT NULL,
        answered_at TEXT,
        UNIQUE (project_id, dedupe_key)
      )
    `);

    // Errors/Warnings log table
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT,
        stage_id TEXT,
        level TEXT, -- ERROR, WARNING
        message TEXT,
        timestamp TEXT,
        FOREIGN KEY (run_id) REFERENCES runs (run_id)
      )
    `);

    // Migration: Add usage column to stages if it doesn't exist
    this._migrate();
  }

  /**
   * @private
   */
  private _migrate(): void {
    if (!this._db) return;

    try {
      const stageTableInfo = this._db.prepare("PRAGMA table_info(stages)").all() as any[];
      const hasUsage = stageTableInfo.some(col => col.name === 'usage');
      if (!hasUsage) {
        this._db.exec("ALTER TABLE stages ADD COLUMN usage TEXT");
        logger.info('Migrated stages table: Added usage column');
      }
    } catch (error: any) {
      logger.error('Migration failed', { error: error.message });
    }
  }

  /**
   * Executes a statement with parameters.
   */
  prepare(sql: string): Database.Statement {
    if (!this._db) throw new Error('Database not initialized');
    return this._db.prepare(sql);
  }

  /**
   * Closes the database connection.
   */
  close(): void {
    if (this._db) {
      this._db.close();
      this._initialized = false;
    }
  }

  /**
   * Runs a transaction.
   */
  transaction(fn: (...args: any[]) => any): Database.Transaction {
    if (!this._db) throw new Error('Database not initialized');
    return this._db.transaction(fn);
  }
}

export const stateDb = new StateDatabase();

