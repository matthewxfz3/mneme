/**
 * Mneme M2 - Slack Export Adapter
 *
 * Processes Slack workspace export archives (.zip).
 * Extracts messages from all channels and threads.
 */

import AdmZip from 'adm-zip';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { basename } from 'path';
import {
  BaseAdapter,
  type AdapterConfig,
  type ContextItem,
  type FetchOptions,
  type AdapterStats,
} from './adapter-interface.js';

export interface SlackExportConfig extends AdapterConfig {
  /**
   * Path to Slack export .zip file
   */
  zipPath: string;

  /**
   * Extract threads as separate conversations
   */
  extractThreads?: boolean;

  /**
   * Channel names to include (omit for all)
   */
  includeChannels?: string[];

  /**
   * Channel names to exclude
   */
  excludeChannels?: string[];

  /**
   * User mapping (Slack user ID to display name)
   */
  userMapping?: Record<string, string>;
}

interface SlackMessage {
  type: string;
  ts: string;
  user?: string;
  bot_id?: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  replies?: Array<{ user: string; ts: string }>;
  [key: string]: any;
}

interface SlackChannel {
  id: string;
  name: string;
  created: number;
  [key: string]: any;
}

/**
 * Slack export adapter
 */
export class SlackExportAdapter extends BaseAdapter {
  readonly id = 'slack-export';
  readonly name = 'Slack Export Adapter';
  readonly version = '1.0.0';
  readonly supportedFormats = ['.zip'];

  private zip: AdmZip | null = null;
  private channels: Map<string, SlackChannel> = new Map();
  private users: Map<string, any> = new Map();
  private lastUpdate: Date | null = null;

  async initialize(config: SlackExportConfig): Promise<void> {
    await super.initialize(config);

    const slackConfig = config as SlackExportConfig;

    // Validate config
    if (!slackConfig.zipPath) {
      throw new Error('zipPath is required in config');
    }

    if (!existsSync(slackConfig.zipPath)) {
      throw new Error(`Slack export file not found: ${slackConfig.zipPath}`);
    }

    // Load ZIP file
    this.zip = new AdmZip(slackConfig.zipPath);

    // Parse metadata files
    await this.parseMetadata();
  }

  async start(): Promise<void> {
    await super.start();
  }

  async stop(): Promise<void> {
    await super.stop();
    this.zip = null;
    this.channels.clear();
    this.users.clear();
  }

  /**
   * Parse Slack export metadata (channels.json, users.json)
   */
  private async parseMetadata(): Promise<void> {
    if (!this.zip) return;

    const entries = this.zip.getEntries();

    // Parse channels.json
    const channelsEntry = entries.find(e => e.entryName === 'channels.json');
    if (channelsEntry) {
      const channelsData = JSON.parse(channelsEntry.getData().toString('utf8'));
      for (const channel of channelsData) {
        this.channels.set(channel.id, channel);
      }
    }

    // Parse users.json
    const usersEntry = entries.find(e => e.entryName === 'users.json');
    if (usersEntry) {
      const usersData = JSON.parse(usersEntry.getData().toString('utf8'));
      for (const user of usersData) {
        this.users.set(user.id, user);
      }
    }
  }

  /**
   * Fetch messages from Slack export
   */
  async *fetch(options: FetchOptions = {}): AsyncIterator<ContextItem> {
    this.ensureReady();

    if (!this.zip) {
      throw new Error('ZIP file not loaded');
    }

    const config = this.config as SlackExportConfig;
    const entries = this.zip.getEntries();

    // Find all channel directories
    const channelDirs = new Set<string>();

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (!entry.entryName.endsWith('.json')) continue;

      const parts = entry.entryName.split('/');
      if (parts.length === 2) {
        // Channel message file (e.g., "general/2024-01-15.json")
        channelDirs.add(parts[0]);
      }
    }

