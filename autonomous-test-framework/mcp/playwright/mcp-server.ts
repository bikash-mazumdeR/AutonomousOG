#!/usr/bin/env node

/**
 * @fileoverview Playwright MCP Server
 * Provides browser automation capabilities via Model Context Protocol.
 * Used by Agents for autonomous web interaction.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { chromium } from '@playwright/test';

class PlaywrightMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'playwright-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.browser = null;
    this.context = null;
    this.page = null;
    this.consoleLogs = [];
    this.networkLogs = [];

    this._setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this._cleanup();
      process.exit(0);
    });
  }

  async _ensureBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();

      this.page.on('console', (msg) => {
        this.consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      });

      this.page.on('response', (response) => {
        this.networkLogs.push(`${response.request().method()} ${response.url()} - ${response.status()}`);
      });
    }
  }

  async _cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  _setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'page_goto',
          description: 'Navigate to a URL',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url'],
          },
        },
        {
          name: 'page_click',
          description: 'Click an element by selector',
          inputSchema: {
            type: 'object',
            properties: { selector: { type: 'string' } },
            required: ['selector'],
          },
        },
        {
          name: 'page_fill',
          description: 'Fill an input element by selector',
          inputSchema: {
            type: 'object',
            properties: { selector: { type: 'string' }, text: { type: 'string' } },
            required: ['selector', 'text'],
          },
        },
        {
          name: 'page_screenshot',
          description: 'Take a screenshot of the current page',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: [],
          },
        },
        {
          name: 'page_evaluate',
          description: 'Evaluate JavaScript in the page context',
          inputSchema: {
            type: 'object',
            properties: { script: { type: 'string' } },
            required: ['script'],
          },
        },
        {
          name: 'console_capture',
          description: 'Retrieve captured console logs from the page',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'network_intercept',
          description: 'Retrieve captured network response logs',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this._ensureBrowser();
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'page_goto': {
            await this.page.goto(args.url, { waitUntil: 'networkidle' });
            return { content: [{ type: 'text', text: `Navigated to ${args.url}` }] };
          }
          case 'page_click': {
            await this.page.click(args.selector);
            return { content: [{ type: 'text', text: `Clicked ${args.selector}` }] };
          }
          case 'page_fill': {
            await this.page.fill(args.selector, args.text);
            return { content: [{ type: 'text', text: `Filled ${args.selector} with ${args.text}` }] };
          }
          case 'page_screenshot': {
            const savePath = args.path || 'screenshot.png';
            await this.page.screenshot({ path: savePath });
            return { content: [{ type: 'text', text: `Screenshot saved to ${savePath}` }] };
          }
          case 'page_evaluate': {
            const result = await this.page.evaluate(args.script);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          case 'console_capture': {
            const logs = [...this.consoleLogs];
            this.consoleLogs = []; // clear after reading
            return { content: [{ type: 'text', text: logs.join('\n') || 'No new logs.' }] };
          }
          case 'network_intercept': {
            const logs = [...this.networkLogs];
            this.networkLogs = []; // clear after reading
            return { content: [{ type: 'text', text: logs.join('\n') || 'No new network activity.' }] };
          }
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error executing ${name}: ${error.message}` }],
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Playwright MCP server running on stdio');
  }
}

const server = new PlaywrightMCPServer();
server.run().catch(console.error);
