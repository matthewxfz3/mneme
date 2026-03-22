/**
 * Mneme M2 - History Summarizer
 *
 * Progressive summarization: recent messages = detailed, old messages = condensed.
 * Uses LLMLingua-inspired compression techniques.
 */

import type { Message, Summary } from '../graph/types.js';
import { randomUUID } from 'crypto';

export interface HistorySummaryOptions {
  conversationId: string;
  maxTokens?: number;
  granularity?: 'detailed' | 'medium' | 'brief';
  timeWindowSize?: number; // Number of messages per window
}

export interface LLMProvider {
  complete(prompt: string, options?: { maxTokens?: number }): Promise<string>;
}

export class HistorySummarizer {
  constructor(
    private llm: LLMProvider,
    private tokenCounter: { count(text: string): Promise<number> }
  ) {}

  /**
   * Summarize conversation history with progressive detail
   */
  async summarize(
    messages: Message[],
    options: HistorySummaryOptions
  ): Promise<Summary> {
    const {
      conversationId,
      maxTokens = 500,
      granularity = 'medium',
      timeWindowSize = 10,
    } = options;

    if (messages.length === 0) {
      return this.createEmptySummary(conversationId, maxTokens);
    }

    // Create progressive time windows
    const windows = this.createProgressiveWindows(messages, timeWindowSize);

    // Summarize each window
    const windowSummaries: string[] = [];
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];
      const isRecent = i >= windows.length - 2; // Last 2 windows = recent

      const windowGranularity = isRecent ? granularity : this.getOlderGranularity(granularity);
      const summary = await this.summarizeWindow(window, windowGranularity);

