'use strict';

/**
 * @fileoverview Jira and Gmail health checks for the Agent 08 and 09 consoles.
 *
 * cli/validate.ts cannot be reused for this: it writes chalk strings straight to the console,
 * returns nothing, calls process.exit(1) on failure — which would kill the UI server — and checks
 * neither Jira nor Gmail. This module is the library form those pages need, and it never returns a
 * credential value, only whether one is present.
 *
 * @module integrationStatus
 */

import axios from 'axios';

import { JIRA_CONFIG, GMAIL_CONFIG } from '../config/framework.config';
import { gmailClient } from '../notifications/gmail/GmailClient';

/** Milliseconds before a live probe is treated as unreachable. */
const PROBE_TIMEOUT_MS = 5000;

/** Identity endpoint — the cheapest call that proves base URL, credentials and network at once. */
const JIRA_IDENTITY_PATH = '/rest/api/3/myself';

/** One row in the status strip. */
export interface IntegrationCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

/**
 * Recipients that are actually addressable.
 *
 * GMAIL_CONFIG.to is built with an unconditional `.split(',')`, so an unset GMAIL_TO yields `['']` —
 * one empty string, which is truthy and length 1. Counting without filtering reports "1 recipient"
 * when there are none.
 *
 * @returns {string[]}
 */
export function gmailRecipients(): string[] {
  return (GMAIL_CONFIG.to || []).filter(Boolean);
}

/**
 * Checks Gmail configuration, and optionally performs a real SMTP handshake.
 *
 * The live probe is gmailClient.verify(), which authenticates but sends nothing — the one safe
 * connectivity probe in the codebase.
 *
 * @param {boolean} live - Perform the SMTP handshake as well as the config check
 * @returns {Promise<IntegrationCheck[]>}
 */
export async function checkGmail(live = false): Promise<IntegrationCheck[]> {
  const checks: IntegrationCheck[] = [];
  const configured = gmailClient.isConfigured();

  checks.push({
    id: 'gmail.credentials',
    label: 'Gmail SMTP credentials',
    status: configured ? 'ok' : 'fail',
    detail: configured ? 'GMAIL_USER and GMAIL_APP_PASSWORD are set' : 'GMAIL_USER or GMAIL_APP_PASSWORD is missing',
  });

  const recipients = gmailRecipients();
  checks.push({
    id: 'gmail.recipients',
    label: 'Recipients',
    status: recipients.length > 0 ? 'ok' : 'fail',
    detail: recipients.length > 0 ? recipients.join(', ') : 'GMAIL_TO is empty',
  });

  if (live && configured) {
    try {
      const reachable = await gmailClient.verify();
      checks.push({
        id: 'gmail.smtp',
        label: 'SMTP handshake',
        status: reachable ? 'ok' : 'fail',
        detail: reachable ? `Authenticated against ${GMAIL_CONFIG.smtpHost}:${GMAIL_CONFIG.smtpPort}` : 'Server rejected the credentials',
      });
    } catch (err: any) {
      checks.push({
        id: 'gmail.smtp', label: 'SMTP handshake', status: 'fail', detail: err.message,
      });
    }
  }

  return checks;
}

/**
 * Checks Jira configuration, and optionally probes the identity endpoint.
 *
 * A config check alone is not enough to trust Jira: every JiraMCPClient method swallows its error
 * and returns an empty value, so a failed search is indistinguishable from "no results" at the call
 * site. The live probe is what separates the two.
 *
 * @param {boolean} live - Perform the identity request as well as the config check
 * @returns {Promise<IntegrationCheck[]>}
 */
export async function checkJira(live = false): Promise<IntegrationCheck[]> {
  const checks: IntegrationCheck[] = [];
  const missing = (['baseUrl', 'email', 'apiToken'] as const).filter((key) => !JIRA_CONFIG[key]);
  const configured = missing.length === 0;

  checks.push({
    id: 'jira.credentials',
    label: 'Jira credentials',
    status: configured ? 'ok' : 'fail',
    detail: configured ? `${JIRA_CONFIG.baseUrl} as ${JIRA_CONFIG.email}` : `Missing: ${missing.join(', ')}`,
  });

  checks.push({
    id: 'jira.project',
    label: 'Jira project key',
    status: JIRA_CONFIG.projectKey ? 'ok' : 'fail',
    detail: JIRA_CONFIG.projectKey || 'JIRA_PROJECT_KEY is empty',
  });

  if (live && configured) {
    try {
      const auth = Buffer.from(`${JIRA_CONFIG.email}:${JIRA_CONFIG.apiToken}`).toString('base64');
      const response = await axios.get(`${JIRA_CONFIG.baseUrl}${JIRA_IDENTITY_PATH}`, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        timeout: PROBE_TIMEOUT_MS,
      });
      checks.push({
        id: 'jira.identity',
        label: 'Jira reachable',
        status: 'ok',
        detail: `Authenticated as ${response.data?.displayName || response.data?.emailAddress || 'unknown user'}`,
      });
    } catch (err: any) {
      checks.push({
        id: 'jira.identity',
        label: 'Jira reachable',
        status: 'fail',
        detail: err.response ? `HTTP ${err.response.status}` : err.message,
      });
    }
  }

  return checks;
}

/**
 * Full status strip for a page that touches both integrations.
 * @param {boolean} live - Include the network probes
 * @returns {Promise<{checks: IntegrationCheck[], ok: boolean}>}
 */
export async function integrationStatus(live = false): Promise<{ checks: IntegrationCheck[]; ok: boolean }> {
  const checks = [...await checkJira(live), ...await checkGmail(live)];
  return { checks, ok: checks.every((c) => c.status !== 'fail') };
}
