/**
 * Mneme M2 - Embedding Queue
 *
 * Background queue for async embedding generation.
 * Prevents blocking on message ingestion by processing embeddings asynchronously.
 */

import type Database from 'better-sqlite3';
import { EmbeddingGenerator, type EmbeddingOptions } from './embedding-generator.js';
import { VectorSearchEngine } from './vector-search.js';

export interface QueueTask {
  task_id: string;
  message_id: string;
  content: string;
  priority: 'urgent' | 'normal' | 'low';
  created_at: number;
  attempts: number;
  last_error?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface QueueOptions {
  batchSize?: number;
  maxRetries?: number;
  retryDelay?: number;
  pollInterval?: number;
  maxQueueSize?: number;
}

/**
 * Embedding generation queue with retry logic
 */
export class EmbeddingQueue {
  private processing = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private options: Required<QueueOptions>;

  constructor(
    private db: Database.Database,
    private embeddingGenerator: EmbeddingGenerator,
    private vectorSearch: VectorSearchEngine,
    options: QueueOptions = {}
  ) {
    this.options = {
      batchSize: options.batchSize || 50,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 5000,
      pollInterval: options.pollInterval || 10000,
      maxQueueSize: options.maxQueueSize || 10000,
    };

    this.initializeQueue();
  }

