/**
 * Resource Monitoring Example
 *
 * Demonstrates the new resource monitoring and cost mitigation features
 * in the DatabaseManager for multi-user deployments.
 *
 * NOTE: This example creates fresh databases to avoid a pre-existing bug
 * in schema.sql where some indexes don't use IF NOT EXISTS. In production,
 * databases are created once and then reused, so this isn't an issue.
 */

import { DatabaseManager } from '../src/core/database-manager.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';

async function demonstrateResourceMonitoring() {
  console.log('=== Resource Monitoring & Cost Mitigation Demo ===\n');

  const demoDir = join(tmpdir(), `mneme-resource-demo-${Date.now()}`);

  // Clean up any existing demo directory
  if (existsSync(demoDir)) {
    rmSync(demoDir, { recursive: true, force: true });
  }

  // Create a database manager with advanced features enabled
  const manager = new DatabaseManager({
    baseDir: demoDir,
    maxConnections: 25, // Enough to hold all 20 users
    idleTimeout: 60000, // 1 minute for demo

    // Enable adaptive pooling - automatically adjusts max connections based on memory
    adaptivePooling: true,
    memoryThreshold: 50 * 1024 * 1024, // 50 MB threshold

    // Enable auto-vacuum on idle cleanup
    autoVacuumOnIdle: true,
    vacuumPages: 10, // Reclaim ~40 KB per cleanup

    // Enable file descriptor monitoring
    monitorFileDescriptors: true,
    fdWarningThreshold: 0.8, // Warn at 80% usage
  });

  try {
    // Simulate a multi-user scenario
    console.log('1. Creating services for 10 simulated users...');
    const userIds = Array.from({ length: 10 }, (_, i) => `user-${i}`);

    for (const userId of userIds) {
      const service = manager.getService(userId);

      // Create a conversation first
      const conv = service.createConversation({
        title: `Demo conversation for ${userId}`,
      });

      // Add some sample data to create realistic database files
      service.addMessage({
        conversation_id: conv.conversation_id,
        content: `This is a sample message from ${userId}`,
        role: 'user',
        tokens: 10,
      });
    }

    console.log('   Created 10 user databases\n');

    // Check stats after initial creation
    console.log('2. Initial Statistics:');
    const initialStats = manager.getManagerStats();
    displayStats(initialStats);

    // Access each user once more to show cache hits
    console.log('\n3. Simulating user activity (cache hits/misses)...');
    for (const userId of userIds) {
      const service = manager.getService(userId);
      service.getStats(); // Touch the service (cache hit)
    }

    const activityStats = manager.getManagerStats();
    console.log(`   Cache hit rate: ${activityStats.performance.cacheHitRate.toFixed(1)}%`);
    console.log(`   Total evictions: ${activityStats.performance.evictionsTotal}`);

    // Check health status
    console.log('\n4. Health Status:');
    displayHealthStatus(activityStats.health);

    // Display resource usage
    console.log('\n5. Resource Usage:');
    displayResourceMetrics(activityStats.resources);

    // Demonstrate adaptive pooling
    if (activityStats.effectiveMaxConnections !== activityStats.maxConnections) {
      console.log('\n6. Adaptive Pooling Active:');
      console.log(`   Configured max: ${activityStats.maxConnections}`);
      console.log(`   Effective max:  ${activityStats.effectiveMaxConnections}`);
      console.log(`   (Reduced due to memory pressure)`);
    }

    // Show per-user statistics for a few users
    console.log('\n7. Sample User Details:');
    for (let i = 0; i < Math.min(3, activityStats.users.length); i++) {
      const user = activityStats.users[i];
      console.log(`   ${user.userId}:`);
      console.log(`     Last accessed: ${new Date(user.lastAccessed).toISOString()}`);
      console.log(`     Idle time: ${Math.round(user.idleTime / 1000)}s`);
    }

    // Demonstrate vacuum tracking
    console.log('\n8. Vacuum Statistics:');
    console.log(`   Total auto-vacuums: ${activityStats.performance.vacuumsTotal}`);
    console.log(`   (Vacuums run automatically on idle connection cleanup)`);

    // Show aggregate stats across all users
    console.log('\n9. Aggregate Statistics:');
    const aggregateStats = manager.getAggregateStats();
    console.log(`   Total active users: ${aggregateStats.totalUsers}`);
    console.log(`   Total conversations: ${aggregateStats.totalConversations}`);
    console.log(`   Total messages: ${aggregateStats.totalMessages}`);
    console.log(`   Total tokens: ${aggregateStats.totalTokens}`);

  } finally {
    // Clean up
    console.log('\n10. Cleaning up...');
    manager.closeAll();
    console.log('    All connections closed');

    // Remove demo directory
    if (existsSync(demoDir)) {
      rmSync(demoDir, { recursive: true, force: true });
    }
  }

  console.log('\n=== Demo Complete ===\n');
}

function displayStats(stats: ReturnType<typeof DatabaseManager.prototype.getManagerStats>) {
  console.log(`   Active connections: ${stats.activeConnections}/${stats.maxConnections}`);
  console.log(`   Effective max connections: ${stats.effectiveMaxConnections}`);
  console.log(`   Total users with databases: ${stats.users.length}`);
}

function displayHealthStatus(health: any) {
  const statusEmoji = {
    healthy: '✅',
    degraded: '⚠️',
    critical: '❌',
  };

  console.log(`   Status: ${statusEmoji[health.status]} ${health.status.toUpperCase()}`);
  console.log(`   Health score: ${health.score}/100`);

  if (health.warnings.length > 0) {
    console.log('   Warnings:');
    for (const warning of health.warnings) {
      console.log(`     - ${warning}`);
    }
  } else {
    console.log('   No warnings');
  }
}

function displayResourceMetrics(resources: any) {
  console.log('   Memory:');
  console.log(`     Heap used: ${(resources.memory.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`     Heap total: ${(resources.memory.heapTotal / 1024 / 1024).toFixed(1)} MB`);
  console.log(`     Connection pool: ~${resources.memory.connectionPoolSize.toFixed(1)} MB`);
  console.log(`     Per connection: ~${resources.memory.perConnectionAvg.toFixed(0)} KB`);

  console.log('\n   File Descriptors:');
  console.log(`     Estimated open: ${resources.fileDescriptors.estimated}`);
  if (resources.fileDescriptors.limit) {
    console.log(`     System limit: ${resources.fileDescriptors.limit}`);
    console.log(`     Utilization: ${resources.fileDescriptors.utilizationPct?.toFixed(1)}%`);
  }

  console.log('\n   Disk:');
  console.log(`     Total DB size: ${(resources.disk.totalDbSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`     Avg per user: ${(resources.disk.avgDbSize / 1024).toFixed(1)} KB`);
}

// Run the demo
demonstrateResourceMonitoring().catch(console.error);
