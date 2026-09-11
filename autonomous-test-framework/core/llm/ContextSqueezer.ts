'use strict';

/**
 * @fileoverview Context Squeezer utility for the ARIA Framework.
 * Compresses large text inputs using LLM-based summarization to fit into context windows.
 *
 * @module ContextSqueezer
 * @version 1.0.0
 */

import { llmClient } from './LLMClient';
import { Logger } from '../logger/Logger';

const logger = new Logger('ContextSqueezer');

// Approximate character to token ratio is 4:1. 
// 50,000 chars is roughly 12,500 tokens.
const MAX_CHARS_BEFORE_SQUEEZE = 50000;
const CHUNK_SIZE = 40000;

export class ContextSqueezer {
  /**
   * Squeezes the input text if it's too large.
   * @param {string} text - Raw input text.
   * @param {string} contextName - Human-readable name for logging.
   * @returns {Promise<string>} Squeezed text.
   */
  async squeeze(text: string, contextName: string = 'Input'): Promise<string> {
    if (text.length <= MAX_CHARS_BEFORE_SQUEEZE) {
      return text;
    }

    logger.info(`Context for "${contextName}" too large (${text.length} chars). Squeezing...`);

    const chunks = this._splitIntoChunks(text, CHUNK_SIZE);
    const summaries: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      logger.info(`Summarizing chunk ${i + 1}/${chunks.length} for ${contextName}`);
      
      const summary = await llmClient.chat('system-utility', {
        messages: [
          {
            role: 'system',
            content: 'You are a technical context squeezer. Your job is to summarize the following requirement/technical documentation into a concise, information-dense summary. Preserve all specific business rules, feature names, state names, and unique identifiers. Remove conversational fluff.'
          },
          {
            role: 'user',
            content: chunks[i]
          }
        ],
        temperature: 0.1, // Very low for high fidelity
        max_tokens: 2000
      });
      
      summaries.push(summary.text);
    }

    const finalResult = `[SQUEEZED CONTEXT FOR ${contextName.toUpperCase()}]\n\n${summaries.join('\n\n')}`;
    logger.info(`Squeeze complete for ${contextName}. Original: ${text.length} chars, Squeezed: ${finalResult.length} chars.`);

    return finalResult;
  }

  /**
   * @private
   */
  private _splitIntoChunks(text: string, size: number): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + size));
      i += size;
    }
    return chunks;
  }
}

export const contextSqueezer = new ContextSqueezer();