      windowSummaries.push(summary);
    }

    // Combine window summaries
    let combinedSummary = this.combineWindowSummaries(windowSummaries, granularity);

    // Compress to token limit if needed
    combinedSummary = await this.compressToLimit(combinedSummary, maxTokens);

    const finalTokenCount = await this.tokenCounter.count(combinedSummary);

    return {
      summary_id: randomUUID(),
      scope_type: 'conversation',
      scope_id: conversationId,
      summary_type: 'history',
      content: combinedSummary,
      token_count: finalTokenCount,
      source_message_ids: messages.map(m => m.message_id),
      created_at: Date.now(),
      valid_until: Date.now() + 3600000, // 1 hour TTL
      confidence: 0.85,
      metadata: {
        granularity,
        windows: windows.length,
        message_count: messages.length,
        compression_ratio: messages.reduce((sum, m) => sum + m.content.length, 0) / combinedSummary.length,
      },
    };
  }

  /**
   * Create progressive time windows (recent = smaller, old = larger)
   */
  private createProgressiveWindows(
    messages: Message[],
    baseWindowSize: number
  ): Message[][] {
    const windows: Message[][] = [];
    const total = messages.length;

    // Recent messages (last 20%): individual or small groups
    const recentThreshold = Math.floor(total * 0.8);

    // Process old messages in larger windows
    let i = 0;
    while (i < recentThreshold) {
      const windowSize = Math.min(baseWindowSize * 2, recentThreshold - i);
      windows.push(messages.slice(i, i + windowSize));
      i += windowSize;
    }

    // Process recent messages in smaller windows
    while (i < total) {
      const windowSize = Math.min(Math.ceil(baseWindowSize / 2), total - i);
      windows.push(messages.slice(i, i + windowSize));
      i += windowSize;
    }

    return windows;
  }

  /**
   * Summarize a single time window
   */
  private async summarizeWindow(
    messages: Message[],
    granularity: 'detailed' | 'medium' | 'brief'
  ): Promise<string> {
    if (messages.length === 0) return '';

    // For single recent messages with detailed granularity, keep original
    if (messages.length === 1 && granularity === 'detailed') {
      return this.formatSingleMessage(messages[0]);
    }

    const prompt = this.buildSummaryPrompt(messages, granularity);

    try {
      const summary = await this.llm.complete(prompt, {
        maxTokens: this.getMaxTokensForGranularity(granularity, messages.length),
      });

      return this.extractKeyPoints(summary, granularity);
    } catch (error) {
      // Fallback: extract first and last messages
      console.error('LLM summarization failed, using fallback:', error);
      return this.fallbackSummary(messages, granularity);
    }
  }

  /**
   * Build LLM prompt for summarization
   */
  private buildSummaryPrompt(
    messages: Message[],
    granularity: 'detailed' | 'medium' | 'brief'
  ): string {
    const instructions = {
      detailed: `Preserve important details, decisions, and context.
Include:
- Specific decisions made and reasoning
- Important questions asked and answers given
- Action items and their assignees
- Technical details and code snippets (if any)
- Key arguments and counterpoints`,

      medium: `Focus on key points and outcomes.
Include:
- Main topics discussed
- Decisions made (brief)
- Questions asked (important ones only)
- Action items assigned
Omit: Minor details, back-and-forth exchanges`,

      brief: `One or two sentences capturing the essence.
Focus on: What was decided or concluded
Omit: Everything else`,
    };

    const messageText = messages
      .map((m, i) => `[${i + 1}] ${m.role}: ${m.content}`)
      .join('\n\n');

    return `Summarize this conversation segment.

${instructions[granularity]}

Messages:
${messageText}

Summary (bullet points):`;
  }

  /**
   * Extract key points from LLM response
   */
  private extractKeyPoints(
    summary: string,
    granularity: 'detailed' | 'medium' | 'brief'
  ): string {
    // Clean up LLM output
    let cleaned = summary.trim();

    // Remove common prefixes
    cleaned = cleaned.replace(/^(?:Summary|Key points|Here's a summary):\s*/i, '');

    // Ensure bullet format for detailed/medium
    if (granularity !== 'brief' && !cleaned.match(/^[\-\*•]/m)) {
      // Convert to bullets if not already
      const lines = cleaned.split('\n').filter(l => l.trim());
      cleaned = lines.map(l => l.startsWith('-') ? l : `- ${l}`).join('\n');
    }

    return cleaned;
  }

  /**
   * Combine window summaries into cohesive summary
   */
  private combineWindowSummaries(
    windowSummaries: string[],
    granularity: 'detailed' | 'medium' | 'brief'
  ): string {
    if (windowSummaries.length === 0) return '';
    if (windowSummaries.length === 1) return windowSummaries[0];

    if (granularity === 'brief') {
      // For brief, just join with periods
      return windowSummaries.join('. ');
    }

    // For detailed/medium, organize chronologically
    const sections = windowSummaries.map((summary, i) => {
      const label = i === windowSummaries.length - 1
        ? 'Recently'
        : i === windowSummaries.length - 2
        ? 'Earlier'
        : i === 0
        ? 'Initially'
        : `Part ${i + 1}`;

      return `**${label}:**\n${summary}`;
    });

    return sections.join('\n\n');
  }

  /**
   * Compress summary to token limit using LLMLingua-inspired technique
   */
  private async compressToLimit(
    text: string,
    maxTokens: number
  ): Promise<string> {
    const currentTokens = await this.tokenCounter.count(text);

    if (currentTokens <= maxTokens) {
      return text;
    }

    const compressionRatio = maxTokens / currentTokens;

    // Iterative compression
    let compressed = text;

    // Stage 1: Remove filler words (contextual sparsity)
    compressed = this.removeFillerWords(compressed);

    const afterStage1 = await this.tokenCounter.count(compressed);
    if (afterStage1 <= maxTokens) {
      return compressed;
    }

    // Stage 2: Compress each section proportionally
    const sections = compressed.split('\n\n');
    const targetSectionRatio = maxTokens / afterStage1;

    const compressedSections = await Promise.all(
      sections.map(async (section) => {
        const sectionTokens = await this.tokenCounter.count(section);
        const targetSectionTokens = Math.floor(sectionTokens * targetSectionRatio);

        if (sectionTokens <= targetSectionTokens) {
          return section;
        }

        return this.compressSection(section, targetSectionTokens);
      })
    );

    return compressedSections.join('\n\n');
  }

  /**
   * Remove filler words (LLMLingua technique)
   */
  private removeFillerWords(text: string): string {
    const fillerWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
      'is', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'that', 'which', 'who', 'when', 'where', 'why', 'how',
      'this', 'these', 'those', 'such', 'very', 'just', 'quite', 'rather',
      'also', 'too', 'so', 'then', 'now', 'here', 'there',
    ]);

    // Preserve bullets and structure
    const lines = text.split('\n');

    const compressed = lines.map(line => {
      // Skip bullet markers and labels
      const match = line.match(/^(\s*[\-\*•]\s*|\*\*[^*]+\*\*:\s*)(.*)/);
      if (match) {
        const [, prefix, content] = match;
        const compressedContent = this.compressLine(content, fillerWords);
        return prefix + compressedContent;
      }

      return this.compressLine(line, fillerWords);
    });

    return compressed.join('\n');
  }

  /**
   * Compress a single line by removing filler words
   */
  private compressLine(line: string, fillerWords: Set<string>): string {
    const words = line.split(/\s+/);

    // Keep first and last words, compress middle
    if (words.length <= 4) return line;

    const compressed: string[] = [words[0]]; // Keep first word

    for (let i = 1; i < words.length - 1; i++) {
      const word = words[i].toLowerCase().replace(/[^\w]/g, '');

      // Keep important words
      if (!fillerWords.has(word)) {
        compressed.push(words[i]);
      }
    }

    compressed.push(words[words.length - 1]); // Keep last word

    return compressed.join(' ');
  }

  /**
   * Compress a section to target token count
   */
  private async compressSection(
    section: string,
    targetTokens: number
  ): Promise<string> {
    // Simple truncation for now (can be improved with LLM)
    const sentences = section.split(/[.!?]+/).filter(s => s.trim());

    if (sentences.length <= 1) {
      // Single sentence: truncate by character ratio
      const ratio = targetTokens / (await this.tokenCounter.count(section));
      const targetLength = Math.floor(section.length * ratio);
      return section.slice(0, targetLength) + '...';
    }

    // Keep most important sentences
    const importanceScores = sentences.map((s, i) => ({
      sentence: s,
      index: i,
      score: this.calculateSentenceImportance(s, i, sentences.length),
    }));

    importanceScores.sort((a, b) => b.score - a.score);

    let compressed = '';
    let tokensUsed = 0;

    for (const { sentence, index } of importanceScores) {
      const sentenceTokens = await this.tokenCounter.count(sentence + '.');

      if (tokensUsed + sentenceTokens <= targetTokens) {
        compressed += sentence + '. ';
        tokensUsed += sentenceTokens;
      } else {
        break;
      }
    }

    return compressed.trim();
  }

  /**
   * Calculate sentence importance score
   */
  private calculateSentenceImportance(
    sentence: string,
    index: number,
    totalSentences: number
  ): number {
    let score = 0;

    // Position bias: first and last sentences more important
    if (index === 0) score += 0.3;
    if (index === totalSentences - 1) score += 0.2;

    // Length: not too short, not too long
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount >= 5 && wordCount <= 20) score += 0.2;

    // Keywords indicating importance
    const importantKeywords = [
      'decided', 'decision', 'concluded', 'agreed',
      'important', 'critical', 'key', 'main',
      'will', 'must', 'should', 'need',
      'found', 'discovered', 'realized',
    ];

    const lowerSentence = sentence.toLowerCase();
    for (const keyword of importantKeywords) {
      if (lowerSentence.includes(keyword)) {
        score += 0.1;
      }
    }

    // Numbers and specifics
    if (/\d+/.test(sentence)) score += 0.1;

    return score;
  }

  /**
   * Get compression granularity for older messages
   */
  private getOlderGranularity(
    currentGranularity: 'detailed' | 'medium' | 'brief'
  ): 'detailed' | 'medium' | 'brief' {
    const map = {
      detailed: 'medium',
      medium: 'brief',
      brief: 'brief',
    } as const;

    return map[currentGranularity];
  }

  /**
   * Get max tokens for granularity level
   */
  private getMaxTokensForGranularity(
    granularity: 'detailed' | 'medium' | 'brief',
    messageCount: number
  ): number {
    const baseTokens = {
      detailed: 200,
      medium: 100,
      brief: 50,
    };

    // Scale with message count
    return Math.floor(baseTokens[granularity] * Math.log(messageCount + 1));
  }

  /**
   * Format single message
   */
  private formatSingleMessage(message: Message): string {
    return `${message.role}: ${message.content}`;
  }

  /**
   * Fallback summary when LLM fails
   */
  private fallbackSummary(
    messages: Message[],
    granularity: 'detailed' | 'medium' | 'brief'
  ): string {
    if (messages.length === 0) return '';

    if (granularity === 'brief') {
      return `${messages.length} messages exchanged`;
    }

    const first = messages[0];
    const last = messages[messages.length - 1];

    return `- Started: ${first.role} - ${first.content.slice(0, 100)}...\n- Ended: ${last.role} - ${last.content.slice(0, 100)}...`;
  }

  /**
   * Create empty summary
   */
  private createEmptySummary(
    conversationId: string,
    maxTokens: number
  ): Summary {
    return {
      summary_id: randomUUID(),
      scope_type: 'conversation',
      scope_id: conversationId,
      summary_type: 'history',
      content: 'No messages to summarize',
      token_count: 5,
      source_message_ids: [],
      created_at: Date.now(),
      valid_until: Date.now() + 3600000,
      confidence: 1.0,
      metadata: {
        granularity: 'brief',
        windows: 0,
        message_count: 0,
      },
    };
  }
}
