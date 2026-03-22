/**
 * Performance testing utilities
 *
 * Provides tools for measuring and analyzing performance metrics
 */

/**
 * High-resolution performance timer
 */
export class PerformanceTimer {
  private startTime: number = 0;
  private endTime: number = 0;
  private measurements: number[] = [];

  /**
   * Start the timer
   */
  start(): void {
    this.startTime = performance.now();
  }

  /**
   * Stop the timer and record measurement
   */
  stop(): number {
    this.endTime = performance.now();
    const duration = this.endTime - this.startTime;
    this.measurements.push(duration);
    return duration;
  }

  /**
   * Get the last measurement
   */
  getLast(): number {
    return this.measurements[this.measurements.length - 1] || 0;
  }

  /**
   * Get all measurements
   */
  getAll(): number[] {
    return [...this.measurements];
  }

  /**
   * Get statistics for all measurements
   */
  getStats(): PerformanceStats {
    if (this.measurements.length === 0) {
      return {
        count: 0,
        mean: 0,
        median: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const sorted = [...this.measurements].sort((a, b) => a - b);

    return {
      count: this.measurements.length,
      mean: mean(this.measurements),
      median: percentile(sorted, 0.5),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    };
  }

  /**
   * Reset all measurements
   */
  reset(): void {
    this.measurements = [];
    this.startTime = 0;
    this.endTime = 0;
  }

  /**
   * Measure an async function
   */
  async measure<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    this.start();
    const result = await fn();
    const duration = this.stop();
    return { result, duration };
  }

  /**
   * Measure a sync function
   */
  measureSync<T>(fn: () => T): { result: T; duration: number } {
    this.start();
    const result = fn();
    const duration = this.stop();
    return { result, duration };
  }
}

/**
 * Performance statistics interface
 */
export interface PerformanceStats {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Calculate percentile from sorted array
 */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (p <= 0) return sortedValues[0];
  if (p >= 1) return sortedValues[sortedValues.length - 1];

  const index = p * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sortedValues[lower];
  }

  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Calculate mean (average)
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(value => Math.pow(value - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

/**
 * Memory tracker
 */
export class MemoryTracker {
  private snapshots: MemorySnapshot[] = [];

  /**
   * Take a memory snapshot
   */
  snapshot(label?: string): MemorySnapshot {
    const memUsage = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      label: label || `snapshot-${this.snapshots.length}`,
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Get memory delta between two snapshots
   */
  getDelta(fromIndex: number, toIndex: number): MemoryDelta {
    const from = this.snapshots[fromIndex];
    const to = this.snapshots[toIndex];

    if (!from || !to) {
      throw new Error('Invalid snapshot indices');
    }

    return {
      heapUsedDelta: to.heapUsed - from.heapUsed,
      heapTotalDelta: to.heapTotal - from.heapTotal,
      externalDelta: to.external - from.external,
      rssDelta: to.rss - from.rss,
      timeDelta: to.timestamp - from.timestamp,
    };
  }

  /**
   * Reset all snapshots
   */
  reset(): void {
    this.snapshots = [];
  }

  /**
   * Format bytes to human-readable string
   */
  static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}

/**
 * Memory snapshot interface
 */
export interface MemorySnapshot {
  label: string;
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

/**
 * Memory delta interface
 */
export interface MemoryDelta {
  heapUsedDelta: number;
  heapTotalDelta: number;
  externalDelta: number;
  rssDelta: number;
  timeDelta: number;
}

/**
 * Run a benchmark suite
 */
export async function runBenchmark(
  name: string,
  fn: () => Promise<void>,
  iterations: number = 100
): Promise<BenchmarkResult> {
  const timer = new PerformanceTimer();
  const memTracker = new MemoryTracker();

  // Warm up
  await fn();

  // Take initial memory snapshot
  memTracker.snapshot('start');

  // Run benchmark
  for (let i = 0; i < iterations; i++) {
    await timer.measure(fn);
  }

  // Take final memory snapshot
  memTracker.snapshot('end');

  const stats = timer.getStats();
  const memDelta = memTracker.getDelta(0, 1);

  return {
    name,
    iterations,
    stats,
    memoryDelta: memDelta.heapUsedDelta,
    throughput: 1000 / stats.mean, // Operations per second
  };
}

/**
 * Benchmark result interface
 */
export interface BenchmarkResult {
  name: string;
  iterations: number;
  stats: PerformanceStats;
  memoryDelta: number;
  throughput: number;
}

/**
 * Format benchmark results for display
 */
export function formatBenchmarkResult(result: BenchmarkResult): string {
  const lines = [
    `Benchmark: ${result.name}`,
    `Iterations: ${result.iterations}`,
    `Mean: ${result.stats.mean.toFixed(2)}ms`,
    `Median: ${result.stats.median.toFixed(2)}ms`,
    `P95: ${result.stats.p95.toFixed(2)}ms`,
    `P99: ${result.stats.p99.toFixed(2)}ms`,
    `Min: ${result.stats.min.toFixed(2)}ms`,
    `Max: ${result.stats.max.toFixed(2)}ms`,
    `Throughput: ${result.throughput.toFixed(2)} ops/sec`,
    `Memory Delta: ${MemoryTracker.formatBytes(result.memoryDelta)}`,
  ];

  return lines.join('\n');
}
