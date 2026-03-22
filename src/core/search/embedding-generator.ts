/**
 * Mneme M2 - Embedding Generator
 *
 * Multi-provider embedding generation with support for:
 * - OpenAI (ada-002, ada-003)
 * - Local models (all-MiniLM-L6-v2 via transformers.js)
 * - Custom providers via interface
 */

export interface EmbeddingProvider {
  name: string;
  dimension: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateBatch(texts: string[]): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
}

export interface EmbeddingOptions {
  provider?: string;
  maxLength?: number;
  truncate?: boolean;
  normalize?: boolean;
}

/**
 * OpenAI embedding provider
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name = 'openai-ada-002';
  dimension = 1536;

  constructor(
    private apiKey: string,
    private model: string = 'text-embedding-ada-002'
  ) {}

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    // OpenAI supports batch embedding
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.map((item: any) => item.embedding);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }
}

/**
 * Local embedding provider using transformers.js
 *
 * Uses all-MiniLM-L6-v2 model (384 dimensions)
 * Runs entirely offline, no API calls
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  name = 'local-minilm';
  dimension = 384;

  private pipeline: any = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import to avoid bundling if not used
      const { pipeline } = await import('@xenova/transformers');

      this.pipeline = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2'
      );

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize local embeddings: ${error}. ` +
        `Install @xenova/transformers: npm install @xenova/transformers`
      );
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    await this.initialize();

    const result = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(result.data);
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    await this.initialize();

    // Process in batches to avoid memory issues
    const embeddings: number[][] = [];

    for (const text of texts) {
      const embedding = await this.generateEmbedding(text);
      embeddings.push(embedding);
    }

    return embeddings;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.initialize();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Mock provider for testing
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  name = 'mock';
  dimension = 128;

  async generateEmbedding(text: string): Promise<number[]> {
    // Generate deterministic mock embedding based on text hash
    const hash = this.simpleHash(text);
    const embedding: number[] = [];

    for (let i = 0; i < this.dimension; i++) {
      embedding.push(Math.sin(hash + i) * 0.5 + 0.5);
    }

    return embedding;
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.generateEmbedding(text)));
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }
}

/**
 * Embedding generator with provider management
 */
export class EmbeddingGenerator {
  private providers = new Map<string, EmbeddingProvider>();
  private defaultProvider: string;

  constructor(defaultProvider: string = 'mock') {
    this.defaultProvider = defaultProvider;

    // Register built-in providers
    this.registerProvider(new MockEmbeddingProvider());
  }

  /**
   * Register a provider
   */
  registerProvider(provider: EmbeddingProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Get a provider by name
   */
  getProvider(name?: string): EmbeddingProvider {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(
        `Provider '${providerName}' not found. ` +
        `Available: ${Array.from(this.providers.keys()).join(', ')}`
      );
    }

    return provider;
  }

  /**
   * Set default provider
   */
  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider '${name}' not registered`);
    }
    this.defaultProvider = name;
  }

  /**
   * Generate embedding for text
   */
  async generate(
    text: string,
    options: EmbeddingOptions = {}
  ): Promise<number[]> {
    const provider = this.getProvider(options.provider);

    // Truncate if needed
    let processedText = text;
    if (options.maxLength && text.length > options.maxLength) {
      if (options.truncate) {
        processedText = text.slice(0, options.maxLength);
      } else {
        throw new Error(
          `Text length (${text.length}) exceeds maxLength (${options.maxLength}). ` +
          `Set truncate: true to allow truncation.`
        );
      }
    }

    const embedding = await provider.generateEmbedding(processedText);

    // Normalize if requested
    if (options.normalize) {
      return this.normalize(embedding);
    }

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts
   */
  async generateBatch(
    texts: string[],
    options: EmbeddingOptions = {}
  ): Promise<number[][]> {
    const provider = this.getProvider(options.provider);

    // Process texts
    const processedTexts = texts.map(text => {
      if (options.maxLength && text.length > options.maxLength) {
        if (options.truncate) {
          return text.slice(0, options.maxLength);
        } else {
          throw new Error(
            `Text length exceeds maxLength. Set truncate: true.`
          );
        }
      }
      return text;
    });

    const embeddings = await provider.generateBatch(processedTexts);

    // Normalize if requested
    if (options.normalize) {
      return embeddings.map(emb => this.normalize(emb));
    }

    return embeddings;
  }

  /**
   * Get embedding dimension for provider
   */
  getDimension(providerName?: string): number {
    const provider = this.getProvider(providerName);
    return provider.dimension;
  }

  /**
   * Check if provider is available
   */
  async isProviderAvailable(providerName: string): Promise<boolean> {
    const provider = this.providers.get(providerName);
    if (!provider) return false;
    return provider.isAvailable();
  }

  /**
   * List all registered providers
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Normalize embedding to unit length
   */
  private normalize(embedding: number[]): number[] {
    const magnitude = Math.sqrt(
      embedding.reduce((sum, val) => sum + val * val, 0)
    );

    if (magnitude === 0) {
      return embedding; // Avoid division by zero
    }

    return embedding.map(val => val / magnitude);
  }
}
