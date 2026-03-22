/**
 * Mneme M2 - Discord Data Adapter
 *
 * Processes Discord data package exports.
 * Parses messages from JSON files in Discord data packages.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';
import {
  BaseAdapter,
  type AdapterConfig,
  type ContextItem,
  type FetchOptions,
  type AdapterStats,
} from './adapter-interface.js';

export interface DiscordDataConfig extends AdapterConfig {
  /**
   * Path to Discord data package directory
   */
  dataPath: string;

  /**
   * Include DMs
   */
  includeDMs?: boolean;

  /**
   * Include server messages
   */
  includeServers?: boolean;

  /**
   * Server/channel IDs to include (omit for all)
   */
  includeChannels?: string[];

  /**
   * User mapping (Discord user ID to display name)
   */
  userMapping?: Record<string, string>;
}

interface DiscordMessage {
  ID: string;
  Timestamp: string;
  Contents: string;
  Attachments?: string;
  [key: string]: any;
}

interface DiscordChannel {
  id: string;
  type: number; // 0=text, 1=DM, etc.
  name?: string;
  recipients?: string[];
  [key: string]: any;
}

/**
 * Discord data adapter
 */
export class DiscordDataAdapter extends BaseAdapter {
  readonly id = 'discord-data';
  readonly name = 'Discord Data Adapter';
  readonly version = '1.0.0';
  readonly supportedFormats = ['discord-data-package'];

  private channels: Map<string, DiscordChannel> = new Map();
  private lastUpdate: Date | null = null;

  async initialize(config: DiscordDataConfig): Promise<void> {
    await super.initialize(config);

    const discordConfig = config as DiscordDataConfig;

    // Validate config
    if (!discordConfig.dataPath) {
      throw new Error('dataPath is required in config');
    }

    if (!existsSync(discordConfig.dataPath)) {
      throw new Error(`Discord data package not found: ${discordConfig.dataPath}`);
    }

    // Parse index file
    await this.parseIndex();
  }

  /**
   * Parse Discord data package index
   */
  private async parseIndex(): Promise<void> {
    const config = this.config as DiscordDataConfig;

    // Try to find channels/index.json or similar
    const indexPath = join(config.dataPath, 'messages', 'index.json');

    if (existsSync(indexPath)) {
      const indexData = JSON.parse(await readFile(indexPath, 'utf8'));

      // Parse channel list
      if (indexData.channels) {
        for (const [id, channel] of Object.entries(indexData.channels)) {
          this.channels.set(id, channel as DiscordChannel);
        }
      }
    }

    // Fallback: scan messages directory
    const messagesDir = join(config.dataPath, 'messages');

    if (existsSync(messagesDir)) {
      const entries = await readdir(messagesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Channel ID directory (e.g., "c123456789")
          const channelId = entry.name.replace(/^c/, '');

          if (!this.channels.has(channelId)) {
            this.channels.set(channelId, {
              id: channelId,
              type: 0, // Assume text channel
              name: channelId,
            });
          }
        }
      }
    }
  }

  async *fetch(options: FetchOptions = {}): AsyncIterator<ContextItem> {
    this.ensureReady();

    const config = this.config as DiscordDataConfig;
    const messagesDir = join(config.dataPath, 'messages');

    if (!existsSync(messagesDir)) {
      return;
    }

    // Iterate through channel directories
    for (const [channelId, channel] of this.channels) {
      // Apply filters
      const isDM = channel.type === 1;
      const isServer = channel.type === 0;

      if (!config.includeDMs && isDM) continue;
      if (!config.includeServers && isServer) continue;

      if (config.includeChannels && !config.includeChannels.includes(channelId)) {
        continue;
      }

      // Find messages file
      const channelDir = join(messagesDir, `c${channelId}`);

      if (!existsSync(channelDir)) continue;

      const messagesPath = join(channelDir, 'messages.json');
      const messagesPathCsv = join(channelDir, 'messages.csv');

      let messages: DiscordMessage[] = [];

      // Try JSON first
      if (existsSync(messagesPath)) {
        messages = JSON.parse(await readFile(messagesPath, 'utf8'));
      } else if (existsSync(messagesPathCsv)) {
        // TODO: Implement CSV parsing if needed
        console.warn(`CSV format not yet supported: ${messagesPathCsv}`);
        continue;
      } else {
        continue;
      }

      // Process messages
      for (const msg of messages) {
        if (!msg.Contents) continue;

        const timestamp = new Date(msg.Timestamp);

        // Apply time filters
        if (options.since && timestamp < options.since) continue;
        if (options.until && timestamp > options.until) continue;

        // Create context item
        yield this.createContextItem(
          msg.ID,
          msg.Contents,
          'user', // Discord data doesn't distinguish bot messages well
          timestamp,
          {
            conversationId: channelId,
            metadata: {
              channel_id: channelId,
              channel_name: channel.name,
              channel_type: channel.type === 1 ? 'DM' : 'Server',
              attachments: msg.Attachments,
            },
          }
        );

        // Update last update
        if (!this.lastUpdate || timestamp > this.lastUpdate) {
          this.lastUpdate = timestamp;
        }
      }
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

    let totalItems = 0;
    let earliest: Date | null = null;
    let latest: Date | null = null;

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
          type: c.type === 1 ? 'DM' : 'Server',
        })),
      },
    };
  }
}
