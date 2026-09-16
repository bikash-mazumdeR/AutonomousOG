'use strict';

/**
 * @fileoverview ARIA Agent 07 UI Server — Test Runner.
 *
 * Thin bootstrap: every route lives in ui/agent07Routes.ts so the combined hub server
 * (ui/agent01-ui-server.ts) can mount the same set without duplicating it.
 *
 * @module Agent07UIServer
 */

import express from 'express';
import path from 'path';

import { registerPipelineRoutes } from './pipelineRoutes';
import { registerAgent07Routes } from './agent07Routes';
import { Logger } from '../core/logger/Logger';

require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.AGENT07_UI_PORT || '3006', 10);
const logger = new Logger('Agent07UI');

app.use(express.json());
registerPipelineRoutes(app);
app.use(express.static(path.join(__dirname, 'static')));
registerAgent07Routes(app, logger);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'agent07.html'));
});

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  🤖 ARIA Agent 07 UI Server                  ║');
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log('╚══════════════════════════════════════════════╝\n');
  logger.info('Agent 07 UI server started', { port: PORT });
});
