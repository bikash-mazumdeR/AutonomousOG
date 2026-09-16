'use strict';

/**
 * @fileoverview ARIA Agent 06 UI Server — Automation Code Reviewer.
 *
 * Thin bootstrap: every route lives in ui/agent06Routes.ts so the combined hub server
 * (ui/agent01-ui-server.ts) can mount the same set without duplicating it.
 *
 * @module Agent06UIServer
 */

import express from 'express';
import path from 'path';

import { registerPipelineRoutes } from './pipelineRoutes';
import { registerAgent06Routes } from './agent06Routes';
import { Logger } from '../core/logger/Logger';

require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.AGENT06_UI_PORT || '3005', 10);
const logger = new Logger('Agent06UI');

app.use(express.json());
registerPipelineRoutes(app);
app.use(express.static(path.join(__dirname, 'static')));
registerAgent06Routes(app, logger);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'agent06.html'));
});

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  🤖 ARIA Agent 06 UI Server                  ║');
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log('╚══════════════════════════════════════════════╝\n');
  logger.info('Agent 06 UI server started', { port: PORT });
});
