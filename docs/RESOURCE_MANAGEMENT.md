# Resource Management & Cost Mitigation

This document describes the resource management features in Mneme's multi-user database architecture and how to optimize for different scales.

## Overview

Mneme uses a database-per-user architecture where each user gets their own SQLite database. This provides perfect isolation and optimal query performance, but requires careful resource management at scale.

### Key Resources Managed

1. **Memory** - Connection pool and in-memory prepared statements
2. **File Descriptors** - Each database uses 3 FDs (db, wal, shm)
3. **Disk Space** - Database files and WAL/SHM overhead
4. **CPU** - Connection creation and query execution

## Cost Per User

### Active Connection Costs

```
Per-Connection Memory:
  MnemeService instance:     150-250 KB
  better-sqlite3 connection: 100-200 KB
  Prepared statement cache:   50-150 KB
  JavaScript objects:         20-50 KB
  ────────────────────────────────────
  Total:                     370-750 KB (~500 KB avg)

Per-Connection File Descriptors:
  Main database file:  1 FD
  WAL file:           1 FD
  SHM file:           1 FD
  ────────────────────────
  Total:              3 FDs
```

### Disk Costs

```
Empty database:        2-3 MB   (schema + indexes)
Per message:          3-5 KB   (row + FTS index)
1,000 messages:       5-8 MB
10,000 messages:      50-80 MB
```

## Scaling Scenarios

| Users | Connections | Memory | File Descriptors | Status |
|-------|-------------|--------|------------------|--------|
| 1-100 | 100 | 50 MB | 300 | ✅ No issues |
| 100-500 | 100 (LRU) | 50 MB | 300 | ⚠️ High eviction |
| 500-1,000 | 100 (LRU) | 50 MB | 300 | ⚠️ Constant thrashing |
| 1,000+ | Requires optimization | | | ❌ Needs mitigations |

## Configuration Options

### Basic Configuration

```typescript
const manager = new DatabaseManager({
  baseDir: '/data/mneme/users',
  maxConnections: 100,
  idleTimeout: 300000, // 5 minutes
});
```

### Advanced Configuration (Recommended for Production)

```typescript
const manager = new DatabaseManager({
  baseDir: '/data/mneme/users',
  maxConnections: 500,
  idleTimeout: 300000,

  // Adaptive pooling - automatically adjusts based on memory
  adaptivePooling: true,
  memoryThreshold: 100 * 1024 * 1024, // 100 MB

  // Auto-vacuum on idle cleanup
  autoVacuumOnIdle: true,
  vacuumPages: 10, // ~40 KB per cleanup

  // File descriptor monitoring
  monitorFileDescriptors: true,
  fdWarningThreshold: 0.8, // Warn at 80%
});
```

## Feature Details

### 1. Adaptive Connection Pooling

**Purpose**: Prevent out-of-memory crashes under high load

**How it works**:
- Monitors available heap memory
- Dynamically reduces max connections when memory is low
- Automatically scales back up when memory is available

**Configuration**:
```typescript
{
  adaptivePooling: true,           // Enable adaptive mode
  memoryThreshold: 100 * 1024 * 1024, // 100 MB threshold
  maxConnections: 500,              // Upper limit
}
```

**When to use**:
- Production deployments with 100+ concurrent users
- Environments with memory constraints
- Shared hosting or containerized deployments

**Example behavior**:
```
Available Memory: 200 MB → Effective Max: 500 (configured max)
Available Memory: 80 MB  → Effective Max: 106 (calculated: 80MB / 750KB)
Available Memory: 50 MB  → Effective Max: 66
```

### 2. Automatic Vacuum on Idle

**Purpose**: Reclaim disk space from deleted messages

**How it works**:
- Runs incremental vacuum before closing idle connections
- Reclaims fragmented space without blocking operations
- Typically recovers 30-50% of space from deleted content

