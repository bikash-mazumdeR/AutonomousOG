'use strict';

/**
 * @fileoverview ARIA Agent 09 UI Server — Report Generator & Publisher.
 *
 * Thin bootstrap: every route lives in ui/agent09Routes.ts so the combined hub server
 * (ui/agent01-ui-server.ts) can mount the same set without duplicating it.
 *
 * @module Agent09UIServer
 */

import express from 'express';
import path from 'path';

import { registerPipelineRoutes } from './pipelineRoutes';
import { registerAgent09Routes } from './agent09Routes';
import { Logger } from '../core/logger/Logger';

require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.AGENT09_UI_PORT || '3008', 10);
const logger = new Logger('Agent09UI');

app.use(express.json());
registerPipelineRoutes(app);
app.use(express.static(path.join(__dirname, 'static')));
registerAgent09Routes(app, logger);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'agent09.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🤖 ARIA Agent 09 UI Server                  ║');
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  logger.info('Agent 09 UI server started', { port: PORT });
});
