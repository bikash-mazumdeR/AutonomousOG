'use strict';
/**
 * @fileoverview GmailClient — Gmail SMTP mailer using nodemailer.
 * Centralized email client used by Agents 08 and 09 for bug and report notifications.
 *
 * @module GmailClient
 * @version 2.0.0
 */

import nodemailer, { Transporter } from 'nodemailer';
import { GMAIL_CONFIG } from '../../config/framework.config';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface SendOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{ filename: string; path?: string; content?: string | Buffer }>;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ─── GmailClient Class ───────────────────────────────────────────────────────

export class GmailClient {
  private _transporter: Transporter | null;

  constructor() {
    this._transporter = null;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Lazily creates the nodemailer transporter.
   * @private
   */
  private _getTransporter(): Transporter {
    if (!this._transporter) {
      this._transporter = nodemailer.createTransport({
        host:   GMAIL_CONFIG.smtpHost,
        port:   GMAIL_CONFIG.smtpPort as number,
        secure: GMAIL_CONFIG.secure,
        auth:   { user: GMAIL_CONFIG.user, pass: GMAIL_CONFIG.appPassword },
      });
    }
    return this._transporter;
  }

  /**
   * Returns true if GMAIL_CONFIG has the minimum required credentials.
   */
  isConfigured(): boolean {
    return !!(GMAIL_CONFIG.user && GMAIL_CONFIG.appPassword && GMAIL_CONFIG.smtpHost);
  }

  // ── Public ────────────────────────────────────────────────────────────────

  /**
   * Sends an email via Gmail SMTP.
   * Never throws — returns a result object so the calling agent can decide
   * whether to treat a delivery failure as fatal.
   */
  async send({ to, subject, html, text, attachments = [] }: SendOptions): Promise<SendResult> {
    if (!this.isConfigured()) {
      console.warn('[GmailClient] SMTP credentials are not configured — skipping email send.');
      return { success: false, error: 'SMTP credentials not configured' };
    }

    try {
      const transport = this._getTransporter();
      const info = await transport.sendMail({
        from:        GMAIL_CONFIG.from,
        to:          Array.isArray(to) ? to.join(',') : to,
        subject,
        ...(html ? { html } : {}),
        ...(text ? { text } : {}),
        attachments,
      });
      console.log(`[GmailClient] Email sent — messageId: ${info.messageId}, to: ${to}`);
      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      console.error(`[GmailClient] Failed to send email to "${to}": ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Verifies SMTP credentials are valid.
   * Returns true on success, false on failure — never throws.
   */
  async verify(): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('[GmailClient] SMTP credentials are not configured — skipping verify.');
      return false;
    }

    try {
      await this._getTransporter().verify();
      console.log('[GmailClient] SMTP connection verified successfully.');
      return true;
    } catch (err: any) {
      console.error(`[GmailClient] SMTP verification failed: ${err.message}`);
      return false;
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const gmailClient = new GmailClient();
