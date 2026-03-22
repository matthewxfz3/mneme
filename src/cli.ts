#!/usr/bin/env node
/**
 * Mneme CLI
 *
 * Command-line interface for managing Mneme context database.
 */

import { MnemeContextEngine } from './core/engine.js';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// Default database path
const DEFAULT_DB_PATH = join(homedir(), '.mneme', 'mneme.db');

interface CliOptions {
  dbPath?: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): { command: string; args: string[]; options: CliOptions } {
  const argv = process.argv.slice(2);
  const command = argv[0] || 'help';
  const args: string[] = [];
  const options: CliOptions = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg.startsWith('--db-path=')) {
      options.dbPath = arg.substring('--db-path='.length);
    } else if (arg.startsWith('--')) {
      // Unknown option, skip
    } else {
      args.push(arg);
    }
  }

  return { command, args, options };
}

/**
 * Ensure database directory exists
 */
function ensureDbDir(dbPath: string): void {
  const dir = join(dbPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Initialize engine
 */
function initEngine(options: CliOptions): MnemeContextEngine {
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  ensureDbDir(dbPath);

  return new MnemeContextEngine({
    dbPath,
    cacheTokens: true,
  });
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Commands
 */
const commands = {
  help() {
    console.log(`
Mneme CLI - Unified Context Management

USAGE:
  mneme <command> [options]

COMMANDS:
  init                    Initialize new Mneme database
  import <path>           Import JSONL session file or directory
  search <query>          Search across all conversations
  stats                   Show database statistics
  conversations           List all conversations
  messages <session-id>   Show messages in a conversation
  health                  Check database health
  vacuum                  Optimize database size
  export <session-id>     Export conversation to JSONL
  help                    Show this help message

OPTIONS:
  --db-path=<path>        Database path (default: ~/.mneme/mneme.db)

EXAMPLES:
  # Initialize database
  mneme init

  # Import sessions
  mneme import ~/.openclaw/agents/main/sessions

  # Search conversations
  mneme search "kubernetes error"

  # View statistics
  mneme stats

  # Export conversation
  mneme export session-abc123
`);
  },

  async init(_args: string[], options: CliOptions) {
    const dbPath = options.dbPath || DEFAULT_DB_PATH;
    ensureDbDir(dbPath);

    console.log('Initializing Mneme database...');
    const engine = initEngine(options);

    await engine.bootstrap({
      sessionId: 'system',
    });

    const stats = engine.getStats();
    console.log('✓ Database initialized');
    console.log(`  Location: ${dbPath}`);
    console.log(`  Conversations: ${stats.conversations}`);
    console.log(`  Messages: ${stats.messages}`);

    engine.close();
  },

  async import(args: string[], options: CliOptions) {
    if (args.length === 0 || !args[0]) {
      console.error('Error: Path required');
      console.log('Usage: mneme import <path>');
      process.exit(1);
    }

    const importPath = args[0];
    if (!existsSync(importPath)) {
      console.error(`Error: Path not found: ${importPath}`);
      process.exit(1);
    }

    console.log('Importing sessions...');
    const engine = initEngine(options);
    const importer = (engine as any).getService();
    const tokenCounter = (engine as any).getTokenCounter();

    const { SessionImporter } = await import('./core/import.js');
    const sessionImporter = new SessionImporter(importer, tokenCounter);

    const stats = require('fs').statSync(importPath);

    let results;
    if (stats.isDirectory()) {
      results = await sessionImporter.importDirectory(importPath, {
        onProgress: (progress) => {
          console.log(`  ${progress.file}: ${progress.messagesProcessed}/${progress.totalMessages} messages`);
        },
      });
    } else {
      const result = await sessionImporter.importSession({
        sessionPath: importPath,
        onProgress: (progress) => {
          console.log(`  ${progress.messagesProcessed}/${progress.totalMessages} messages`);
        },
      });
      results = [result];
    }

    console.log('\n✓ Import complete');
    console.log(`  Sessions imported: ${results.length}`);
    console.log(`  Total messages: ${results.reduce((sum, r) => sum + r.messages_imported, 0)}`);
    console.log(`  Total tokens: ${results.reduce((sum, r) => sum + r.tokens_counted, 0)}`);

    engine.close();
  },

  async search(args: string[], options: CliOptions) {
    if (args.length === 0) {
      console.error('Error: Query required');
      console.log('Usage: mneme search <query>');
      process.exit(1);
    }

    const query = args.join(' ');
    const engine = initEngine(options);

    console.log(`Searching for: "${query}"\n`);

    const results = await engine.search(query, { limit: 10 });

    if (results.length === 0) {
      console.log('No results found');
    } else {
      for (const result of results) {
        console.log(`Score: ${result.score.toFixed(4)}`);
        console.log(`Conversation: ${result.conversation_id}`);
        console.log(`Role: ${result.message.role}`);
        console.log(`Content: ${result.message.content.substring(0, 200)}...`);
        console.log(`Tokens: ${result.message.tokens}`);
        console.log('---');
      }
    }

    engine.close();
  },

  async stats(_args: string[], options: CliOptions) {
    const engine = initEngine(options);
    const stats = engine.getStats();
    const cacheStats = engine.getTokenCounter().getCacheStats();
    const service = engine.getService();
    const dbStats = service.getStats();

    console.log('Mneme Database Statistics\n');
    console.log('Conversations:');
    console.log(`  Total: ${stats.conversations}`);
    console.log(`  Messages: ${stats.messages}`);
    console.log(`  Tokens: ${stats.tokens.toLocaleString()}`);
    console.log();
    console.log('Token Cache:');
    console.log(`  Entries: ${cacheStats.totalEntries}`);
    console.log(`  By model family:`);
    for (const [family, count] of Object.entries(cacheStats.byModelFamily)) {
      console.log(`    ${family}: ${count}`);
    }
    console.log();
    console.log('Storage:');
    console.log(`  Size: ${formatBytes(dbStats.dbSizeBytes)}`);
    console.log(`  Compaction events: ${dbStats.compactionEvents}`);

    engine.close();
  },

  async conversations(_args: string[], options: CliOptions) {
    const engine = initEngine(options);
    const service = engine.getService();
    const conversations = service.listConversations({ limit: 50 });

    console.log('Conversations\n');

    if (conversations.length === 0) {
      console.log('No conversations found');
    } else {
      for (const conv of conversations) {
        console.log(`ID: ${conv.conversation_id}`);
        console.log(`Session Key: ${conv.session_key || 'N/A'}`);
        console.log(`Title: ${conv.title || 'Untitled'}`);
        console.log(`Messages: ${conv.message_count}`);
        console.log(`Tokens: ${conv.total_tokens.toLocaleString()}`);
        console.log(`Compacted: ${conv.compacted ? 'Yes' : 'No'}`);
        console.log(`Updated: ${new Date(conv.updated_at).toISOString()}`);
        console.log('---');
      }
    }

    engine.close();
  },

  async messages(args: string[], options: CliOptions) {
    if (args.length === 0 || !args[0]) {
      console.error('Error: Session ID required');
      console.log('Usage: mneme messages <session-id>');
      process.exit(1);
    }

    const sessionId = args[0];
    const engine = initEngine(options);
    const service = engine.getService();

    const conversation = service.getConversationBySessionKey(sessionId);
    if (!conversation) {
      console.error(`Error: Session not found: ${sessionId}`);
      process.exit(1);
    }

    const messages = service.getConversationMessages(conversation.conversation_id);

    console.log(`Messages in ${conversation.title || sessionId}\n`);

    for (const msg of messages) {
      console.log(`[${msg.role}] (${msg.tokens} tokens)`);
      console.log(msg.content.substring(0, 500));
      if (msg.content.length > 500) console.log('...');
      console.log('---');
    }

    engine.close();
  },

  async health(_args: string[], options: CliOptions) {
    const engine = initEngine(options);
    const health = await engine.healthCheck();

    console.log('Health Check\n');
    console.log(`Status: ${health.healthy ? '✓ Healthy' : '✗ Unhealthy'}`);
    console.log(`Conversations: ${health.stats.conversations}`);
    console.log(`Messages: ${health.stats.messages}`);
    console.log(`Tokens: ${health.stats.tokens.toLocaleString()}`);
    console.log(`Cache Entries: ${health.cacheStats.totalEntries}`);

    engine.close();
    process.exit(health.healthy ? 0 : 1);
  },

  async vacuum(_args: string[], options: CliOptions) {
    const engine = initEngine(options);
    const service = engine.getService();

    const beforeStats = service.getStats();
    console.log(`Database size before: ${formatBytes(beforeStats.dbSizeBytes)}`);
    console.log('Running VACUUM...');

    service.vacuum();

    const afterStats = service.getStats();
    console.log(`Database size after: ${formatBytes(afterStats.dbSizeBytes)}`);
    console.log(`Saved: ${formatBytes(beforeStats.dbSizeBytes - afterStats.dbSizeBytes)}`);

    engine.close();
  },

  async export(args: string[], options: CliOptions) {
    if (args.length === 0 || !args[0]) {
      console.error('Error: Session ID required');
      console.log('Usage: mneme export <session-id>');
      process.exit(1);
    }

    const sessionId = args[0];
    const engine = initEngine(options);
    const service = engine.getService();

    const conversation = service.getConversationBySessionKey(sessionId);
    if (!conversation) {
      console.error(`Error: Session not found: ${sessionId}`);
      process.exit(1);
    }

    const messages = service.getConversationMessages(conversation.conversation_id);

    // Output as JSONL
    for (const msg of messages) {
      console.log(JSON.stringify({
        role: msg.role,
        content: msg.content,
        timestamp: msg.created_at,
        tokens: msg.tokens,
      }));
    }

    engine.close();
  },
};

/**
 * Main CLI entry point
 */
async function main() {
  const { command, args, options } = parseArgs();

  const commandFn = (commands as any)[command];
  if (!commandFn) {
    console.error(`Error: Unknown command: ${command}`);
    console.log('Run "mneme help" for usage information');
    process.exit(1);
  }

  try {
    await commandFn(args, options);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
