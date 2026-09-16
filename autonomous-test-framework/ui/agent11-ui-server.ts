'use strict';

/**
 * @fileoverview ARIA Agent 11 UI Server — Re-Test Failed Cases.
 *
 * Thin bootstrap: every route lives in ui/agent11Routes.ts so the combined hub server
 * (ui/agent01-ui-server.ts) can mount the same set without duplicating it.
 *
 * @module Agent11UIServer
 */

import express from 'express';
import path from 'path';

import { registerPipelineRoutes } from './pipelineRoutes';
import { registerAgent11Routes } from './agent11Routes';
import { Logger } from '../core/logger/Logger';

require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.AGENT11_UI_PORT || '3010', 10);
const logger = new Logger('Agent11UI');

app.use(express.json());
registerPipelineRoutes(app);
app.use(express.static(path.join(__dirname, 'static')));
registerAgent11Routes(app, logger);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'agent11.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🤖 ARIA Agent 11 UI Server                  ║');
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  logger.info('Agent 11 UI server started', { port: PORT });
});
