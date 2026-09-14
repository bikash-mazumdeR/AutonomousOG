'use strict';

/**
 * @fileoverview Shared Agent 05 types for LLM interaction.
 */

/** Chat message in the LLMClient format. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Sends messages to the LLM and resolves with the response text. Injected so logic is testable offline. */
export type ChatFn = (messages: ChatMessage[], options?: { json?: boolean }) => Promise<string>;
