/**
 * Mneme M2 - PDF Document Adapter
 *
 * Processes PDF documents, extracting text content.
 * Chunks documents by pages or custom boundaries.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { basename } from 'path';
import pdfParse from 'pdf-parse';
import {
  BaseAdapter,
  type AdapterConfig,
  type ContextItem,
  type FetchOptions,
  type AdapterStats,
} from './adapter-interface.js';

export interface PDFDocumentConfig extends AdapterConfig {
  /**
   * Path to PDF file or array of paths
   */
  pdfPaths: string | string[];

  /**
   * Chunking strategy
   */
  chunkBy?: 'page' | 'section' | 'paragraph';

  /**
   * Maximum chunk size (characters)
   */
  maxChunkSize?: number;

  /**
   * Extract metadata
   */
  extractMetadata?: boolean;

  /**
   * Treat each page as a separate message
   */
  pageAsMessage?: boolean;
}

interface PDFChunk {
  content: string;
  page: number;
  startChar: number;
  endChar: number;
}

/**
 * PDF document adapter
 */
export class PDFDocumentAdapter extends BaseAdapter {
  readonly id = 'pdf-document';
  readonly name = 'PDF Document Adapter';
  readonly version = '1.0.0';
  readonly supportedFormats = ['.pdf'];

  private documents: Map<string, any> = new Map();
  private lastUpdate: Date | null = null;

  async initialize(config: PDFDocumentConfig): Promise<void> {
    await super.initialize(config);

    const pdfConfig = config as PDFDocumentConfig;

    // Validate config
    if (!pdfConfig.pdfPaths) {
      throw new Error('pdfPaths is required in config');
    }

    // Normalize paths to array
    const paths = Array.isArray(pdfConfig.pdfPaths)
      ? pdfConfig.pdfPaths
      : [pdfConfig.pdfPaths];

    // Validate all paths exist
    for (const path of paths) {
      if (!existsSync(path)) {
        throw new Error(`PDF file not found: ${path}`);
      }
    }

    // Parse all PDFs
    for (const path of paths) {
      await this.parsePDF(path);
    }
  }

  /**
   * Parse a PDF file
   */
  private async parsePDF(path: string): Promise<void> {
    const buffer = await readFile(path);
    const data = await pdfParse(buffer, {
      // Options for pdf-parse
      pagerender: undefined, // Use default text renderer
    });

    this.documents.set(path, {
      path,
      filename: basename(path),
      info: data.info,
      metadata: data.metadata,
      text: data.text,
      numpages: data.numpages,
      version: data.version,
    });

    // Update last modified time
    const stats = await import('fs/promises').then(fs => fs.stat(path));
    const modifiedTime = stats.mtime;

    if (!this.lastUpdate || modifiedTime > this.lastUpdate) {
      this.lastUpdate = modifiedTime;
    }
  }

  async *fetch(options: FetchOptions = {}): AsyncIterator<ContextItem> {
    this.ensureReady();

    const config = this.config as PDFDocumentConfig;

    for (const [path, doc] of this.documents) {
      // Chunk the document
      const chunks = this.chunkDocument(doc);

      for (const chunk of chunks) {
        // Create context item
        const sourceId = `${doc.filename}:p${chunk.page}`;

        yield this.createContextItem(
          sourceId,
          chunk.content,
          'system', // PDFs are system-generated content
          this.lastUpdate || new Date(),
          {
            conversationId: doc.filename,
            metadata: {
              source_file: path,
              filename: doc.filename,
              page: chunk.page,
              total_pages: doc.numpages,
              chunk_start: chunk.startChar,
              chunk_end: chunk.endChar,
              pdf_info: config.extractMetadata ? doc.info : undefined,
            },
          }
        );
      }
    }
  }

