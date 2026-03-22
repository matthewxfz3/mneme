/**
 * Mneme M2 - Adapter Registry
 *
 * Manages lifecycle and registration of source adapters.
 * Provides centralized access to all adapters.
 */

import type {
  SourceAdapter,
  AdapterConfig,
  AdapterStats,
} from './adapter-interface.js';

export interface AdapterInfo {
  id: string;
  name: string;
  version: string;
  supportedFormats: string[];
  status: 'registered' | 'initialized' | 'started' | 'stopped' | 'error';
  error?: string;
}

/**
 * Registry for source adapters
 */
export class AdapterRegistry {
  private adapters = new Map<string, SourceAdapter>();
  private factories = new Map<string, () => SourceAdapter>();
  private status = new Map<string, AdapterInfo>();

  /**
   * Register an adapter factory
   */
  registerFactory(id: string, factory: () => SourceAdapter): void {
    this.factories.set(id, factory);

    const adapter = factory();

    this.status.set(id, {
      id: adapter.id,
      name: adapter.name,
      version: adapter.version,
      supportedFormats: adapter.supportedFormats,
      status: 'registered',
    });
  }

  /**
   * Initialize an adapter
   */
  async initialize(id: string, config: AdapterConfig): Promise<SourceAdapter> {
    // Get factory
    const factory = this.factories.get(id);

    if (!factory) {
      throw new Error(
        `Adapter '${id}' not registered. ` +
        `Available: ${Array.from(this.factories.keys()).join(', ')}`
      );
    }

    // Create adapter instance
    const adapter = factory();

    try {
      // Initialize
      await adapter.initialize(config);

      // Store instance
      this.adapters.set(id, adapter);

      // Update status
      this.updateStatus(id, 'initialized');

      return adapter;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.updateStatus(id, 'error', errorMessage);

      throw new Error(`Failed to initialize adapter '${id}': ${errorMessage}`);
    }
  }

  /**
   * Start an adapter
   */
  async start(id: string): Promise<void> {
    const adapter = this.adapters.get(id);

    if (!adapter) {
      throw new Error(
        `Adapter '${id}' not initialized. Call initialize() first.`
      );
    }

    try {
      await adapter.start();
      this.updateStatus(id, 'started');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateStatus(id, 'error', errorMessage);

      throw new Error(`Failed to start adapter '${id}': ${errorMessage}`);
    }
  }

  /**
   * Stop an adapter
   */
  async stop(id: string): Promise<void> {
    const adapter = this.adapters.get(id);

    if (!adapter) {
      return; // Already stopped or never initialized
    }

    try {
      await adapter.stop();
      this.updateStatus(id, 'stopped');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error stopping adapter '${id}':`, errorMessage);
    }
  }

  /**
   * Stop all adapters
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.adapters.keys()).map(id =>
      this.stop(id).catch(err =>
        console.error(`Error stopping adapter '${id}':`, err)
      )
    );

    await Promise.all(stopPromises);
  }

  /**
   * Get an adapter instance
   */
  get(id: string): SourceAdapter {
    const adapter = this.adapters.get(id);

    if (!adapter) {
      throw new Error(
        `Adapter '${id}' not initialized. ` +
        `Available initialized: ${Array.from(this.adapters.keys()).join(', ')}`
      );
    }

    return adapter;
  }

  /**
   * Check if adapter is registered
   */
  isRegistered(id: string): boolean {
    return this.factories.has(id);
  }

  /**
   * Check if adapter is initialized
   */
  isInitialized(id: string): boolean {
    return this.adapters.has(id);
  }

  /**
   * Get adapter status
   */
  getStatus(id: string): AdapterInfo | null {
    return this.status.get(id) || null;
  }

  /**
   * List all registered adapters
   */
  list(): AdapterInfo[] {
    return Array.from(this.status.values());
  }

  /**
   * List all initialized adapters
   */
  listInitialized(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get adapter by supported format
   */
  findByFormat(format: string): AdapterInfo[] {
    return Array.from(this.status.values()).filter(info =>
      info.supportedFormats.some(f =>
        f.toLowerCase() === format.toLowerCase()
      )
    );
  }

  /**
   * Get stats for all initialized adapters
   */
  async getAllStats(): Promise<Map<string, AdapterStats>> {
    const stats = new Map<string, AdapterStats>();

    for (const [id, adapter] of this.adapters) {
      try {
        const adapterStats = await adapter.getStats();
        stats.set(id, adapterStats);
      } catch (error) {
        console.error(`Failed to get stats for adapter '${id}':`, error);
      }
    }

    return stats;
  }

  /**
   * Health check for all adapters
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const health = new Map<string, boolean>();

    for (const [id, adapter] of this.adapters) {
      try {
        const isHealthy = await adapter.isHealthy();
        health.set(id, isHealthy);
      } catch (error) {
        health.set(id, false);
      }
    }

    return health;
  }

  /**
   * Update adapter status
   */
  private updateStatus(
    id: string,
    status: AdapterInfo['status'],
    error?: string
  ): void {
    const current = this.status.get(id);

    if (current) {
      current.status = status;

      if (error) {
        current.error = error;
      } else {
        delete current.error;
      }
    }
  }
}

/**
 * Create a default adapter registry with all built-in adapters
 */
export function createDefaultRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();

  // Register built-in adapters
  registry.registerFactory('slack-export', () => {
    const { SlackExportAdapter } = require('./slack-export-adapter.js');
    return new SlackExportAdapter();
  });

  registry.registerFactory('discord-data', () => {
    const { DiscordDataAdapter } = require('./discord-data-adapter.js');
    return new DiscordDataAdapter();
  });

  registry.registerFactory('pdf-document', () => {
    const { PDFDocumentAdapter } = require('./pdf-document-adapter.js');
    return new PDFDocumentAdapter();
  });

  registry.registerFactory('markdown', () => {
    const { MarkdownAdapter } = require('./markdown-adapter.js');
    return new MarkdownAdapter();
  });

  registry.registerFactory('email', () => {
    const { EmailAdapter } = require('./email-adapter.js');
    return new EmailAdapter();
  });

  return registry;
}
