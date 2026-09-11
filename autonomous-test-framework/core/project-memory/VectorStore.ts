'use strict';

/**
 * @fileoverview Vector Storage Engine for the ARIA Framework.
 * Uses LanceDB (embedded) for semantic memory storage and retrieval.
 *
 * @module VectorStore
 * @version 1.0.0
 */

import * as lancedb from 'vectordb';
import * as path from 'path';
import * as fs from 'fs';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { llmClient } from '../llm/LLMClient';
import { Logger } from '../logger/Logger';

const logger = new Logger('VectorStore');
const TABLE_NAME = 'memory_records';

export class VectorStore {
  private _db: lancedb.Connection | null;
  private _table: lancedb.Table | null;
  private _dbPath: string;
  private _initialized: boolean;

  constructor() {
    this._db = null;
    this._table = null;
    this._dbPath = path.resolve((FRAMEWORK_CONFIG as any).vectorDbPath || './.state/lancedb');
    this._initialized = false;
  }

  /**
   * Initializes the vector database and ensures the table exists.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    try {
      if (!fs.existsSync(this._dbPath)) {
        fs.mkdirSync(this._dbPath, { recursive: true });
      }

      this._db = await lancedb.connect(this._dbPath);
      
      const tableNames = await this._db.tableNames();
      if (!tableNames.includes(TABLE_NAME)) {
        logger.info('Creating new Vector DB table', { table: TABLE_NAME });
        // Create table with an initial dummy record to define schema
        const initialData = [{
          id: 'schema_init',
          vector: Array(1536).fill(0),
          text: 'initialization',
          type: 'system',
          metadata: JSON.stringify({}),
          timestamp: new Date().toISOString()
        }];
        this._table = await this._db.createTable(TABLE_NAME, initialData);
      } else {
        this._table = await this._db.openTable(TABLE_NAME);
      }

      this._initialized = true;
      logger.info('VectorStore initialized', { path: this._dbPath });
    } catch (error: any) {
      logger.error('Failed to initialize VectorStore', { error: error.message });
      throw error;
    }
  }

  /**
   * Adds a text record to the vector database.
   * @param {string} id - Unique identifier.
   * @param {string} text - Text to embed and store.
   * @param {string} type - Category (e.g., 'failure', 'healing', 'rule').
   * @param {Object} metadata - Additional context.
   */
  async addRecord(id: string, text: string, type: string, metadata: Record<string, any> = {}): Promise<void> {
    if (!this._initialized) await this.initialize();
    if (!this._table) return;

    try {
      const vector = await llmClient.createEmbedding(text);
      const record = {
        id,
        vector,
        text,
        type,
        metadata: JSON.stringify(metadata),
        timestamp: new Date().toISOString()
      };

      await this._table.add([record]);
      logger.info('Record added to Vector DB', { id, type });
    } catch (error: any) {
      logger.error('Failed to add record to Vector DB', { id, error: error.message });
    }
  }

  /**
   * Performs a semantic similarity search.
   * @param {string} queryText - The text to search for.
   * @param {number} [limit=3] - Max results to return.
   * @param {string} [type] - Optional filter by type.
   * @returns {Promise<Array>} List of similar records.
   */
  async search(queryText: string, limit: number = 3, type: string | null = null): Promise<any[]> {
    if (!this._initialized) await this.initialize();
    if (!this._table) return [];

    try {
      const queryVector = await llmClient.createEmbedding(queryText);
      let queryBuilder = this._table.search(queryVector).limit(limit);
      
      if (type) {
        // Sanitize to prevent SQL injection — only allow safe characters
        const safeType = type.replace(/[^a-zA-Z0-9_\-]/g, '');
        queryBuilder = queryBuilder.where(`type = '${safeType}'`);
      }

      const results = await queryBuilder.execute();
      
      return results.map((r: any) => ({
        id: r.id,
        text: r.text,
        type: r.type,
        metadata: JSON.parse(r.metadata),
        score: (r as any)._distance // LanceDB returns L2 distance (lower is better)
      })).filter((r: any) => r.id !== 'schema_init');

    } catch (error: any) {
      logger.error('Vector search failed', { error: error.message });
      return [];
    }
  }
}

export const vectorStore = new VectorStore();

