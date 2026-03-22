/**
 * Mneme Multi-User Example
 *
 * Demonstrates database-per-user architecture with DatabaseManager:
 * - Automatic connection pooling
 * - Perfect user isolation (separate database files)
 * - Zero query overhead (no user_id filters)
 * - Horizontal scalability
 */

import { DatabaseManager } from '../src/core/database-manager.js';
import { join } from 'path';

async function main() {
  console.log('=== Mneme Multi-User Example ===\n');

  // ============================================================================
  // 1. Create Database Manager
  // ============================================================================

  const manager = new DatabaseManager({
    baseDir: join(process.cwd(), 'examples', 'data', 'users'),
    maxConnections: 100,   // Keep max 100 databases open
    idleTimeout: 300000,   // Close after 5 minutes idle
  });

  console.log('✓ Database manager initialized');
  console.log(`  Base directory: ${join(process.cwd(), 'examples', 'data', 'users')}`);
  console.log(`  Max connections: 100`);
  console.log(`  Idle timeout: 5 minutes\n`);

  // ============================================================================
  // 2. Create User Databases
  // ============================================================================

  console.log('Creating user databases...');

  // Get service for Alice (creates database if doesn't exist)
  const aliceService = manager.getService('alice');
  console.log('✓ Alice: /data/users/alice/mneme.db');

  // Get service for Bob
  const bobService = manager.getService('bob');
  console.log('✓ Bob: /data/users/bob/mneme.db');

  // Get service for Charlie
  const charlieService = manager.getService('charlie');
  console.log('✓ Charlie: /data/users/charlie/mneme.db\n');

  // ============================================================================
  // 3. Use Services (Each is a Simple MnemeService)
  // ============================================================================

  console.log('Creating conversations for each user...');

  // Alice's conversations
  const aliceConv1 = aliceService.createConversation({
    title: 'Alice - Project Planning',
    metadata: { project: 'Alpha' },
  });

  const aliceConv2 = aliceService.createConversation({
    title: 'Alice - Code Review',
    metadata: { project: 'Beta' },
  });

  // Bob's conversations
  const bobConv1 = bobService.createConversation({
    title: 'Bob - Product Roadmap',
    metadata: { quarter: 'Q1' },
  });

  // Charlie's conversation
  const charlieConv1 = charlieService.createConversation({
    title: 'Charlie - Design System',
  });

  console.log(`✓ Alice: ${aliceConv1.title}`);
  console.log(`✓ Alice: ${aliceConv2.title}`);
  console.log(`✓ Bob: ${bobConv1.title}`);
  console.log(`✓ Charlie: ${charlieConv1.title}\n`);

  // ============================================================================
  // 4. Add Messages
  // ============================================================================

  console.log('Adding messages...');

  aliceService.addMessage({
    conversation_id: aliceConv1.conversation_id,
    role: 'user',
    content: 'Let\'s plan the new feature for project Alpha',
    tokens: 10,
  });

  aliceService.addMessage({
    conversation_id: aliceConv1.conversation_id,
    role: 'assistant',
    content: 'I can help you plan that. What are the key requirements?',
    tokens: 12,
  });

  bobService.addMessage({
    conversation_id: bobConv1.conversation_id,
    role: 'user',
    content: 'What features should we prioritize for Q1?',
    tokens: 9,
  });

  charlieService.addMessage({
    conversation_id: charlieConv1.conversation_id,
    role: 'user',
    content: 'I need to design the new component library',
    tokens: 10,
  });

  console.log('✓ Added messages to all conversations\n');

  // ============================================================================
  // 5. Perfect Isolation Demo
  // ============================================================================

  console.log('Demonstrating perfect isolation...');

  const aliceConvs = aliceService.listConversations();
  const bobConvs = bobService.listConversations();
  const charlieConvs = charlieService.listConversations();

  console.log(`✓ Alice sees ${aliceConvs.length} conversations (only hers)`);
  console.log(`✓ Bob sees ${bobConvs.length} conversation (only his)`);
  console.log(`✓ Charlie sees ${charlieConvs.length} conversation (only his)`);
  console.log('  → Each user has their own database file\n');

  // ============================================================================
  // 6. Connection Pooling
  // ============================================================================

  console.log('Connection pooling in action...');

  // Access Alice's service again (reuses cached connection)
  const aliceService2 = manager.getService('alice');
  console.log(`✓ Re-accessed Alice's service (connection reused)`);
  console.log(`  Same instance? ${aliceService === aliceService2}\n`);

  // ============================================================================
  // 7. Manager Statistics
  // ============================================================================

  console.log('Manager statistics...');

  const managerStats = manager.getManagerStats();
  console.log(`✓ Active connections: ${managerStats.activeConnections}/${managerStats.maxConnections}`);
  console.log('✓ Open databases:');
  managerStats.users.forEach(u => {
    const idleSec = Math.floor(u.idleTime / 1000);
    console.log(`  - ${u.userId}: idle ${idleSec}s`);
  });
  console.log();

  // ============================================================================
  // 8. Aggregate Statistics
  // ============================================================================

  console.log('Aggregate statistics across all users...');

  const aggregate = manager.getAggregateStats();
  console.log(`✓ Total users: ${aggregate.totalUsers}`);
  console.log(`✓ Total conversations: ${aggregate.totalConversations}`);
  console.log(`✓ Total messages: ${aggregate.totalMessages}`);
  console.log(`✓ Total tokens: ${aggregate.totalTokens}\n`);

  // ============================================================================
  // 9. List All Users
  // ============================================================================

  console.log('All users with databases...');

  const allUsers = manager.listUsers();
  console.log(`✓ Found ${allUsers.length} users:`);
  allUsers.forEach(userId => {
    const hasDb = manager.hasUser(userId);
    console.log(`  - ${userId} (exists: ${hasDb})`);
  });
  console.log();

  // ============================================================================
  // 10. Per-User Stats
  // ============================================================================

  console.log('Per-user statistics...');

  for (const userId of ['alice', 'bob', 'charlie']) {
    const service = manager.getService(userId);
    const stats = service.getStats();
    console.log(`✓ ${userId}:`);
    console.log(`  - Conversations: ${stats.conversations}`);
    console.log(`  - Messages: ${stats.messages}`);
    console.log(`  - Total tokens: ${stats.totalTokens}`);
  }
  console.log();

  // ============================================================================
  // 11. Connection Management
  // ============================================================================

  console.log('Connection management...');

  // Close specific connection
  manager.closeUserConnection('charlie');
  console.log('✓ Closed Charlie\'s connection');

  const statsAfterClose = manager.getManagerStats();
  console.log(`✓ Active connections: ${statsAfterClose.activeConnections}/${statsAfterClose.maxConnections}\n`);

  // ============================================================================
  // 12. Cleanup
  // ============================================================================

  console.log('Cleaning up...');

  // Close all connections
  manager.closeAll();
  console.log('✓ All connections closed');

  console.log('\n=== Example Complete ===');
  console.log('\nDatabase files created:');
  console.log('  examples/data/users/alice/mneme.db');
  console.log('  examples/data/users/bob/mneme.db');
  console.log('  examples/data/users/charlie/mneme.db');
  console.log('\nEach user has their own isolated database.');
  console.log('No user_id columns, no query overhead, perfect isolation.');
}

// Run the example
main().catch(console.error);
