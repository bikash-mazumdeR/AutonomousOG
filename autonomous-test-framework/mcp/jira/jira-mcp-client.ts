'use strict';
/**
 * @fileoverview Jira MCP Client
 * Wraps Atlassian Jira REST API v3 for issue creation, updates, and attachments.
 * Configure via JIRA_* environment variables.
 */
import axios from 'axios';
import * as fs from 'fs';
import FormData from 'form-data';
import { JIRA_CONFIG } from '../../config/framework.config';
import { Logger } from '../../core/logger/Logger';

const logger = new Logger('JiraClient');

export interface JiraIssueFields {
  project: { key: string };
  issuetype: { name: string };
  summary: string;
  description: any;
  priority?: { name: string };
  labels?: string[];
  environment?: any;
  [key: string]: any;
}

export class JiraMCPClient {
  private _baseUrl: string;
  private _authToken: string;

  constructor() {
    this._baseUrl   = JIRA_CONFIG.baseUrl;
    this._authToken = Buffer.from(`${JIRA_CONFIG.email}:${JIRA_CONFIG.apiToken}`).toString('base64');
  }

  private get _headers() {
    return {
      'Authorization': `Basic ${this._authToken}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    };
  }

  async createIssue(fields: JiraIssueFields): Promise<string | null> {
    try {
      const response = await axios.post(`${this._baseUrl}/rest/api/3/issue`, { fields }, { headers: this._headers });
      return response.data.key;
    } catch (err: any) {
      logger.error('Failed to create Jira issue', { error: err.message, data: err.response?.data });
      return null;
    }
  }

  async searchIssues(jql: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this._baseUrl}/rest/api/3/search`, {
        params: { jql, maxResults: 50 },
        headers: this._headers
      });
      return response.data.issues;
    } catch (err: any) {
      logger.error('Failed to search Jira issues', { jql, error: err.message });
      return [];
    }
  }

  async addComment(key: string, body: string): Promise<boolean> {
    try {
      await axios.post(`${this._baseUrl}/rest/api/3/issue/${key}/comment`, {
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }]
        }
      }, { headers: this._headers });
      return true;
    } catch (err: any) {
      logger.error('Failed to add comment to Jira', { key, error: err.message });
      return false;
    }
  }

  async addAttachment(key: string, filePath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(filePath)) {
        logger.error(`Attachment file not found: ${filePath}`);
        return false;
      }

      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));

      const headers = {
        ...this._headers,
        ...form.getHeaders(),
        'X-Atlassian-Token': 'no-check' // Required for Jira attachments
      };

      await axios.post(`${this._baseUrl}/rest/api/3/issue/${key}/attachments`, form, { headers });
      
      logger.info('Attachment uploaded successfully', { key, filePath });
      return true;
    } catch (err: any) {
      logger.error('Failed to add attachment to Jira', { key, filePath, error: err.message });
      return false;
    }
  }

  async getIssue(key: string): Promise<any | null> {
    // Explicitly request every field relevant to requirement extraction.
    // Jira only returns a sparse subset by default — missing fields = missing requirements.
    const REQUIRED_FIELDS = [
      'summary',
      'description',
      'comment',
      'attachment',
      'subtasks',
      'issuetype',
      'priority',
      'labels',
      'status',
      'assignee',
      'reporter',
      'parent',
      // Common AC custom fields across Atlassian instances
      'customfield_10016', // Story Points
      'customfield_10014', // Epic Link
      'customfield_10101', // AC / Test Env (instance-specific)
      'customfield_10100', // Severity
      'customfield_10104', // Acceptance Criteria (alternate)
      'customfield_10105', // Acceptance Criteria (alternate)
    ].join(',');

    try {
      const response = await axios.get(
        `${this._baseUrl}/rest/api/3/issue/${key}`,
        { headers: this._headers, params: { fields: REQUIRED_FIELDS, expand: 'renderedFields' } }
      );
      return response.data;
    } catch (err: any) {
      logger.error('Failed to get Jira issue', { key, error: err.message });
      return null;
    }
  }

  /**
   * Discovers available custom fields on the Jira instance and returns a
   * name → fieldId mapping. Useful for finding the real AC field ID.
   */
  async getCustomFields(): Promise<Record<string, string>> {
    try {
      const response = await axios.get(`${this._baseUrl}/rest/api/3/field`, { headers: this._headers });
      const map: Record<string, string> = {};
      for (const field of response.data) {
        map[field.name] = field.id;
      }
      return map;
    } catch (err: any) {
      logger.error('Failed to fetch custom fields', { error: err.message });
      return {};
    }
  }

  async getTransitions(key: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this._baseUrl}/rest/api/3/issue/${key}/transitions`, { headers: this._headers });
      return response.data.transitions || [];
    } catch (err: any) {
      logger.error('Failed to get transitions for issue', { key, error: err.message });
      return [];
    }
  }

  async transitionIssue(key: string, transitionId: string): Promise<boolean> {
    try {
      await axios.post(`${this._baseUrl}/rest/api/3/issue/${key}/transitions`, {
        transition: { id: transitionId }
      }, { headers: this._headers });
      return true;
    } catch (err: any) {
      logger.error('Failed to transition issue', { key, transitionId, error: err.message, data: err.response?.data });
      return false;
    }
  }
}

export const jiraClient = new JiraMCPClient();

