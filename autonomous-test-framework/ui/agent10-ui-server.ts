'use strict';

/**
 * @fileoverview ARIA Agent 10 UI Server — Auto Healer.
 *
 * Thin bootstrap: every route lives in ui/agent10Routes.ts so the combined hub server
 * (ui/agent01-ui-server.ts) can mount the same set without duplicating it.
 *
 * @module Agent10UIServer
 */

import express from 'express';
import path from 'path';

import { registerPipelineRoutes } from './pipelineRoutes';
import { registerAgent10Routes } from './agent10Routes';
import { Logger } from '../core/logger/Logger';

require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.AGENT10_UI_PORT || '3009', 10);
const logger = new Logger('Agent10UI');

app.use(express.json());
registerPipelineRoutes(app);
app.use(express.static(path.join(__dirname, 'static')));
registerAgent10Routes(app, logger);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'agent10.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🤖 ARIA Agent 10 UI Server                  ║');
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  logger.info('Agent 10 UI server started', { port: PORT });
});