  /**
   * Initialize queue table
   */
  private initializeQueue(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_queue (
        task_id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        content TEXT NOT NULL,
        priority TEXT CHECK(priority IN ('urgent', 'normal', 'low')) DEFAULT 'normal',
        created_at INTEGER NOT NULL,
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
        FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_embedding_queue_status_priority
      ON embedding_queue(status, priority, created_at)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_embedding_queue_message
      ON embedding_queue(message_id)
    `);
  }

  /**
   * Add a message to the embedding queue
   */
  async enqueue(
    messageId: string,
    content: string,
    priority: 'urgent' | 'normal' | 'low' = 'normal'
  ): Promise<string> {
    // Check if already queued or has embedding
    if (this.vectorSearch.hasEmbedding(messageId)) {
      return 'already-embedded';
    }

    const existing = this.db.prepare(`
      SELECT task_id FROM embedding_queue
      WHERE message_id = ? AND status IN ('pending', 'processing')
    `).get(messageId) as { task_id: string } | undefined;

    if (existing) {
      return existing.task_id;
    }

    // Check queue size limit (provides backpressure)
    const queueSize = this.db.prepare(`
      SELECT COUNT(*) as count FROM embedding_queue
      WHERE status = 'pending'
    `).get() as { count: number };

    if (queueSize.count >= this.options.maxQueueSize) {
      throw new Error(
        `Embedding queue full (${queueSize.count}/${this.options.maxQueueSize}). ` +
        `Please wait for processing to complete or increase maxQueueSize.`
      );
    }

    // Add to queue
    const taskId = `emb_${messageId}_${Date.now()}`;

    this.db.prepare(`
      INSERT INTO embedding_queue (
        task_id, message_id, content, priority, created_at, status
      ) VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(taskId, messageId, content, priority, Date.now());

    // Start processing if not already running
    if (!this.processing && priority === 'urgent') {
      // Process urgent tasks immediately
      setImmediate(() => this.processQueue());
    }

    return taskId;
  }

  /**
   * Add multiple messages to queue
   */
  async enqueueBatch(
    items: Array<{
      messageId: string;
      content: string;
      priority?: 'urgent' | 'normal' | 'low';
    }>
  ): Promise<string[]> {
    const taskIds: string[] = [];

    const transaction = this.db.transaction(() => {
      for (const item of items) {
        const taskId = this.enqueueSync(
          item.messageId,
          item.content,
          item.priority || 'normal'
        );
        taskIds.push(taskId);
      }
    });

    transaction();

    return taskIds;
  }

  /**
   * Synchronous enqueue for use in transactions
   */
  private enqueueSync(
    messageId: string,
    content: string,
    priority: 'urgent' | 'normal' | 'low'
  ): string {
    if (this.vectorSearch.hasEmbedding(messageId)) {
      return 'already-embedded';
    }

    const existing = this.db.prepare(`
      SELECT task_id FROM embedding_queue
      WHERE message_id = ? AND status IN ('pending', 'processing')
    `).get(messageId) as { task_id: string } | undefined;

    if (existing) {
      return existing.task_id;
    }

    const taskId = `emb_${messageId}_${Date.now()}`;

    this.db.prepare(`
      INSERT INTO embedding_queue (
        task_id, message_id, content, priority, created_at, status
      ) VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(taskId, messageId, content, priority, Date.now());

    return taskId;
  }

  /**
   * Start background processing
   */
  start(): void {
    if (this.pollTimer) {
      return; // Already started
    }

    // Start polling
    this.pollTimer = setInterval(
      () => this.processQueue(),
      this.options.pollInterval
    );

    // Process immediately
    setImmediate(() => this.processQueue());
  }

  /**
   * Stop background processing
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Process the queue
   */
  async processQueue(): Promise<void> {
    if (this.processing) {
      return; // Already processing
    }

    this.processing = true;

    try {
      while (true) {
        // Get next batch of tasks
        const tasks = this.getNextBatch();

        if (tasks.length === 0) {
          break; // Queue empty
        }

        await this.processBatch(tasks);
      }
    } catch (error) {
      console.error('Error processing embedding queue:', error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Get next batch of tasks to process
   */
  private getNextBatch(): QueueTask[] {
    const tasks = this.db.prepare(`
      SELECT * FROM embedding_queue
      WHERE status = 'pending'
        AND attempts < ?
      ORDER BY
        CASE priority
          WHEN 'urgent' THEN 0
          WHEN 'normal' THEN 1
          WHEN 'low' THEN 2
        END,
        created_at ASC
      LIMIT ?
    `).all(this.options.maxRetries, this.options.batchSize) as QueueTask[];

    return tasks;
  }

  /**
   * Process a batch of tasks
   */
  private async processBatch(tasks: QueueTask[]): Promise<void> {
    // Mark as processing
    const updateStmt = this.db.prepare(`
      UPDATE embedding_queue
      SET status = 'processing', attempts = attempts + 1
      WHERE task_id = ?
    `);

    for (const task of tasks) {
      updateStmt.run(task.task_id);
    }

    try {
      // Generate embeddings in batch
      const texts = tasks.map(t => t.content);
      const embeddings = await this.embeddingGenerator.generateBatch(texts, {
        truncate: true,
        normalize: true,
      });

      // Store embeddings
      const items = tasks.map((task, idx) => ({
        messageId: task.message_id,
        embedding: embeddings[idx],
        metadata: {
          provider: this.embeddingGenerator.getProvider().name,
          version: '1.0',
        },
      }));

      await this.vectorSearch.addEmbeddingsBatch(items);

      // Mark as completed
      const completeStmt = this.db.prepare(`
        UPDATE embedding_queue
        SET status = 'completed'
        WHERE task_id = ?
      `);

      for (const task of tasks) {
        completeStmt.run(task.task_id);
      }
    } catch (error) {
      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : String(error);

      const failStmt = this.db.prepare(`
        UPDATE embedding_queue
        SET status = ?, last_error = ?
        WHERE task_id = ?
      `);

      for (const task of tasks) {
        const status = task.attempts + 1 >= this.options.maxRetries ? 'failed' : 'pending';
        failStmt.run(status, errorMessage, task.task_id);
      }

      // Re-throw for logging
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  } {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM embedding_queue
      GROUP BY status
    `).all() as Array<{ status: string; count: number }>;

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: 0,
    };

    for (const row of rows) {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = row.count;
      }
      stats.total += row.count;
    }

    return stats;
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(): number {
    const result = this.db.prepare(`
      DELETE FROM embedding_queue
      WHERE status = 'completed'
    `).run();

    return result.changes;
  }

  /**
   * Retry failed tasks
   */
  retryFailed(): number {
    const result = this.db.prepare(`
      UPDATE embedding_queue
      SET status = 'pending', attempts = 0, last_error = NULL
      WHERE status = 'failed'
    `).run();

    return result.changes;
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId: string): QueueTask | null {
    const task = this.db.prepare(`
      SELECT * FROM embedding_queue
      WHERE task_id = ?
    `).get(taskId) as QueueTask | undefined;

    return task || null;
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM embedding_queue
      WHERE task_id = ? AND status IN ('pending', 'failed')
    `).run(taskId);

    return result.changes > 0;
  }
}
