/**
 * Mneme M2 - Email Adapter
 *
 * Processes MBOX email format, extracting threads and messages.
 * Commonly used for email exports from Gmail, Thunderbird, etc.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import {
  BaseAdapter,
  type AdapterConfig,
  type ContextItem,
  type FetchOptions,
  type AdapterStats,
} from './adapter-interface.js';

export interface EmailConfig extends AdapterConfig {
  /**
   * Path to MBOX file
   */
  mboxPath: string;

  /**
   * Extract email threads
   */
  extractThreads?: boolean;

  /**
   * Include attachments info
   */
  includeAttachments?: boolean;

  /**
   * Filter by sender/recipient
   */
  filterEmails?: string[];
}

interface EmailMessage {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  date: Date;
  content: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
  contentType?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size?: number;
  }>;
}

/**
 * Email adapter (MBOX format)
 */
export class EmailAdapter extends BaseAdapter {
  readonly id = 'email';
  readonly name = 'Email Adapter (MBOX)';
  readonly version = '1.0.0';
  readonly supportedFormats = ['.mbox'];

  private messages: EmailMessage[] = [];
  private threads: Map<string, EmailMessage[]> = new Map();
  private lastUpdate: Date | null = null;

  async initialize(config: EmailConfig): Promise<void> {
    await super.initialize(config);

    const emailConfig = config as EmailConfig;

    if (!emailConfig.mboxPath) {
      throw new Error('mboxPath is required in config');
    }

    if (!existsSync(emailConfig.mboxPath)) {
      throw new Error(`MBOX file not found: ${emailConfig.mboxPath}`);
    }

    // Parse MBOX file
    await this.parseMbox();

    // Extract threads if enabled
    if (emailConfig.extractThreads) {
      this.extractThreads();
    }
  }

  /**
   * Parse MBOX file
   */
  private async parseMbox(): Promise<void> {
    const config = this.config as EmailConfig;
    const content = await readFile(config.mboxPath, 'utf8');

    // Split by "From " lines (MBOX separator)
    const messageParts = content.split(/\nFrom /);

    for (const part of messageParts) {
      if (!part.trim()) continue;

      try {
        const message = this.parseEmailMessage(part);

        // Apply filters
        if (config.filterEmails && config.filterEmails.length > 0) {
          const allEmails = [
            message.from,
            ...message.to,
            ...(message.cc || []),
          ];

          const hasMatch = allEmails.some(email =>
            config.filterEmails!.some(filter =>
              email.toLowerCase().includes(filter.toLowerCase())
            )
          );

          if (!hasMatch) continue;
        }

        this.messages.push(message);

        // Update last update
        if (!this.lastUpdate || message.date > this.lastUpdate) {
          this.lastUpdate = message.date;
        }
      } catch (error) {
        console.warn('Failed to parse email message:', error);
      }
    }

    // Sort by date
    this.messages.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /**
   * Parse a single email message
   */
  private parseEmailMessage(text: string): EmailMessage {
    const lines = text.split('\n');
    const headers: Record<string, string> = {};
    let bodyStart = 0;

    // Parse headers
    let currentHeader: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line === '') {
        bodyStart = i + 1;
        break;
      }

      // Header continuation
      if (line.startsWith(' ') || line.startsWith('\t')) {
        if (currentHeader) {
          headers[currentHeader] += ' ' + line.trim();
        }
        continue;
      }

      // New header
      const colonIndex = line.indexOf(':');

      if (colonIndex !== -1) {
        const key = line.slice(0, colonIndex).trim().toLowerCase();
        const value = line.slice(colonIndex + 1).trim();
        headers[key] = value;
        currentHeader = key;
      }
    }

    // Extract body
    const body = lines.slice(bodyStart).join('\n');

    // Parse date
    const date = headers.date
      ? new Date(headers.date)
      : new Date();

    // Parse message ID
    const messageId = this.extractMessageId(headers['message-id'] || '');

    // Parse thread info
    const inReplyTo = this.extractMessageId(headers['in-reply-to'] || '');
    const references = (headers.references || '')
      .split(/\s+/)
      .map(ref => this.extractMessageId(ref))
      .filter(id => id);

