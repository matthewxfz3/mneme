/**
 * Basic Usage Example
 *
 * Demonstrates core Mneme functionality
 */

import { MnemeContextEngine } from '../src/index.js';
import { homedir } from 'os';
import { join } from 'path';

async function main() {
  // Initialize engine
  const engine = new MnemeContextEngine({
    dbPath: join(homedir(), '.mneme', 'example.db'),
    defaultTokenBudget: 8000,
  });

  console.log('🧠 Mneme Basic Usage Example\n');

  // 1. Bootstrap a new session
  console.log('1. Creating new session...');
  await engine.bootstrap({
    sessionId: 'example-session',
  });

  // 2. Ingest some messages
  console.log('2. Ingesting messages...');

  await engine.ingest({
    sessionId: 'example-session',
    message: {
      role: 'user',
      content: 'How do I deploy a Kubernetes cluster?',
    },
  });

  await engine.ingest({
    sessionId: 'example-session',
    message: {
      role: 'assistant',
      content: 'To deploy a Kubernetes cluster, you can use tools like kubeadm, kops, or managed services like GKE, EKS, or AKS. Here are the basic steps...',
    },
  });

  await engine.ingest({
    sessionId: 'example-session',
    message: {
      role: 'user',
      content: 'What about monitoring?',
    },
  });

  await engine.ingest({
    sessionId: 'example-session',
    message: {
      role: 'assistant',
      content: 'For Kubernetes monitoring, popular solutions include Prometheus with Grafana, Datadog, or the ELK stack.',
    },
  });

  // 3. Get statistics
  console.log('\n3. Session statistics:');
  const stats = engine.getStats('example-session');
  console.log(`   Messages: ${stats.messages}`);
  console.log(`   Tokens: ${stats.tokens}`);

  // 4. Assemble context with token budget
  console.log('\n4. Assembling context with 500 token budget...');
  const context = await engine.assemble({
    sessionId: 'example-session',
    tokenBudget: 500,
    strategy: 'recent',
  });

  console.log(`   Included: ${context.messages.length} messages`);
  console.log(`   Total tokens: ${context.metadata.total_tokens}`);
  console.log(`   Budget used: ${(context.metadata.budget_used * 100).toFixed(1)}%`);

  // 5. Search across conversations
  console.log('\n5. Searching for "monitoring"...');
  const searchResults = await engine.search('monitoring', {
    limit: 5,
  });

  console.log(`   Found: ${searchResults.length} results`);
  if (searchResults.length > 0) {
    console.log(`   Top result score: ${searchResults[0].score.toFixed(4)}`);
    console.log(`   Content preview: ${searchResults[0].message.content.substring(0, 80)}...`);
  }

  // 6. Hybrid assembly with search
  console.log('\n6. Hybrid assembly with search query...');
  const hybridContext = await engine.assemble({
    sessionId: 'example-session',
    tokenBudget: 1000,
    strategy: 'hybrid',
    searchQuery: 'kubernetes',
    preserveRecent: 2,
  });

  console.log(`   Included: ${hybridContext.messages.length} messages`);
  console.log(`   Strategy: ${hybridContext.metadata.strategy}`);

  // 7. Health check
  console.log('\n7. Running health check...');
  const health = await engine.healthCheck();
  console.log(`   Status: ${health.healthy ? '✓ Healthy' : '✗ Unhealthy'}`);
  console.log(`   Total conversations: ${health.stats.conversations}`);
  console.log(`   Total messages: ${health.stats.messages}`);
  console.log(`   Cache entries: ${health.cacheStats.totalEntries}`);

  // Clean up
  engine.close();
  console.log('\n✓ Example complete!\n');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
