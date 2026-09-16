'use strict';

/**
 * @fileoverview Shared building blocks for ARIA agent UI servers.
 *
 * The Agent 01-05 servers each copy-paste their own spawn handler, SSE registry, approval proxy and
 * path allowlist. This module factors those out for the Agent 06 and 07 servers (and for the hub,
 * ui/agent01-ui-server.ts, which mounts every agent's routes). It follows the registrar precedent
 * already set by pipelineRoutes.ts, agent03ReviewRoutes.ts and agent04DataRoutes.ts.
 *
 * Three deliberate improvements over the copy-pasted originals:
 *   1. Approval requests carry `stageId`, which ApprovalGate requires — without it the gate 400s and
 *      the direct-StateManager fallback marks the stage approved while the agent stays blocked on
 *      readline forever.
 *   2. Child output is decoded with StringDecoder and split on a residual buffer, so a line is never
 *      torn across chunk boundaries and a multi-byte character is never split mid-sequence.
 *   3. The log stream keeps a bounded ring buffer and replays it to each new client, so refreshing
 *      the page mid-run rebuilds the console instead of showing an empty pane.
 *
 * @module agentServerKit
 */

import { Express, Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import * as http from 'http';
import path from 'path';

import { stateManager } from '../core/state-manager/StateManager';
import { stateDb } from '../core/state-manager/Database';
import { memoryEngine } from '../core/project-memory/MemoryEngine';
import { Logger } from '../core/logger/Logger';

/** Framework root (the parent of ui/). */
export const FRAMEWORK_DIR = path.resolve(__dirname, '..');

/** Events replayed to a client that connects part-way through a run. */
const RING_BUFFER_LIMIT = 2000;

/** Keeps proxies and browsers from closing an idle SSE connection. */
const HEARTBEAT_MS = 20000;

/** Approval webhook the running agent opens while its gate is blocking. */
const APPROVAL_PORT = parseInt(process.env.APPROVAL_WEBHOOK_PORT || '8081', 10);

/** SQL for the newest non-test pipeline run. */
const LATEST_RUN_SQL = "SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A structured event pushed to SSE clients. */
export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

/** A log stream with replay. */
export interface LogStream {
  /** Sends an event to every connected client and records it for replay. */
  broadcast(event: StreamEvent): void;
  /** Sends an event without recording it (heartbeats, connection acks). */
  emitEphemeral(event: StreamEvent): void;
  /** Attaches an SSE response, replaying buffered events first. */
  attach(req: Request, res: Response): void;
  /** Drops all buffered events — call when a new run starts. */
  reset(): void;
}

/** Spawns and supervises a single agent process. */
export interface AgentRunner {
  isRunning(): boolean;
  /** Kills any in-flight run, then starts a new one. */
  start(args: string[]): ChildProcess;
  stop(): void;
}

// ─── Line decoding ────────────────────────────────────────────────────────────

/**
 * Builds a chunk-to-lines decoder that preserves blank lines and never splits a multi-byte
 * character or a line across chunk boundaries.
 *
 * Blank lines matter: the ApprovalGate banner is newline- and box-drawing-heavy, and the naive
 * `chunk.toString().split('\n').filter(Boolean)` used elsewhere mangles it.
 *
 * @returns {{push: (chunk: Buffer) => string[], flush: () => string[]}}
 */
export function createLineSplitter(): { push: (chunk: Buffer) => string[]; flush: () => string[] } {
  const decoder = new StringDecoder('utf8');
  let residual = '';

  return {
    push(chunk: Buffer): string[] {
      const lines = (residual + decoder.write(chunk)).split('\n');
      residual = lines.pop() ?? ''; // trailing partial line, completed by a later chunk
      return lines;
    },
    flush(): string[] {
      const tail = residual + decoder.end();
      residual = '';
      return tail ? [tail] : [];
    },
  };
}

// ─── Log stream ───────────────────────────────────────────────────────────────

/**
 * Creates an SSE log stream with a bounded replay buffer.
 * @returns {LogStream}
 */
export function createLogStream(): LogStream {
  const clients = new Set<Response>();
  let buffer: StreamEvent[] = [];

  const write = (client: Response, event: StreamEvent): void => {
    try {
      client.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      clients.delete(client);
    }
  };

  return {
    broadcast(event: StreamEvent): void {
      buffer.push(event);
      if (buffer.length > RING_BUFFER_LIMIT) buffer = buffer.slice(-RING_BUFFER_LIMIT);
      clients.forEach((client) => write(client, event));
    },

    emitEphemeral(event: StreamEvent): void {
      clients.forEach((client) => write(client, event));
    },

    attach(req: Request, res: Response): void {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      clients.add(res);
      write(res, { type: 'connected', replayed: buffer.length });
      // Replay so a mid-run refresh rebuilds the console and the progress grid.
      buffer.forEach((event) => write(res, event));

      const heartbeat = setInterval(() => write(res, { type: 'heartbeat' }), HEARTBEAT_MS);
      req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
    },

    reset(): void {
      buffer = [];
    },
  };
}

// ─── Agent process runner ─────────────────────────────────────────────────────

/**
 * Creates a runner that spawns one agent via ts-node and streams its output.
 *
 * @param {Object} options
 * @param {string} options.agentPath - Absolute path to the agent's agent.ts
 * @param {LogStream} options.logStream - Stream to publish stdout/stderr and the exit event on
 * @param {Logger} options.logger
 * @param {(line: string) => StreamEvent | null} [options.onLine] - Maps a raw line to a custom
 *   event; return null to emit the default `log` event.
 * @returns {AgentRunner}
 */
export function createAgentRunner(options: {
  agentPath: string;
  logStream: LogStream;
  logger: Logger;
  onLine?: (line: string) => StreamEvent | null;
}): AgentRunner {
  const {
    agentPath, logStream, logger, onLine,
  } = options;
  let active: ChildProcess | null = null;

  const publish = (line: string, level: 'info' | 'error'): void => {
    const custom = onLine?.(line);
    logStream.broadcast(custom || { type: 'log', level, message: line });
  };

  const pipe = (stream: NodeJS.ReadableStream | null, level: 'info' | 'error'): void => {
    if (!stream) return;
    const splitter = createLineSplitter();
    stream.on('data', (chunk: Buffer) => splitter.push(chunk).forEach((line) => publish(line, level)));
    stream.on('end', () => splitter.flush().forEach((line) => publish(line, level)));
  };

  return {
    isRunning: () => active !== null,

    start(args: string[]): ChildProcess {
      this.stop();
      logStream.reset();

      const child = spawn(process.execPath, ['-r', 'ts-node/register', agentPath, ...args], {
        cwd: FRAMEWORK_DIR,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      active = child;

      pipe(child.stdout, 'info');
      pipe(child.stderr, 'error');

      child.on('close', (code: number) => {
        logger.info('Agent process exited', { agentPath, code });
        active = null;
        logStream.broadcast({ type: 'exit', code });
      });

      child.on('error', (err: Error) => {
        logger.error('Agent process failed to spawn', { agentPath, error: err.message });
        active = null;
        logStream.broadcast({ type: 'exit', code: -1, error: err.message });
      });

      return child;
    },

    stop(): void {
      if (!active) return;
      active.removeAllListeners('close');
      active.kill('SIGKILL');
      active = null;
    },
  };
}

// ─── Project resolution ───────────────────────────────────────────────────────

/**
 * Resolves the project id for a run: the caller's value, else the newest real run in the state DB.
 * @param {string} [requested]
 * @returns {string}
 */
export function resolveProjectId(requested?: string): string {
  const trimmed = (requested || '').trim();
  if (trimmed) return trimmed;
  try {
    // stateDb, not stateManager: StateManager exposes no database accessor, so the call that used to
    // live here threw on every invocation and silently pinned every run to the fallback literal.
    stateDb.initialize();
    const latest = stateDb.prepare(LATEST_RUN_SQL).get() as any;
    if (latest?.project_id) return latest.project_id;
  } catch {
    // The DB may not be open yet; fall through to the default.
  }
  return 'ARIA Project';
}

/**
 * Ensures the StateManager (and memory engine) are open before a read.
 * @param {string} [projectId]
 */
export async function ensureStateReady(projectId?: string): Promise<void> {
  if ((stateManager as any)._initialized) return;
  try {
    const resolved = resolveProjectId(projectId);
    await stateManager.initialize(resolved);
    await memoryEngine.initialize(resolved);
  } catch {
    // State may already be open in another process — reads below still work.
  }
}

// ─── Path allowlist ───────────────────────────────────────────────────────────

/**
 * Returns true when `target` resolves inside `root`.
 *
 * Uses path.relative rather than a string prefix test, which on Windows would treat a differently
 * cased drive or folder ("…\\Reports\\") as outside the root.
 *
 * @param {string} root - Absolute directory
 * @param {string} target - Absolute candidate path
 * @returns {boolean}
 */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Resolves a caller-supplied relative path against a set of allowed roots.
 * @param {string} relPath - Untrusted path from a query string or body
 * @param {string[]} roots - Absolute directories the path must fall inside
 * @returns {string|null} Absolute path, or null when it escapes every root
 */
export function resolveAllowedPath(relPath: string, roots: string[]): string | null {
  const normalized = path.normalize(String(relPath || '')).replace(/^[/\\]+/, '');
  if (!normalized) return null;
  const target = path.resolve(FRAMEWORK_DIR, normalized);
  return roots.some((root) => isInside(root, target)) ? target : null;
}

// ─── Approval routes ──────────────────────────────────────────────────────────

/**
 * Applies an approval decision straight to the StateManager.
 *
 * This is the fallback for when the agent's webhook is not listening. It marks the stage but cannot
 * unblock an agent that is waiting on its terminal gate, so it is genuinely a last resort.
 *
 * @param {string} stageId
 * @param {boolean} isApproval
 * @param {string} comment
 */
async function applyDirect(stageId: string, isApproval: boolean, comment: string): Promise<void> {
  await ensureStateReady();
  if (isApproval) {
    await stateManager.markStageApproved(stageId, comment);
    await memoryEngine.recordApprovalFeedback(stageId, 'APPROVED', comment);
  } else {
    await stateManager.markStageRejected(stageId, comment);
    await memoryEngine.recordApprovalFeedback(stageId, 'REJECTED', comment);
  }
}

/**
 * Builds an approve/reject handler that proxies to the agent's approval webhook.
 * @param {string} stageId
 * @param {'approve'|'reject'} action
 * @param {Logger} logger
 */
function approvalHandler(stageId: string, action: 'approve' | 'reject', logger: Logger) {
  return async (req: Request, res: Response): Promise<void> => {
    const isApproval = action === 'approve';
    const comment = (String(req.body?.comment || '') || `${isApproval ? 'Approved' : 'Rejected'} via Agent UI`).trim();
    // ApprovalGate rejects any request whose stageId does not match the blocking stage.
    const payload = JSON.stringify({ stageId, comment });
    let settled = false;

    const fallback = async (reason: string): Promise<void> => {
      if (settled) return;
      settled = true;
      logger.warn(`Approval webhook unavailable for ${stageId}; applying directly`, { reason });
      try {
        await applyDirect(stageId, isApproval, comment);
        res.json({ ok: true, status: isApproval ? 'APPROVED' : 'REJECTED', direct: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    };

    const proxyReq = http.request({
      hostname: 'localhost',
      port: APPROVAL_PORT,
      path: `/${action}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 3000,
    }, (proxyRes) => {
      let body = '';
      proxyRes.on('data', (chunk) => { body += chunk; });
      proxyRes.on('end', () => {
        if (settled) return;
        const mismatched = (proxyRes.statusCode || 200) >= 400 && body.includes('mismatch');
        if (mismatched) { fallback('stageId mismatch — a different stage is gating'); return; }
        settled = true;
        try {
          res.status(proxyRes.statusCode || 200).json(JSON.parse(body));
        } catch {
          res.status(proxyRes.statusCode || 200).send(body);
        }
      });
    });

    proxyReq.on('error', (err) => fallback(err.message));
    proxyReq.on('timeout', () => { proxyReq.destroy(); fallback('timeout'); });
    proxyReq.write(payload);
    proxyReq.end();
  };
}

/**
 * Mounts POST /api/<prefix>/approve and /reject for a stage.
 * @param {Express} app
 * @param {Object} options
 * @param {string} options.prefix - Route prefix, e.g. 'agent06'
 * @param {string} options.stageId - e.g. '06-automation-reviewer'
 * @param {Logger} options.logger
 */
export function registerApprovalRoutes(
  app: Express,
  options: { prefix: string; stageId: string; logger: Logger },
): void {
  const { prefix, stageId, logger } = options;
  app.post(`/api/${prefix}/approve`, approvalHandler(stageId, 'approve', logger));
  app.post(`/api/${prefix}/reject`, approvalHandler(stageId, 'reject', logger));
}
