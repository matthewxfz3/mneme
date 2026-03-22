/**
 * Mneme Database Manager
 *
 * Manages multiple single-user databases (one per user).
 * Provides user-scoped service instances with connection pooling.
 *
 * Architecture:
 *   DatabaseManager
 *     ├─ alice → /data/users/alice/mneme.db
 *     ├─ bob   → /data/users/bob/mneme.db
 *     └─ charlie → /data/users/charlie/mneme.db
 *
 * Each database is a simple MnemeService (no multi-tenancy overhead).
 */

import { MnemeService, type MnemeConfig } from './service.js';
import { join, dirname } from 'path';
import { mkdirSync, existsSync, statSync } from 'fs';

export interface DatabaseManagerConfig {
  /**
   * Base directory for user databases
   * Example: '/data/mneme/users' or '~/.mneme/users'
   */
  baseDir: string;

  /**
   * Maximum number of open database connections to keep in memory
   * Older connections are closed when limit is exceeded
   * Default: 100
   */
  maxConnections?: number;

  /**
   * Time in milliseconds before an idle connection is closed
   * Default: 300000 (5 minutes)
   */
  idleTimeout?: number;

  /**
   * Enable adaptive connection pooling based on memory pressure
   * When enabled, maxConnections is treated as a ceiling and the actual
   * limit is dynamically adjusted based on available heap memory
   * Default: false
   */
  adaptivePooling?: boolean;

  /**
   * Memory threshold in bytes for adaptive pooling
   * When available heap memory falls below this, connections are evicted
   * Default: 100MB (100 * 1024 * 1024)
   */
  memoryThreshold?: number;

  /**
   * Enable automatic vacuum on idle connection cleanup
   * When enabled, incremental vacuum is run before closing idle connections
   * Default: true
   */
  autoVacuumOnIdle?: boolean;

  /**
   * Number of pages to vacuum when cleaning up idle connections
   * Default: 10 (approximately 40KB with 4KB page size)
   */
  vacuumPages?: number;

  /**
   * Enable file descriptor monitoring and warnings
   * Default: true
   */
  monitorFileDescriptors?: boolean;

  /**
   * Warning threshold for file descriptor usage (0-1)
   * Warning is logged when FD usage exceeds this percentage of the limit
   * Default: 0.8 (80%)
   */
  fdWarningThreshold?: number;

  /**
   * Default config applied to all user databases
   */
  defaultConfig?: Partial<MnemeConfig>;
}

interface CachedConnection {
  service: MnemeService;
  lastAccessed: number;
  dbPath: string;
}

interface ResourceMetrics {
  memory: {
    heapUsed: number;
    heapTotal: number;
    connectionPoolSize: number; // Estimated MB
    perConnectionAvg: number;   // Estimated KB
  };
  fileDescriptors: {
    estimated: number;         // 3 per connection (db, wal, shm)
    limit: number | null;      // OS limit if available
    utilizationPct: number | null;
  };
  disk: {
    totalDbSize: number;       // Bytes across all active connections
    avgDbSize: number;         // Average per connection
  };
}

interface PerformanceMetrics {
  cacheHitRate: number;        // Percentage
  evictionsTotal: number;      // Lifetime evictions
  vacuumsTotal: number;        // Lifetime vacuums performed
}

interface HealthStatus {
  score: number;               // 0-100
  status: 'healthy' | 'degraded' | 'critical';
  warnings: string[];
}

/**
 * Manages multiple user databases with connection pooling
 */