**Configuration**:
```typescript
{
  autoVacuumOnIdle: true,  // Enable auto-vacuum
  vacuumPages: 10,         // Pages to reclaim (~40 KB)
  idleTimeout: 300000,     // Run on idle timeout
}
```

**When to use**:
- Always recommended for production
- Essential if users frequently delete messages
- Important for long-running deployments

**Expected results**:
```
Before: 10 MB database with 5,000 deleted messages
After:  ~6-7 MB database (3-4 MB reclaimed)
```

### 3. File Descriptor Monitoring

**Purpose**: Prevent "Too many open files" crashes

**How it works**:
- Estimates current FD usage (3 per connection)
- Warns when approaching system limits
- Helps identify when to increase OS limits

**Configuration**:
```typescript
{
  monitorFileDescriptors: true,  // Enable monitoring
  fdWarningThreshold: 0.8,       // Warn at 80%
}
```

**Warning output**:
```
[DatabaseManager] File descriptor usage high: 768/1024 (75%)
Consider increasing file descriptor limit: ulimit -n 65536
```

**When to increase limits**:
```bash
# Temporary (current session)
ulimit -n 65536

# Permanent (Linux) - add to /etc/security/limits.conf
* soft nofile 65536
* hard nofile 65536

# Permanent (macOS) - add to /Library/LaunchDaemons/limit.maxfiles.plist
```

### 4. Enhanced Statistics & Monitoring

**Purpose**: Visibility into resource usage and performance

**Available metrics**:

```typescript
const stats = manager.getManagerStats();

// Connection stats
stats.activeConnections;        // Currently open
stats.maxConnections;           // Configured max
stats.effectiveMaxConnections;  // Current limit (with adaptive)

// Resource metrics
stats.resources.memory.heapUsed;           // Current heap
stats.resources.memory.connectionPoolSize; // Estimated MB
stats.resources.fileDescriptors.estimated; // Open FDs
stats.resources.disk.totalDbSize;          // Total bytes

// Performance metrics
stats.performance.cacheHitRate;     // % of cache hits
stats.performance.evictionsTotal;   // Lifetime evictions
stats.performance.vacuumsTotal;     // Auto-vacuums run

// Health status
stats.health.score;     // 0-100
stats.health.status;    // 'healthy' | 'degraded' | 'critical'
stats.health.warnings;  // Array of warning messages
```

**Health scoring**:
- **100-80**: Healthy (green) - Normal operation
- **79-50**: Degraded (yellow) - Performance issues
- **49-0**: Critical (red) - Immediate attention needed

**Common warnings**:
- `"High memory pressure (>80% heap used)"`
- `"High file descriptor usage (>80% of limit)"`
- `"Low cache hit rate (<50%)"`
- `"High eviction rate - consider increasing maxConnections"`

## Monitoring & Observability

### Basic Health Check

```typescript
function checkHealth() {
  const stats = manager.getManagerStats();

  if (stats.health.status === 'critical') {
    console.error('CRITICAL: Database manager in critical state');
    console.error('Warnings:', stats.health.warnings);
    // Alert ops team
  } else if (stats.health.status === 'degraded') {
    console.warn('WARNING: Database manager degraded');
    console.warn('Warnings:', stats.health.warnings);
  }

  return stats.health.score;
}

// Run every minute
setInterval(checkHealth, 60000);
```

### Performance Monitoring

```typescript
function logPerformanceMetrics() {
  const stats = manager.getManagerStats();

  console.log('Performance Metrics:');
  console.log(`  Cache hit rate: ${stats.performance.cacheHitRate.toFixed(1)}%`);
  console.log(`  Total evictions: ${stats.performance.evictionsTotal}`);
  console.log(`  Total vacuums: ${stats.performance.vacuumsTotal}`);

  // Alert if cache hit rate is too low
  if (stats.performance.cacheHitRate < 70 && stats.activeConnections >= stats.maxConnections) {
    console.warn('Consider increasing maxConnections for better cache hit rate');
  }
}
```

### Resource Usage Dashboard

