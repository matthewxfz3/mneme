/**
 * Mneme M2 - Markdown Adapter
 *
 * Processes Markdown files, extracting frontmatter and content.
 * Supports single files or directory scanning.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, extname, relative } from 'path';
import { existsSync, statSync } from 'fs';
import {
  BaseAdapter,
  type AdapterConfig,
  type ContextItem,
  type FetchOptions,
  type AdapterStats,
} from './adapter-interface.js';

export interface MarkdownConfig extends AdapterConfig {
  /**
   * Path to markdown file or directory
   */
  markdownPath: string;

  /**
   * Parse frontmatter (YAML at top of file)
   */
  parseFrontmatter?: boolean;

  /**
   * Chunk by headings (# ## ###)
   */
  chunkByHeadings?: boolean;

  /**
   * Maximum chunk size
   */
  maxChunkSize?: number;

  /**
   * Include code blocks
   */
  includeCodeBlocks?: boolean;

  /**
   * Watch for file changes (not implemented yet)
   */
  watchChanges?: boolean;
}

interface MarkdownDocument {
  path: string;
  filename: string;
  frontmatter?: Record<string, any>;
  content: string;
  modifiedTime: Date;
}

interface MarkdownChunk {
  heading?: string;
  level?: number;
  content: string;
  startLine: number;
  endLine: number;
}

/**
 * Markdown adapter
 */
export class MarkdownAdapter extends BaseAdapter {
  readonly id = 'markdown';
  readonly name = 'Markdown Adapter';
  readonly version = '1.0.0';
  readonly supportedFormats = ['.md', '.markdown'];

  private documents: Map<string, MarkdownDocument> = new Map();
  private isDirectory = false;

  async initialize(config: MarkdownConfig): Promise<void> {
    await super.initialize(config);

    const mdConfig = config as MarkdownConfig;

    if (!mdConfig.markdownPath) {
      throw new Error('markdownPath is required in config');
    }

    if (!existsSync(mdConfig.markdownPath)) {
      throw new Error(`Path not found: ${mdConfig.markdownPath}`);
    }

    // Check if path is file or directory
    const stats = statSync(mdConfig.markdownPath);
    this.isDirectory = stats.isDirectory();

    if (this.isDirectory) {
      await this.scanDirectory(mdConfig.markdownPath);
    } else {
      await this.parseMarkdownFile(mdConfig.markdownPath);
    }
  }

