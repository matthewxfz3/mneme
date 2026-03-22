/**
 * Mneme M2 - Update Queue
 *
 * Manages updates from multiple sources with priority handling.
 * Coordinates ingestion, entity extraction, and embedding generation.
 */

import type Database from 'better-sqlite3';

export interface UpdateTask {
  task_id: string;
  source_type: string;
  source_path: string;
  priority: 'urgent' | 'normal' | 'low';
  created_at: number;
  started_at?: number;
  completed_at?: number;
  attempts: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  last_error?: string;
  metadata?: Record<string, any>;
}

export interface UpdateResult {
  messages_added: number;
  entities_extracted: number;
  relationships_created: number;
  embeddings_queued: number;
  duration_ms: number;
}

export interface UpdateQueueOptions {
  maxConcurrent?: number;
  maxRetries?: number;
  retryDelay?: number;
  pollInterval?: number;
}

export interface UpdateProcessor {
  /**
   * Process an update task
   */
  process(task: UpdateTask): Promise<UpdateResult>;

  /**
   * Get processor name
   */
  getName(): string;
}

/**
 * Update queue with priority handling
 */
export class UpdateQueue {
  private processing = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private processors = new Map<string, UpdateProcessor>();
  private options: Required<UpdateQueueOptions>;
  private activeCount = 0;

  constructor(
    private db: Database.Database,
    options: UpdateQueueOptions = {}
  ) {
    this.options = {
      maxConcurrent: options.maxConcurrent || 3,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 5000,
      pollInterval: options.pollInterval || 10000,
    };

    this.initializeQueue();
  }

  /**
   * Initialize queue table
   */
  private initializeQueue(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS update_queue (
        task_id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_path TEXT NOT NULL,
        priority TEXT CHECK(priority IN ('urgent', 'normal', 'low')) DEFAULT 'normal',
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        attempts INTEGER DEFAULT 0,
        status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
        last_error TEXT,
        metadata TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_update_queue_status_priority
      ON update_queue(status, priority, created_at)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_update_queue_source
      ON update_queue(source_type, source_path)
    `);
  }

  /**
   * Register an update processor
   */
  registerProcessor(sourceType: string, processor: UpdateProcessor): void {
    this.processors.set(sourceType, processor);
  }

  /**
   * Enqueue an update task
   */
  async enqueue(
    sourceType: string,
    sourcePath: string,
    priority: 'urgent' | 'normal' | 'low' = 'normal',
    metadata?: Record<string, any>
  ): Promise<string> {
    // Check if processor exists
    if (!this.processors.has(sourceType)) {
      throw new Error(
        `No processor registered for source type: ${sourceType}. ` +
        `Available: ${Array.from(this.processors.keys()).join(', ')}`
      );
    }

    // Check if already queued
    const existing = this.db.prepare(`
      SELECT task_id FROM update_queue
      WHERE source_type = ?
        AND source_path = ?
        AND status IN ('pending', 'processing')
    `).get(sourceType, sourcePath) as { task_id: string } | undefined;

    if (existing) {
      return existing.task_id;
    }

    // Add to queue
    const taskId = `upd_${sourceType}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    this.db.prepare(`
      INSERT INTO update_queue (
        task_id, source_type, source_path, priority,
        created_at, status, metadata
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      taskId,
      sourceType,
      sourcePath,
      priority,
      Date.now(),
      metadata ? JSON.stringify(metadata) : null
    );

    // Start processing if urgent
    if (priority === 'urgent' && !this.processing) {
      setImmediate(() => this.processQueue());
    }

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

    this.processing = false;
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
      while (this.activeCount < this.options.maxConcurrent) {
        // Get next task
        const task = this.getNextTask();

        if (!task) {
          break; // Queue empty
        }

        // Process task (async)
        this.activeCount++;
        this.processTask(task)
          .finally(() => {
            this.activeCount--;
            // Trigger next batch if needed
            if (this.processing) {
              setImmediate(() => this.processQueue());
            }
          });
      }
    } catch (error) {
      console.error('Error processing update queue:', error);
    } finally {
      if (this.activeCount === 0) {
        this.processing = false;
      }
    }
  }

  /**
   * Get next task to process
   */
  private getNextTask(): UpdateTask | null {
    const task = this.db.prepare(`
      SELECT * FROM update_queue
      WHERE status = 'pending'
        AND attempts < ?
      ORDER BY
        CASE priority
          WHEN 'urgent' THEN 0
          WHEN 'normal' THEN 1
          WHEN 'low' THEN 2
        END,
        created_at ASC
      LIMIT 1
    `).get(this.options.maxRetries) as UpdateTask | undefined;

    if (!task) return null;

    // Mark as processing
    this.db.prepare(`
      UPDATE update_queue
      SET status = 'processing',
          started_at = ?,
          attempts = attempts + 1
      WHERE task_id = ?
    `).run(Date.now(), task.task_id);

    // Parse metadata
    if (task.metadata) {
      task.metadata = JSON.parse(task.metadata as any);
    }

    return task;
  }

  /**
   * Process a single task
   */
  private async processTask(task: UpdateTask): Promise<void> {
    const startTime = Date.now();

    try {
      // Get processor
      const processor = this.processors.get(task.source_type);

      if (!processor) {
        throw new Error(`No processor for source type: ${task.source_type}`);
      }

      // Process update
      const result = await processor.process(task);

      // Mark as completed
      this.db.prepare(`
        UPDATE update_queue
        SET status = 'completed',
            completed_at = ?,
            last_error = NULL,
            metadata = ?
        WHERE task_id = ?
      `).run(
        Date.now(),
        JSON.stringify({ ...task.metadata, result }),
        task.task_id
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;

      // Determine if should retry
      const shouldRetry = task.attempts < this.options.maxRetries;
      const status = shouldRetry ? 'pending' : 'failed';

      this.db.prepare(`
        UPDATE update_queue
        SET status = ?,
            last_error = ?,
            metadata = ?
        WHERE task_id = ?
      `).run(
        status,
        errorMessage,
        JSON.stringify({
          ...task.metadata,
          error: errorMessage,
          duration_ms: duration,
        }),
        task.task_id
      );

      // Log error
      console.error(
        `Update task ${task.task_id} failed (attempt ${task.attempts}):`,
        error
      );

      // If should retry, schedule next attempt
      if (shouldRetry) {
        setTimeout(() => {
          if (this.processing) {
            setImmediate(() => this.processQueue());
          }
        }, this.options.retryDelay);
      }
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
    by_source: Array<{ source_type: string; count: number }>;
  } {
    // Get counts by status
    const statusRows = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM update_queue
      GROUP BY status
    `).all() as Array<{ status: string; count: number }>;

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: 0,
      by_source: [] as Array<{ source_type: string; count: number }>,
    };

    for (const row of statusRows) {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = row.count;
      }
      stats.total += row.count;
    }