    // Process each channel
    for (const channelName of channelDirs) {
      // Check include/exclude filters
      if (config.includeChannels && !config.includeChannels.includes(channelName)) {
        continue;
      }

      if (config.excludeChannels && config.excludeChannels.includes(channelName)) {
        continue;
      }

      // Get channel info
      const channel = Array.from(this.channels.values()).find(
        c => c.name === channelName
      );

      if (!channel) {
        console.warn(`Channel metadata not found: ${channelName}`);
        continue;
      }

      // Find all message files for this channel
      const messageFiles = entries.filter(
        e => e.entryName.startsWith(`${channelName}/`) && e.entryName.endsWith('.json')
      );

      // Sort by date (filename is YYYY-MM-DD.json)
      messageFiles.sort((a, b) => a.entryName.localeCompare(b.entryName));

      // Process each message file
      for (const file of messageFiles) {
        const messagesData = JSON.parse(file.getData().toString('utf8')) as SlackMessage[];

        for (const msg of messagesData) {
          // Skip system messages
          if (msg.type !== 'message') continue;
          if (!msg.text) continue;

          // Apply time filters
          const timestamp = this.parseSlackTimestamp(msg.ts);

          if (options.since && timestamp < options.since) continue;
          if (options.until && timestamp > options.until) continue;

          // Determine role
          const role = msg.bot_id ? 'assistant' : 'user';

          // Get user display name
          const userName = this.getUserName(msg.user || msg.bot_id || 'unknown');

          // Build conversation ID
          const conversationId = msg.thread_ts
            ? `${channel.id}:${msg.thread_ts}` // Thread
            : channel.id; // Channel

          // Create context item
          yield this.createContextItem(
            msg.ts,
            this.processMessageText(msg.text),
            role,
            timestamp,
            {
              conversationId,
              metadata: {
                channel: channelName,
                channel_id: channel.id,
                user: userName,
                user_id: msg.user,
                is_thread: !!msg.thread_ts,
                thread_ts: msg.thread_ts,
                reply_count: msg.reply_count,
              },
            }
          );

          // Update last update timestamp
          if (!this.lastUpdate || timestamp > this.lastUpdate) {
            this.lastUpdate = timestamp;
          }
        }
      }
    }
  }

  async fetchUpdates(since?: Date): Promise<ContextItem[]> {
    // Slack exports are static, so just fetch with time filter
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

    let totalItems = 0;
    let earliest: Date | null = null;
    let latest: Date | null = null;

    // Count all messages
    for await (const item of this.fetch()) {
      totalItems++;

      if (!earliest || item.createdAt < earliest) {
        earliest = item.createdAt;
      }

      if (!latest || item.createdAt > latest) {
        latest = item.createdAt;
      }
    }

    return {
      totalItems,
      totalConversations: this.channels.size,
      dateRange: {
        earliest,
        latest,
      },
      metadata: {
        channels: Array.from(this.channels.values()).map(c => ({
          id: c.id,
          name: c.name,
        })),
        users: this.users.size,
      },
    };
  }

  /**
   * Parse Slack timestamp (format: "1234567890.123456")
   */
  private parseSlackTimestamp(ts: string): Date {
    const unixTime = parseFloat(ts) * 1000;
    return new Date(unixTime);
  }

  /**
   * Get user display name
   */
  private getUserName(userId: string): string {
    const config = this.config as SlackExportConfig;

    // Check custom mapping first
    if (config.userMapping && config.userMapping[userId]) {
      return config.userMapping[userId];
    }

    // Check users.json
    const user = this.users.get(userId);
    if (user) {
      return user.real_name || user.name || userId;
    }

    return userId;
  }

  /**
   * Process message text (expand user mentions, etc.)
   */
  private processMessageText(text: string): string {
    // Expand user mentions: <@U12345> → @username
    return text.replace(/<@([UW][A-Z0-9]+)>/g, (match, userId) => {
      const userName = this.getUserName(userId);
      return `@${userName}`;
    });
  }
}