  async fetchUpdates(since?: Date): Promise<ContextItem[]> {
    // PDFs are static, return all if modified after 'since'
    const items: ContextItem[] = [];

    if (!since || !this.lastUpdate || this.lastUpdate > since) {
      for await (const item of this.fetch()) {
        items.push(item);
      }
    }

    return items;
  }

  async getLastUpdate(): Promise<Date | null> {
    return this.lastUpdate;
  }

  async getStats(): Promise<AdapterStats> {
    this.ensureReady();

    let totalChunks = 0;

    for (const [, doc] of this.documents) {
      const chunks = this.chunkDocument(doc);
      totalChunks += chunks.length;
    }

    return {
      totalItems: totalChunks,
      totalConversations: this.documents.size,
      dateRange: {
        earliest: this.lastUpdate,
        latest: this.lastUpdate,
      },
      metadata: {
        documents: Array.from(this.documents.values()).map(doc => ({
          filename: doc.filename,
          pages: doc.numpages,
          version: doc.version,
        })),
      },
    };
  }

  /**
   * Chunk document based on strategy
   */
  private chunkDocument(doc: any): PDFChunk[] {
    const config = this.config as PDFDocumentConfig;
    const chunkBy = config.chunkBy || 'page';
    const maxChunkSize = config.maxChunkSize || 5000;

    if (chunkBy === 'page' || config.pageAsMessage) {
      // Chunk by page (approximate, since we don't have per-page text)
      return this.chunkByPages(doc.text, doc.numpages, maxChunkSize);
    } else if (chunkBy === 'paragraph') {
      return this.chunkByParagraphs(doc.text, maxChunkSize);
    } else {
      // Default: chunk by size
      return this.chunkBySize(doc.text, maxChunkSize);
    }
  }

  /**
   * Chunk text by approximate pages
   */
  private chunkByPages(text: string, numPages: number, maxSize: number): PDFChunk[] {
    const chunks: PDFChunk[] = [];
    const approxCharsPerPage = Math.ceil(text.length / numPages);

    let currentPos = 0;
    let currentPage = 1;

    while (currentPos < text.length) {
      const chunkSize = Math.min(approxCharsPerPage, maxSize);
      const endPos = Math.min(currentPos + chunkSize, text.length);

      // Find nearest paragraph boundary
      let actualEnd = endPos;
      const nextNewline = text.indexOf('\n\n', endPos - 100);

      if (nextNewline !== -1 && nextNewline < endPos + 100) {
        actualEnd = nextNewline;
      }

      chunks.push({
        content: text.slice(currentPos, actualEnd).trim(),
        page: currentPage,
        startChar: currentPos,
        endChar: actualEnd,
      });

      currentPos = actualEnd;
      currentPage++;
    }

    return chunks;
  }

  /**
   * Chunk text by paragraphs
   */
  private chunkByParagraphs(text: string, maxSize: number): PDFChunk[] {
    const chunks: PDFChunk[] = [];
    const paragraphs = text.split(/\n\n+/);

    let currentChunk = '';
    let currentStart = 0;
    let page = 1;

    for (const para of paragraphs) {
      if (currentChunk.length + para.length > maxSize && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          content: currentChunk.trim(),
          page,
          startChar: currentStart,
          endChar: currentStart + currentChunk.length,
        });

        currentChunk = para;
        currentStart += currentChunk.length;
        page++;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
    }

    // Save last chunk
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        page,
        startChar: currentStart,
        endChar: currentStart + currentChunk.length,
      });
    }

    return chunks;
  }

  /**
   * Chunk text by size
   */
  private chunkBySize(text: string, maxSize: number): PDFChunk[] {
    const chunks: PDFChunk[] = [];
    let currentPos = 0;
    let page = 1;

    while (currentPos < text.length) {
      const endPos = Math.min(currentPos + maxSize, text.length);

      chunks.push({
        content: text.slice(currentPos, endPos).trim(),
        page,
        startChar: currentPos,
        endChar: endPos,
      });

      currentPos = endPos;
      page++;
    }

    return chunks;
  }
}