export class DatabaseManager {
  private connections = new Map<string, CachedConnection>();
  private config: Required<Omit<DatabaseManagerConfig, 'defaultConfig'>> & Pick<DatabaseManagerConfig, 'defaultConfig'>;
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Performance tracking
  private evictionsTotal = 0;
  private vacuumsTotal = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config: DatabaseManagerConfig) {
    this.config = {
      baseDir: config.baseDir,
      maxConnections: config.maxConnections ?? 100,
      idleTimeout: config.idleTimeout ?? 300000, // 5 minutes
      adaptivePooling: config.adaptivePooling ?? false,
      memoryThreshold: config.memoryThreshold ?? 100 * 1024 * 1024, // 100 MB
      autoVacuumOnIdle: config.autoVacuumOnIdle ?? true,
      vacuumPages: config.vacuumPages ?? 10,
      monitorFileDescriptors: config.monitorFileDescriptors ?? true,
      fdWarningThreshold: config.fdWarningThreshold ?? 0.8,
      defaultConfig: config.defaultConfig,
    };

    // Ensure base directory exists
    if (!existsSync(this.config.baseDir)) {
      mkdirSync(this.config.baseDir, { recursive: true });
    }

    // Start cleanup timer for idle connections
    this.startCleanupTimer();
  }

  /**
   * Get database path for a user
   */
  private getUserDbPath(userId: string): string {
    // Sanitize userId to prevent path traversal
    const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.config.baseDir, sanitized, 'mneme.db');
  }

  /**
   * Get or create a MnemeService instance for a user
   */
  getService(userId: string): MnemeService {
    const cached = this.connections.get(userId);

    if (cached) {
      // Cache hit - update last accessed time
      cached.lastAccessed = Date.now();
      this.cacheHits++;
      return cached.service;
    }

    // Cache miss
    this.cacheMisses++;

    // Check connection limit (with adaptive pooling if enabled)
    const effectiveMaxConnections = this.getEffectiveMaxConnections();
    if (this.connections.size >= effectiveMaxConnections) {
      this.evictOldestConnection();
    }

    // Monitor file descriptors before creating new connection
    if (this.config.monitorFileDescriptors) {
      this.checkFileDescriptorLimit();
    }

    // Create new service
    const dbPath = this.getUserDbPath(userId);

    // Ensure user directory exists
    const userDir = dirname(dbPath);
    if (!existsSync(userDir)) {
      mkdirSync(userDir, { recursive: true });
    }

    const service = new MnemeService({
      dbPath,
      ...this.config.defaultConfig,
    });

    // Cache it
    this.connections.set(userId, {
      service,
      lastAccessed: Date.now(),
      dbPath,
    });

    return service;
  }

  /**
   * Close a specific user's database connection
   */
  closeUserConnection(userId: string): void {
    const cached = this.connections.get(userId);
    if (cached) {
      cached.service.close();
      this.connections.delete(userId);
    }
  }

  /**
   * Close all database connections
   */
  closeAll(): void {
    for (const [userId, cached] of this.connections) {
      cached.service.close();
    }
    this.connections.clear();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get statistics about managed databases
   */
  getManagerStats(): {
    activeConnections: number;
    maxConnections: number;
    effectiveMaxConnections: number;
    users: Array<{
      userId: string;
      dbPath: string;
      lastAccessed: number;
      idleTime: number;
    }>;
    resources: ResourceMetrics;
    performance: PerformanceMetrics;
    health: HealthStatus;
  } {
    const now = Date.now();
    const users = Array.from(this.connections.entries()).map(([userId, cached]) => ({
      userId,
      dbPath: cached.dbPath,
      lastAccessed: cached.lastAccessed,
      idleTime: now - cached.lastAccessed,
    }));

    return {
      activeConnections: this.connections.size,
      maxConnections: this.config.maxConnections,
      effectiveMaxConnections: this.getEffectiveMaxConnections(),
      users,
      resources: this.getResourceMetrics(),
      performance: this.getPerformanceMetrics(),
      health: this.getHealthStatus(),
    };
  }

  /**
   * Get aggregate statistics across all user databases
   */
  getAggregateStats(): {
    totalUsers: number;
    totalConversations: number;
    totalMessages: number;
    totalTokens: number;
  } {
    let totalConversations = 0;
    let totalMessages = 0;
    let totalTokens = 0;

    for (const cached of this.connections.values()) {
      const stats = cached.service.getStats();
      totalConversations += stats.conversations;
      totalMessages += stats.messages;
      totalTokens += stats.totalTokens;
    }

    return {
      totalUsers: this.connections.size,
      totalConversations,
      totalMessages,
      totalTokens,
    };
  }

  /**
   * List all user IDs that have databases
   */
  listUsers(): string[] {
    const users: string[] = [];
    const baseDir = this.config.baseDir;

    if (!existsSync(baseDir)) {
      return users;
    }

    const entries = require('fs').readdirSync(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dbPath = join(baseDir, entry.name, 'mneme.db');
        if (existsSync(dbPath)) {
          users.push(entry.name);
        }
      }
    }

    return users;
  }

  /**
   * Check if a user has a database
   */
  hasUser(userId: string): boolean {
    const dbPath = this.getUserDbPath(userId);
    return existsSync(dbPath);
  }

  /**
   * Delete a user's database (DANGEROUS - no undo!)
   */
  deleteUserDatabase(userId: string): void {
    // Close connection if open
    this.closeUserConnection(userId);

    // Delete the database file
    const dbPath = this.getUserDbPath(userId);
    if (existsSync(dbPath)) {
      require('fs').unlinkSync(dbPath);

      // Also delete WAL and SHM files if they exist
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      if (existsSync(walPath)) require('fs').unlinkSync(walPath);
      if (existsSync(shmPath)) require('fs').unlinkSync(shmPath);
    }

    // Remove directory if empty
    const userDir = dirname(dbPath);
    try {
      require('fs').rmdirSync(userDir);
    } catch (error) {
      // Directory not empty or doesn't exist, ignore
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Evict the least recently used connection
   */
  private evictOldestConnection(): void {
    let oldestUserId: string | null = null;
    let oldestTime = Date.now();

    for (const [userId, cached] of this.connections) {
      if (cached.lastAccessed < oldestTime) {
        oldestTime = cached.lastAccessed;
        oldestUserId = userId;
      }
    }

    if (oldestUserId) {
      this.closeUserConnection(oldestUserId);
      this.evictionsTotal++;
    }
  }

  /**
   * Start periodic cleanup of idle connections
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 60000); // Check every minute
  }

  /**
   * Close connections that have been idle too long
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    const toClose: string[] = [];

    for (const [userId, cached] of this.connections) {
      const idleTime = now - cached.lastAccessed;
      if (idleTime > this.config.idleTimeout) {
        toClose.push(userId);
      }
    }

    for (const userId of toClose) {
      // Auto-vacuum before closing if enabled
      if (this.config.autoVacuumOnIdle) {
        const cached = this.connections.get(userId);
        if (cached) {
          try {
            cached.service.autoVacuum(this.config.vacuumPages);
            this.vacuumsTotal++;
          } catch (error) {
            // Ignore vacuum errors - connection might be in bad state
          }
        }
      }

      this.closeUserConnection(userId);
    }
  }

  /**
   * Get effective max connections based on adaptive pooling settings
   */
  private getEffectiveMaxConnections(): number {
    if (!this.config.adaptivePooling) {
      return this.config.maxConnections;
    }

    const memUsage = process.memoryUsage();
    const availableMemory = memUsage.heapTotal - memUsage.heapUsed;

    // If below memory threshold, reduce max connections
    if (availableMemory < this.config.memoryThreshold) {
      // Estimate ~750 KB per connection (conservative)
      const connectionsFromMemory = Math.floor(availableMemory / 750_000);
      return Math.max(10, Math.min(this.config.maxConnections, connectionsFromMemory));
    }

    return this.config.maxConnections;
  }

  /**
   * Check file descriptor usage and warn if approaching limit
   */
  private checkFileDescriptorLimit(): void {
    // Each connection uses 3 file descriptors (db, wal, shm)
    const currentFDs = this.connections.size * 3;

    // Try to get system limit (platform-specific)
    let limit: number | null = null;
    try {
      if (process.platform === 'linux' || process.platform === 'darwin') {
        // On Unix-like systems, we can estimate based on common defaults
        // This is a conservative estimate - actual limit requires syscall
        limit = 1024; // Common default soft limit
      }
    } catch (error) {
      // Ignore errors getting limit
    }

    if (limit && currentFDs > limit * this.config.fdWarningThreshold) {
      console.warn(
        `[DatabaseManager] File descriptor usage high: ${currentFDs}/${limit} (${Math.round((currentFDs / limit) * 100)}%)\n` +
        `Consider increasing file descriptor limit: ulimit -n 65536`
      );
    }
  }

  /**
   * Get resource usage metrics
   */
  private getResourceMetrics(): ResourceMetrics {
    const memUsage = process.memoryUsage();
    const connectionCount = this.connections.size;

    // Estimate connection pool memory usage
    // ~500 KB average per connection (MnemeService + better-sqlite3 + statements)
    const estimatedPoolSizeMB = (connectionCount * 500_000) / (1024 * 1024);
    const perConnectionKB = connectionCount > 0 ? (estimatedPoolSizeMB * 1024) / connectionCount : 0;

    // Calculate total disk usage across active connections
    let totalDbSize = 0;
    for (const cached of this.connections.values()) {
      try {
        const stats = statSync(cached.dbPath);
        totalDbSize += stats.size;

        // Also count WAL and SHM files if they exist
        try {
          const walStats = statSync(`${cached.dbPath}-wal`);
          totalDbSize += walStats.size;
        } catch (e) { /* WAL doesn't exist */ }

        try {
          const shmStats = statSync(`${cached.dbPath}-shm`);
          totalDbSize += shmStats.size;
        } catch (e) { /* SHM doesn't exist */ }
      } catch (error) {
        // File doesn't exist or can't be read
      }
    }

    const avgDbSize = connectionCount > 0 ? totalDbSize / connectionCount : 0;

    // File descriptor estimation
    const estimatedFDs = connectionCount * 3;
    let fdLimit: number | null = null;
    let fdUtilization: number | null = null;

    try {
      if (process.platform === 'linux' || process.platform === 'darwin') {
        fdLimit = 1024; // Common default
        fdUtilization = (estimatedFDs / fdLimit) * 100;
      }
    } catch (error) {
      // Ignore
    }

    return {
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        connectionPoolSize: estimatedPoolSizeMB,
        perConnectionAvg: perConnectionKB,
      },
      fileDescriptors: {
        estimated: estimatedFDs,
        limit: fdLimit,
        utilizationPct: fdUtilization,
      },
      disk: {
        totalDbSize,
        avgDbSize,
      },
    };
  }

  /**
   * Get performance metrics
   */
  private getPerformanceMetrics(): PerformanceMetrics {
    const totalAccesses = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalAccesses > 0 ? (this.cacheHits / totalAccesses) * 100 : 0;

    return {
      cacheHitRate,
      evictionsTotal: this.evictionsTotal,
      vacuumsTotal: this.vacuumsTotal,
    };
  }

  /**
   * Calculate overall health status
   */
  private getHealthStatus(): HealthStatus {
    const warnings: string[] = [];
    let score = 100;

    // Check memory pressure
    const memUsage = process.memoryUsage();
    const memUtilization = memUsage.heapUsed / memUsage.heapTotal;
    if (memUtilization > 0.9) {
      warnings.push('Critical memory pressure (>90% heap used)');
      score -= 40;
    } else if (memUtilization > 0.8) {
      warnings.push('High memory pressure (>80% heap used)');
      score -= 20;
    }

    // Check file descriptor usage
    const estimatedFDs = this.connections.size * 3;
    const fdLimit = 1024; // Conservative estimate
    if (estimatedFDs > fdLimit * 0.9) {
      warnings.push('Critical file descriptor usage (>90% of limit)');
      score -= 30;
    } else if (estimatedFDs > fdLimit * this.config.fdWarningThreshold) {
      warnings.push(`High file descriptor usage (>${Math.round(this.config.fdWarningThreshold * 100)}% of limit)`);
      score -= 15;
    }

    // Check cache hit rate
    const totalAccesses = this.cacheHits + this.cacheMisses;
    if (totalAccesses > 100) { // Only check if we have meaningful data
      const hitRate = (this.cacheHits / totalAccesses) * 100;
      if (hitRate < 50) {
        warnings.push('Low cache hit rate (<50%) - consider increasing maxConnections');
        score -= 10;
      }
    }

    // Check eviction rate vs cache size
    if (this.evictionsTotal > this.config.maxConnections * 10) {
      warnings.push('High eviction rate - consider increasing maxConnections or enabling adaptive pooling');
      score -= 10;
    }

    // Determine status
    let status: 'healthy' | 'degraded' | 'critical';
    if (score >= 80) {
      status = 'healthy';
    } else if (score >= 50) {
      status = 'degraded';
    } else {
      status = 'critical';
    }

    return {
      score: Math.max(0, score),
      status,
      warnings,
    };
  }
}

/**
 * Helper function to create a user-scoped service
 * Convenience wrapper around DatabaseManager
 */
export function createUserService(
  manager: DatabaseManager,
  userId: string
): MnemeService {
  return manager.getService(userId);
}