    // Get counts by source
    const sourceRows = this.db.prepare(`
      SELECT source_type, COUNT(*) as count
      FROM update_queue
      WHERE status IN ('pending', 'processing')
      GROUP BY source_type
      ORDER BY count DESC
    `).all() as Array<{ source_type: string; count: number }>;

    stats.by_source = sourceRows;

    return stats;
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId: string): UpdateTask | null {
    const task = this.db.prepare(`
      SELECT * FROM update_queue
      WHERE task_id = ?
    `).get(taskId) as UpdateTask | undefined;

    if (!task) return null;

    if (task.metadata) {
      task.metadata = JSON.parse(task.metadata as any);
    }

    return task;
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM update_queue
      WHERE task_id = ? AND status IN ('pending', 'failed')
    `).run(taskId);

    return result.changes > 0;
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(olderThan?: number): number {
    let query = `DELETE FROM update_queue WHERE status = 'completed'`;
    const params: any[] = [];

    if (olderThan) {
      query += ` AND completed_at < ?`;
      params.push(olderThan);
    }

    const result = this.db.prepare(query).run(...params);
    return result.changes;
  }

  /**
   * Retry failed tasks
   */
  retryFailed(): number {
    const result = this.db.prepare(`
      UPDATE update_queue
      SET status = 'pending',
          attempts = 0,
          last_error = NULL,
          started_at = NULL
      WHERE status = 'failed'
    `).run();

    // Trigger processing
    if (result.changes > 0 && !this.processing) {
      setImmediate(() => this.processQueue());
    }

    return result.changes;
  }

  /**
   * Get recent tasks
   */
  getRecentTasks(limit: number = 10): UpdateTask[] {
    const tasks = this.db.prepare(`
      SELECT * FROM update_queue
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as UpdateTask[];

    return tasks.map(task => {
      if (task.metadata) {
        task.metadata = JSON.parse(task.metadata as any);
      }
      return task;
    });
  }
}