    return {
      id: messageId || `msg_${Date.now()}_${Math.random()}`,
      from: headers.from || 'unknown',
      to: this.parseEmailList(headers.to || ''),
      cc: headers.cc ? this.parseEmailList(headers.cc) : undefined,
      subject: this.decodeHeader(headers.subject || 'No Subject'),
      date,
      content: this.extractTextContent(body, headers['content-type']),
      inReplyTo: inReplyTo || undefined,
      references: references.length > 0 ? references : undefined,
      contentType: headers['content-type'],
    };
  }

  /**
   * Extract message ID from header value
   */
  private extractMessageId(value: string): string {
    const match = value.match(/<([^>]+)>/);
    return match ? match[1] : value.trim();
  }

  /**
   * Parse email list (comma-separated)
   */
  private parseEmailList(value: string): string[] {
    return value
      .split(',')
      .map(email => {
        // Extract email from "Name <email>" format
        const match = email.match(/<([^>]+)>/);
        return match ? match[1].trim() : email.trim();
      })
      .filter(email => email);
  }

  /**
   * Decode RFC 2047 encoded headers
   */
  private decodeHeader(value: string): string {
    // Simple implementation - just remove encoding markers
    return value.replace(/=\?[^?]+\?[QB]\?([^?]+)\?=/gi, '$1');
  }

  /**
   * Extract text content from body
   */
  private extractTextContent(body: string, contentType?: string): string {
    // If plain text, return as-is
    if (!contentType || contentType.includes('text/plain')) {
      return body;
    }

    // If multipart, try to extract text parts
    if (contentType.includes('multipart/')) {
      const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/);

      if (boundaryMatch) {
        const boundary = boundaryMatch[1];
        const parts = body.split(new RegExp(`--${boundary}`, 'g'));

        for (const part of parts) {
          if (part.includes('Content-Type: text/plain')) {
            // Extract text after headers
            const textStart = part.indexOf('\n\n');
            return textStart !== -1 ? part.slice(textStart + 2).trim() : part;
          }
        }
      }
    }

    // Fallback: return body
    return body;
  }

  /**
   * Extract email threads
   */
  private extractThreads(): void {
    // Group by subject (simple threading)
    const subjectThreads = new Map<string, EmailMessage[]>();

    for (const msg of this.messages) {
      // Normalize subject (remove Re:, Fwd:, etc.)
      const normalizedSubject = msg.subject
        .replace(/^(Re|Fwd|Fw):\s*/gi, '')
        .trim()
        .toLowerCase();

      if (!subjectThreads.has(normalizedSubject)) {
        subjectThreads.set(normalizedSubject, []);
      }

      subjectThreads.get(normalizedSubject)!.push(msg);
    }

    // Assign thread IDs
    for (const [subject, messages] of subjectThreads.entries()) {
      if (messages.length > 1) {
        const threadId = `thread_${subject.slice(0, 50)}`;

        for (const msg of messages) {
          msg.threadId = threadId;
        }

        this.threads.set(threadId, messages);
      }
    }
  }

  async *fetch(options: FetchOptions = {}): AsyncIterator<ContextItem> {
    this.ensureReady();

    for (const msg of this.messages) {
      // Apply time filters
      if (options.since && msg.date < options.since) continue;
      if (options.until && msg.date > options.until) continue;

      // Determine role (simple heuristic)
      const config = this.config as EmailConfig;
      const role = msg.from.includes('noreply') || msg.from.includes('no-reply')
        ? 'system'
        : 'user';

      yield this.createContextItem(
        msg.id,
        `Subject: ${msg.subject}\n\n${msg.content}`,
        role,
        msg.date,
        {
          conversationId: msg.threadId || msg.id,
          metadata: {
            from: msg.from,
            to: msg.to,
            cc: msg.cc,
            subject: msg.subject,
            thread_id: msg.threadId,
            in_reply_to: msg.inReplyTo,
            references: msg.references,
            content_type: msg.contentType,
          },
        }
      );
    }
  }

  async fetchUpdates(since?: Date): Promise<ContextItem[]> {
    const items: ContextItem[] = [];

    for await (const item of this.fetch({ since })) {
      items.push(item);
    }

    return items;
  }

  async getLastUpdate(): Promise<Date | null> {
    return this.lastUpdate;
  }

  async getStats(): Promise<AdapterStats> {
    this.ensureReady();

    const earliest = this.messages[0]?.date || null;
    const latest = this.messages[this.messages.length - 1]?.date || null;

    return {
      totalItems: this.messages.length,
      totalConversations: this.threads.size,
      dateRange: {
        earliest,
        latest,
      },
      metadata: {
        threads: this.threads.size,
        standalone_messages: this.messages.filter(m => !m.threadId).length,
      },
    };
  }
}