```typescript
function displayResourceDashboard() {
  const stats = manager.getManagerStats();
  const r = stats.resources;

  console.log('Resource Usage:');
  console.log(`  Memory: ${(r.memory.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(r.memory.heapTotal / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Connection pool: ${r.memory.connectionPoolSize.toFixed(1)} MB`);
  console.log(`  File descriptors: ${r.fileDescriptors.estimated} / ${r.fileDescriptors.limit || 'unknown'}`);
  console.log(`  Total disk: ${(r.disk.totalDbSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Avg per user: ${(r.disk.avgDbSize / 1024).toFixed(1)} KB`);
}
```

## Optimization Strategies

### For 1-100 Users (Small Scale)

**Use default settings** - no optimization needed:
```typescript
const manager = new DatabaseManager({
  baseDir: '/data/mneme/users',
  // Defaults are fine
});
```

**Expected costs**:
- Memory: <50 MB
- File descriptors: <300
- No special configuration needed

### For 100-500 Users (Medium Scale)

**Enable monitoring** to track trends:
```typescript
const manager = new DatabaseManager({
  baseDir: '/data/mneme/users',
  maxConnections: 200,
  autoVacuumOnIdle: true,
  monitorFileDescriptors: true,
});
```

**System tuning**:
```bash
# Increase FD limit
ulimit -n 4096
```

**Expected costs**:
- Memory: 50-100 MB (with eviction)
- File descriptors: 600 (200 connections)
- High cache eviction rate (watch `cacheHitRate`)

### For 500-2,000 Users (Large Scale)

**Enable all optimizations**:
```typescript
const manager = new DatabaseManager({
  baseDir: '/data/mneme/users',
  maxConnections: 500,
  idleTimeout: 180000, // 3 minutes

  // Critical for this scale
  adaptivePooling: true,
  memoryThreshold: 150 * 1024 * 1024,
  autoVacuumOnIdle: true,
  monitorFileDescriptors: true,
});
```

**System tuning**:
```bash
# Increase FD limit
ulimit -n 65536

# Increase Node.js heap size
node --max-old-space-size=4096 app.js
```

**Expected costs**:
- Memory: 100-250 MB (adaptive)
- File descriptors: 1,500 (500 connections)
- Moderate cache eviction

### For 2,000+ Users (Enterprise Scale)

**Multiple database managers** (shard users):
```typescript
// Shard users across multiple managers
const managers = [
  new DatabaseManager({ baseDir: '/data/mneme/shard-0', /* ... */ }),
  new DatabaseManager({ baseDir: '/data/mneme/shard-1', /* ... */ }),
  new DatabaseManager({ baseDir: '/data/mneme/shard-2', /* ... */ }),
];

function getManagerForUser(userId: string): DatabaseManager {
  const hash = hashString(userId);
  return managers[hash % managers.length];
}
```

**System requirements**:
- 4-8 GB RAM
- FD limit: 65536+
- SSD storage recommended
- Monitor and alert on health metrics

## Troubleshooting

### "Too many open files" Error

**Cause**: File descriptor limit exceeded

**Solution**:
```bash
# Check current limit
ulimit -n

# Increase temporarily
ulimit -n 65536

# Check DatabaseManager warning
# [DatabaseManager] File descriptor usage high: 900/1024 (88%)
```

**Prevention**:
- Set `monitorFileDescriptors: true`
- Increase system limits permanently
- Reduce `maxConnections` if needed

### Out of Memory Crashes

**Cause**: Too many connections for available memory

**Solution**:
```typescript
{
  adaptivePooling: true,  // Enable adaptive mode
  maxConnections: 300,    // Reduce max
}
```

**Check stats**:
```typescript
const stats = manager.getManagerStats();
if (stats.health.warnings.includes('Critical memory pressure')) {
  // Reduce maxConnections or enable adaptivePooling
}
```

### Low Cache Hit Rate (<70%)

**Cause**: `maxConnections` too low for active user count

**Solution**:
```typescript
{
  maxConnections: 500,  // Increase from default 100
}
```

**Monitor**:
```typescript
const stats = manager.getManagerStats();
console.log(`Cache hit rate: ${stats.performance.cacheHitRate.toFixed(1)}%`);
// Target: >80% for good performance
```

### Disk Space Growing Rapidly

**Cause**: Deleted messages not reclaimed

**Solution**:
```typescript
{
  autoVacuumOnIdle: true,  // Enable automatic cleanup
  vacuumPages: 20,         // Increase pages reclaimed
}
```

**Manual vacuum**:
```typescript
// For specific user
const service = manager.getService('user-id');
service.vacuum(); // Full vacuum
service.autoVacuum(100); // Incremental (100 pages)
```

## Best Practices

1. **Always enable monitoring in production**
   ```typescript
   {
     monitorFileDescriptors: true,
     autoVacuumOnIdle: true,
   }
   ```

2. **Monitor health metrics**
   ```typescript
   setInterval(() => {
     const stats = manager.getManagerStats();
     // Log to monitoring system
     metrics.gauge('mneme.health.score', stats.health.score);
     metrics.gauge('mneme.cache.hit_rate', stats.performance.cacheHitRate);
   }, 60000);
   ```

3. **Set appropriate connection limits**
   - Start with defaults
   - Increase based on cache hit rate
   - Enable adaptive pooling for safety

4. **Increase system limits before scaling**
   ```bash
   ulimit -n 65536
   node --max-old-space-size=4096
   ```

5. **Plan for disk growth**
   - Monitor `resources.disk.totalDbSize`
   - Enable auto-vacuum
   - Consider archival strategies for old data

## Performance Benchmarks

### Connection Pool Performance

```
Cache Hit (connection exists):     <1 ms
Cache Miss (new connection):       2-5 ms
Eviction (LRU, O(n)):             0.05-0.1 ms per eviction
Auto-vacuum (incremental):         5-10 ms (10 pages)
```

### Scaling Limits

```
Theoretical Maximum Connections:
  - Memory limited (2 GB heap):      ~4,000 connections
  - FD limited (65536 limit):        ~21,800 connections
  - Practical limit:                 ~2,000 connections per manager

Recommended Maximum:
  - Single manager:                  500-1,000 connections
  - Multiple managers (sharded):     10,000+ users
```

## Migration Guide

### Enabling Features on Existing Deployment

1. **Add monitoring first** (zero risk):
   ```typescript
   {
     monitorFileDescriptors: true,
     autoVacuumOnIdle: true, // Runs passively on cleanup
   }
   ```

2. **Check current stats**:
   ```typescript
   const stats = manager.getManagerStats();
   console.log('Health:', stats.health);
   console.log('Resources:', stats.resources);
   ```

3. **Enable adaptive pooling if needed**:
   ```typescript
   {
     adaptivePooling: true,
     memoryThreshold: 100 * 1024 * 1024,
   }
   ```

4. **Increase connection limit gradually**:
   ```typescript
   // Start
   { maxConnections: 100 }

   // If cache hit rate <70%, increase
   { maxConnections: 200 }

   // Continue until cache hit rate >80%
   { maxConnections: 500 }
   ```

### No Breaking Changes

All features are **opt-in** and **backward compatible**:
- Default behavior unchanged
- Existing configurations continue to work
- New features disabled by default (except autoVacuumOnIdle)

## Summary

The database-per-user architecture scales efficiently with proper resource management:

- **1-100 users**: Default settings work fine
- **100-500 users**: Enable monitoring, increase FD limits
- **500-2,000 users**: Enable all optimizations, adaptive pooling
- **2,000+ users**: Shard across multiple managers

Key features:
1. ✅ **Adaptive pooling** - Prevents OOM crashes
2. ✅ **Auto-vacuum** - Reclaims disk space automatically
3. ✅ **FD monitoring** - Early warning before crashes
4. ✅ **Health metrics** - Complete observability

For most deployments, enabling all features provides the best experience with minimal overhead.
