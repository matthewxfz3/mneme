/**
 * Mneme M2 - File Watcher
 *
 * Watches files/directories for changes and triggers updates.
 * Uses chokidar for cross-platform file watching.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { readFile, stat } from 'fs/promises';
import { basename } from 'path';

export type WatchEvent = 'add' | 'change' | 'unlink';

export interface FileChangeEvent {
  path: string;
  event: WatchEvent;
  timestamp: number;
  stats?: {
    size: number;
    modified: number;
  };
}

export interface WatcherOptions {
  /**
   * Paths to watch (files or directories)
   */
  paths: string[];

  /**
   * Glob patterns to ignore
   */
  ignored?: string | RegExp | Array<string | RegExp>;

  /**
   * Whether to watch subdirectories
   */
  recursive?: boolean;

  /**
   * Debounce delay in milliseconds
   */
  awaitWriteFinish?: {
    stabilityThreshold?: number;
    pollInterval?: number;
  };

  /**
   * Whether to ignore initial add events
   */
  ignoreInitial?: boolean;

  /**
   * File extensions to watch (e.g., ['.txt', '.md'])
   */
  extensions?: string[];
}

export interface FileWatcherCallbacks {
  /**
   * Called when a file change is detected
   */
  onChange: (event: FileChangeEvent) => Promise<void> | void;

  /**
   * Called when an error occurs
   */
  onError?: (error: Error) => void;

  /**
   * Called when watcher is ready
   */
  onReady?: () => void;
}

/**
 * File watcher for auto-update
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private isRunning = false;
  private watchedPaths = new Set<string>();

  constructor(
    private options: WatcherOptions,
    private callbacks: FileWatcherCallbacks
  ) {}

  /**
   * Start watching files
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Watcher is already running');
    }

    const {
      paths,
      ignored = /(^|[\/\\])\../,  // Ignore dotfiles by default
      recursive = true,
      awaitWriteFinish = {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
      ignoreInitial = true,
      extensions,
    } = this.options;

    // Build ignore patterns
    const ignorePatterns: Array<string | RegExp> = Array.isArray(ignored)
      ? ignored
      : [ignored];

    // Add extension filtering if specified
    if (extensions && extensions.length > 0) {
      ignorePatterns.push((filePath: string) => {
        const ext = filePath.slice(filePath.lastIndexOf('.'));
        return !extensions.includes(ext);
      });
    }

    // Create watcher
    this.watcher = chokidar.watch(paths, {
      ignored: ignorePatterns,
      persistent: true,
      ignoreInitial,
      awaitWriteFinish,
      depth: recursive ? undefined : 0,
    });

    // Register event handlers
    this.watcher
      .on('add', (path) => this.handleEvent(path, 'add'))
      .on('change', (path) => this.handleEvent(path, 'change'))
      .on('unlink', (path) => this.handleEvent(path, 'unlink'))
      .on('error', (error) => {
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        } else {
          console.error('File watcher error:', error);
        }
      })
      .on('ready', () => {
        this.isRunning = true;
        if (this.callbacks.onReady) {
          this.callbacks.onReady();
        }
      });

    // Store watched paths
    for (const path of paths) {
      this.watchedPaths.add(path);
    }
  }

  /**
   * Stop watching files
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.watcher) {
      return;
    }

    await this.watcher.close();
    this.watcher = null;
    this.isRunning = false;
    this.watchedPaths.clear();
  }

  /**
   * Add path to watch
   */
  async addPath(path: string): Promise<void> {
    if (!this.watcher) {
      throw new Error('Watcher not started');
    }

    this.watcher.add(path);
    this.watchedPaths.add(path);
  }

  /**
   * Remove path from watch
   */
  async removePath(path: string): Promise<void> {
    if (!this.watcher) {
      throw new Error('Watcher not started');
    }

    this.watcher.unwatch(path);
    this.watchedPaths.delete(path);
  }

  /**
   * Get watched paths
   */
  getWatchedPaths(): string[] {
    return Array.from(this.watchedPaths);
  }

  /**
   * Check if watcher is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Handle file change event
   */
  private async handleEvent(path: string, event: WatchEvent): Promise<void> {
    try {
      // Get file stats (if file still exists)
      let stats: FileChangeEvent['stats'];

      if (event !== 'unlink') {
        try {
          const fileStat = await stat(path);
          stats = {
            size: fileStat.size,
            modified: fileStat.mtimeMs,
          };
        } catch {
          // File might have been deleted between event and stat
          stats = undefined;
        }
      }

      const changeEvent: FileChangeEvent = {
        path,
        event,
        timestamp: Date.now(),
        stats,
      };

      // Call onChange callback
      await this.callbacks.onChange(changeEvent);
    } catch (error) {
      if (this.callbacks.onError) {
        this.callbacks.onError(
          error instanceof Error ? error : new Error(String(error))
        );
      } else {
        console.error(`Error handling ${event} event for ${path}:`, error);
      }
    }
  }
}

/**
 * Create a file watcher
 */
export function createFileWatcher(
  options: WatcherOptions,
  callbacks: FileWatcherCallbacks
): FileWatcher {
  return new FileWatcher(options, callbacks);
}

/**
 * Watch a single file
 */
export async function watchFile(
  path: string,
  onChange: (event: FileChangeEvent) => Promise<void> | void,
  options: Omit<WatcherOptions, 'paths'> = {}
): Promise<FileWatcher> {
  const watcher = new FileWatcher(
    {
      ...options,
      paths: [path],
      recursive: false,
    },
    { onChange }
  );

  await watcher.start();
  return watcher;
}

/**
 * Watch a directory
 */
export async function watchDirectory(
  path: string,
  onChange: (event: FileChangeEvent) => Promise<void> | void,
  options: Omit<WatcherOptions, 'paths'> = {}
): Promise<FileWatcher> {
  const watcher = new FileWatcher(
    {
      ...options,
      paths: [path],
      recursive: options.recursive !== false, // Default to true
    },
    { onChange }
  );

  await watcher.start();
  return watcher;
}