  /**
   * Scan directory for markdown files
   */
  private async scanDirectory(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursive scan
        await this.scanDirectory(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();

        if (this.supportedFormats.includes(ext)) {
          await this.parseMarkdownFile(fullPath);
        }
      }
    }
  }

  /**
   * Parse a markdown file
   */
  private async parseMarkdownFile(path: string): Promise<void> {
    const config = this.config as MarkdownConfig;
    const content = await readFile(path, 'utf8');
    const stats = await stat(path);

    // Parse frontmatter
    let frontmatter: Record<string, any> | undefined;
    let markdownContent = content;

    if (config.parseFrontmatter !== false) {
      const parsed = this.parseFrontmatter(content);
      frontmatter = parsed.frontmatter;
      markdownContent = parsed.content;
    }

    this.documents.set(path, {
      path,
      filename: relative(
        (config as MarkdownConfig).markdownPath,
        path
      ),
      frontmatter,
      content: markdownContent,
      modifiedTime: stats.mtime,
    });
  }

  /**
   * Parse YAML frontmatter
   */
  private parseFrontmatter(content: string): {
    frontmatter?: Record<string, any>;
    content: string;
  } {
    const frontmatterRegex = /^---\n([\s\S]+?)\n---\n/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { content };
    }

    try {
      // Simple YAML parsing (key: value)
      const frontmatterText = match[1];
      const frontmatter: Record<string, any> = {};

      for (const line of frontmatterText.split('\n')) {
        const colonIndex = line.indexOf(':');

        if (colonIndex !== -1) {
          const key = line.slice(0, colonIndex).trim();
          let value: any = line.slice(colonIndex + 1).trim();

          // Remove quotes
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          frontmatter[key] = value;
        }
      }

      return {
        frontmatter,
        content: content.slice(match[0].length),
      };
    } catch {
      return { content };
    }
  }

  async *fetch(options: FetchOptions = {}): AsyncIterator<ContextItem> {
    this.ensureReady();

    const config = this.config as MarkdownConfig;

    for (const [path, doc] of this.documents) {
      // Apply time filters
      if (options.since && doc.modifiedTime < options.since) continue;
      if (options.until && doc.modifiedTime > options.until) continue;

      // Chunk document
      const chunks = config.chunkByHeadings
        ? this.chunkByHeadings(doc.content)
        : this.chunkBySize(doc.content, config.maxChunkSize || 2000);

      for (const chunk of chunks) {
        const sourceId = chunk.heading
          ? `${doc.filename}#${chunk.heading}`
          : `${doc.filename}:L${chunk.startLine}`;

        yield this.createContextItem(
          sourceId,
          chunk.content,
          'system',
          doc.modifiedTime,
          {
            conversationId: doc.filename,
            metadata: {
              source_file: path,
              filename: doc.filename,
              frontmatter: doc.frontmatter,
              heading: chunk.heading,
              heading_level: chunk.level,
              start_line: chunk.startLine,
              end_line: chunk.endLine,
            },
          }
        );
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
    let latest: Date | null = null;

    for (const doc of this.documents.values()) {
      if (!latest || doc.modifiedTime > latest) {
        latest = doc.modifiedTime;
      }
    }

    return latest;
  }

  async getStats(): Promise<AdapterStats> {
    this.ensureReady();

    let totalChunks = 0;
    let earliest: Date | null = null;
    let latest: Date | null = null;

    for (const doc of this.documents.values()) {
      const config = this.config as MarkdownConfig;

      const chunks = config.chunkByHeadings
        ? this.chunkByHeadings(doc.content)
        : this.chunkBySize(doc.content, config.maxChunkSize || 2000);

      totalChunks += chunks.length;

      if (!earliest || doc.modifiedTime < earliest) {
        earliest = doc.modifiedTime;
      }

      if (!latest || doc.modifiedTime > latest) {
        latest = doc.modifiedTime;
      }
    }

    return {
      totalItems: totalChunks,
      totalConversations: this.documents.size,
      dateRange: {
        earliest,
        latest,
      },
      metadata: {
        documents: Array.from(this.documents.values()).map(doc => ({
          filename: doc.filename,
          frontmatter: doc.frontmatter,
        })),
      },
    };
  }

  /**
   * Chunk markdown by headings
   */
  private chunkByHeadings(content: string): MarkdownChunk[] {
    const chunks: MarkdownChunk[] = [];
    const lines = content.split('\n');

    let currentHeading: string | undefined;
    let currentLevel: number | undefined;
    let currentContent: string[] = [];
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        // Save previous chunk
        if (currentContent.length > 0) {
          chunks.push({
            heading: currentHeading,
            level: currentLevel,
            content: currentContent.join('\n').trim(),
            startLine,
            endLine: i - 1,
          });
        }

        // Start new chunk
        currentHeading = headingMatch[2];
        currentLevel = headingMatch[1].length;
        currentContent = [line];
        startLine = i;
      } else {
        currentContent.push(line);
      }
    }

    // Save last chunk
    if (currentContent.length > 0) {
      chunks.push({
        heading: currentHeading,
        level: currentLevel,
        content: currentContent.join('\n').trim(),
        startLine,
        endLine: lines.length - 1,
      });
    }

    return chunks;
  }

  /**
   * Chunk markdown by size
   */
  private chunkBySize(content: string, maxSize: number): MarkdownChunk[] {
    const chunks: MarkdownChunk[] = [];
    const lines = content.split('\n');

    let currentContent: string[] = [];
    let currentSize = 0;
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (currentSize + line.length > maxSize && currentContent.length > 0) {
        // Save chunk
        chunks.push({
          content: currentContent.join('\n').trim(),
          startLine,
          endLine: i - 1,
        });

        currentContent = [line];
        currentSize = line.length;
        startLine = i;
      } else {
        currentContent.push(line);
        currentSize += line.length + 1; // +1 for newline
      }
    }

    // Save last chunk
    if (currentContent.length > 0) {
      chunks.push({
        content: currentContent.join('\n').trim(),
        startLine,
        endLine: lines.length - 1,
      });
    }

    return chunks;
  }
}
