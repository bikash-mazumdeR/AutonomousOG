'use strict';

/**
 * @fileoverview GET /api/agent0N/prompt-trace for the stages that record a shared stage prompt trace (Agents 03-06):
 * what the stage's LLM was given on its latest run (or why it made no call), every call, and the provider-reported
 * usage behind the token card. Served by the hub (agent01-ui-server) and by each agent's standalone server.
 *
 * @module promptTraceRoutes
 */

import { Express, Request, Response } from 'express';

import { stateManager } from '../core/state-manager/StateManager';
import { PipelineArtifacts } from '../core/types';

/** URL prefix → pipeline artifact holding that stage's latest trace. */
export const PROMPT_TRACE_ARTIFACTS: Readonly<Record<string, keyof PipelineArtifacts>> = Object.freeze({
  agent03: 'agent03PromptTrace',
  agent04: 'agent04PromptTrace',
  agent05: 'agent05PromptTrace',
  agent06: 'agent06PromptTrace',
});

/**
 * Registers the prompt-trace routes.
 * @param {Express} app
 * @param {string[]} [prefixes] - Limit to some agents (a standalone server registers only its own)
 */
export function registerPromptTraceRoutes(app: Express, prefixes: string[] = Object.keys(PROMPT_TRACE_ARTIFACTS)): void {
  for (const prefix of prefixes) {
    const artifactKey = PROMPT_TRACE_ARTIFACTS[prefix];
    app.get(`/api/${prefix}/prompt-trace`, async (_req: Request, res: Response) => {
      try {
        if (!(stateManager as any)._initialized) {
          try { await stateManager.initialize(); } catch (_) { /* fall through to the lookup */ }
        }
        const trace = await stateManager.getPipelineArtifact(artifactKey);
        if (!trace) return res.status(404).json({ error: 'No prompt trace yet — run this agent to record one.' });
        return res.json(trace);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    });
  }
}
