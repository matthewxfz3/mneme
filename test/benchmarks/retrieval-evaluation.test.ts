/**
 * Retrieval Evaluation Harness
 *
 * Systematically evaluates Mneme's context retrieval accuracy using
 * curated test cases with ground truth relevance labels.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { MnemeService } from '../../src/core/service.js';
import { SearchEngine } from '../../src/core/search.js';
import { ResultRanker, type RankedResult } from '../../src/core/ranking.js';
import {
  generateRetrievalTestDataset,
  getDatasetStats,
  type RetrievalTestCase,
} from './retrieval-test-dataset.js';

interface EvaluationResult {
  testCaseId: string;
  scenario: string;
  query: string;
  description: string;
  metrics: {
    precision_at_5: number;
    recall_at_10: number;
    context_precision: number;
    context_recall: number;
    mrr: number;
    ndcg_at_10: number;
    f1_at_5: number;
  };
  retrievedCount: number;
  relevantCount: number;
  topResults: Array<{
    message_id: string;
    score: number;
    rank: number;
    isRelevant: boolean;
    preview: string;
  }>;
  failureMode?: string;
}

interface AggregateMetrics {
  totalTestCases: number;
  averageMetrics: {
    precision_at_5: number;
    recall_at_10: number;
    context_precision: number;
    context_recall: number;
    mrr: number;
    ndcg_at_10: number;
    f1_at_5: number;
  };
  byScenario: Record<string, {
    count: number;
    avgPrecision: number;
    avgRecall: number;
    avgContextPrecision: number;
    avgContextRecall: number;
  }>;
  failureModes: Array<{
    testCaseId: string;
    scenario: string;
    query: string;
    issue: string;
    precision: number;
  }>;
}

describe('Retrieval Evaluation Harness', () => {
  let db: Database.Database;
  let service: MnemeService;
  let searchEngine: SearchEngine;
  let testDataset: RetrievalTestCase[];
  let evaluationResults: EvaluationResult[] = [];

  beforeAll(async () => {
    // Create in-memory database and service
    service = new MnemeService({ dbPath: ':memory:' });
    db = (service as any).db; // Access private db for search engine

    // Initialize search engine
    searchEngine = new SearchEngine(db);

    // Load test dataset
    testDataset = generateRetrievalTestDataset();

    // Insert test data into database
    for (const testCase of testDataset) {
      // Create conversation if it doesn't exist
      const conversationIds = new Set<string>();

      for (const message of testCase.conversationHistory) {
        if (!conversationIds.has(message.conversation_id)) {
          service.createConversation({
            conversation_id: message.conversation_id,
            title: `Test Conversation ${message.conversation_id}`,
          });
          conversationIds.add(message.conversation_id);
        }

        service.addMessage({
          message_id: message.message_id,
          conversation_id: message.conversation_id,
          role: message.role,
          content: message.content,
          tokens: message.tokens,
          model_family: message.model_family,
        });
      }
    }

    console.log('\n=== Test Dataset Statistics ===');
    const stats = getDatasetStats();
    console.log(`Total test cases: ${stats.totalTestCases}`);
    console.log(`By scenario:`, stats.byScenario);
    console.log(`Total messages: ${stats.totalMessages}`);
    console.log(`Avg messages per case: ${stats.avgMessagesPerCase.toFixed(1)}`);
    console.log(`Avg relevant per case: ${stats.avgRelevantPerCase.toFixed(1)}\n`);
  });

  afterAll(() => {
    service.close();

    // Generate and save evaluation report
    const report = generateEvaluationReport(evaluationResults);
    saveEvaluationReport(report, evaluationResults);
  });

  describe('Individual Test Case Evaluation', () => {
    for (const testCase of generateRetrievalTestDataset()) {
      it(`${testCase.id}: ${testCase.description}`, async () => {
        const result = await evaluateTestCase(
          testCase,
          searchEngine,
          service
        );

        evaluationResults.push(result);

        // Log detailed results
        console.log(`\n[${testCase.id}] ${testCase.scenario}: ${testCase.query}`);
        console.log(`  P@5: ${result.metrics.precision_at_5.toFixed(3)} | R@10: ${result.metrics.recall_at_10.toFixed(3)} | ` +
                    `CP: ${result.metrics.context_precision.toFixed(3)} | CR: ${result.metrics.context_recall.toFixed(3)}`);

        if (result.failureMode) {
          console.log(`  ⚠️  Failure: ${result.failureMode}`);
        } else {
          console.log(`  ✓ Pass`);
        }

        // Show top 3 results
        console.log(`  Top 3 results:`);
        result.topResults.slice(0, 3).forEach(r => {
          const marker = r.isRelevant ? '✓' : '✗';
          console.log(`    ${marker} [${r.rank}] ${r.score.toFixed(3)} - ${r.preview}`);
        });

        // Assert minimum quality thresholds
        // These are relaxed thresholds - goal is to identify failure modes, not pass/fail
        expect(result.metrics.precision_at_5).toBeGreaterThanOrEqual(0.0);
        expect(result.metrics.recall_at_10).toBeGreaterThanOrEqual(0.0);
      });
    }
  });
});

/**
 * Evaluate a single test case
 */
async function evaluateTestCase(
  testCase: RetrievalTestCase,
  searchEngine: SearchEngine,
  service: MnemeService
): Promise<EvaluationResult> {
  // Prepare FTS5-safe query by quoting it
  // This prevents special characters like ? from being interpreted as FTS5 operators
  const fts5Query = `"${testCase.query.replace(/"/g, '""')}"`;

  // Perform search
  const searchResponse = await searchEngine.search({
    query: fts5Query,
    limit: 20,
    useVector: false, // Sparse-only for baseline
  });

  const results = searchResponse.results;

  // Convert to RankedResult format for metric calculation
  const rankedResults: RankedResult[] = results.map((r, i) => ({
    ...r,
    rank: i + 1,
  }));

  // Create ground truth set
  const relevantIds = new Set(testCase.groundTruthRelevant);

  // Calculate metrics
  const precision_at_5 = ResultRanker.calculatePrecisionAtK(
    rankedResults,
    relevantIds,
    5
  );

  const recall_at_10 = ResultRanker.calculateRecallAtK(
    rankedResults,
    relevantIds,
    10
  );

  const context_precision = ResultRanker.calculateContextPrecision(
    rankedResults.slice(0, 10), // Top 10 for context
    relevantIds
  );

  const context_recall = ResultRanker.calculateContextRecall(
    rankedResults.slice(0, 10),
    relevantIds
  );

  const mrr = ResultRanker.calculateMRR(rankedResults, relevantIds);

  // Create relevance scores for NDCG (binary: 1 if relevant, 0 if not)
  const relevanceScores = new Map<string, number>();
  rankedResults.forEach(r => {
    relevanceScores.set(
      r.message.message_id,
      relevantIds.has(r.message.message_id) ? 1 : 0
    );
  });
  const ndcg_at_10 = ResultRanker.calculateNDCG(
    rankedResults,
    relevanceScores,
    10
  );

  const f1_at_5 = ResultRanker.calculateF1AtK(rankedResults, relevantIds, 5);

  // Identify failure modes
  let failureMode: string | undefined;

  if (relevantIds.size > 0) {
    if (precision_at_5 < 0.4) {
      failureMode = `Low precision (${precision_at_5.toFixed(2)}) - too many irrelevant results in top 5`;
    } else if (recall_at_10 < 0.5 && relevantIds.size <= 10) {
      failureMode = `Low recall (${recall_at_10.toFixed(2)}) - missing relevant messages`;
    } else if (mrr < 0.5) {
      failureMode = `Low MRR (${mrr.toFixed(2)}) - first relevant result ranked too low`;
    }
  }

  // Extract top results for reporting
  const topResults = rankedResults.slice(0, 5).map(r => ({
    message_id: r.message.message_id,
    score: r.score,
    rank: r.rank,
    isRelevant: relevantIds.has(r.message.message_id),
    preview: r.message.content.substring(0, 60) + '...',
  }));

  return {
    testCaseId: testCase.id,
    scenario: testCase.scenario,
    query: testCase.query,
    description: testCase.description,
    metrics: {
      precision_at_5,
      recall_at_10,
      context_precision,
      context_recall,
      mrr,
      ndcg_at_10,
      f1_at_5,
    },
    retrievedCount: rankedResults.length,
    relevantCount: relevantIds.size,
    topResults,
    failureMode,
  };
}

/**
 * Generate aggregate evaluation report
 */
function generateEvaluationReport(results: EvaluationResult[]): AggregateMetrics {
  const totalCases = results.length;

  // Calculate averages
  const avgMetrics = {
    precision_at_5: results.reduce((sum, r) => sum + r.metrics.precision_at_5, 0) / totalCases,
    recall_at_10: results.reduce((sum, r) => sum + r.metrics.recall_at_10, 0) / totalCases,
    context_precision: results.reduce((sum, r) => sum + r.metrics.context_precision, 0) / totalCases,
    context_recall: results.reduce((sum, r) => sum + r.metrics.context_recall, 0) / totalCases,
    mrr: results.reduce((sum, r) => sum + r.metrics.mrr, 0) / totalCases,
    ndcg_at_10: results.reduce((sum, r) => sum + r.metrics.ndcg_at_10, 0) / totalCases,
    f1_at_5: results.reduce((sum, r) => sum + r.metrics.f1_at_5, 0) / totalCases,
  };

  // Group by scenario
  const scenarios = new Set(results.map(r => r.scenario));
  const byScenario: Record<string, any> = {};

  for (const scenario of scenarios) {
    const scenarioResults = results.filter(r => r.scenario === scenario);
    const count = scenarioResults.length;

    byScenario[scenario] = {
      count,
      avgPrecision: scenarioResults.reduce((sum, r) => sum + r.metrics.precision_at_5, 0) / count,
      avgRecall: scenarioResults.reduce((sum, r) => sum + r.metrics.recall_at_10, 0) / count,
      avgContextPrecision: scenarioResults.reduce((sum, r) => sum + r.metrics.context_precision, 0) / count,
      avgContextRecall: scenarioResults.reduce((sum, r) => sum + r.metrics.context_recall, 0) / count,
    };
  }

  // Identify failure modes
  const failureModes = results
    .filter(r => r.failureMode)
    .map(r => ({
      testCaseId: r.testCaseId,
      scenario: r.scenario,
      query: r.query,
      issue: r.failureMode!,
      precision: r.metrics.precision_at_5,
    }));

  return {
    totalTestCases: totalCases,
    averageMetrics: avgMetrics,
    byScenario,
    failureModes,
  };
}

/**
 * Save evaluation report to file
 */
function saveEvaluationReport(
  report: AggregateMetrics,
  detailedResults: EvaluationResult[]
): void {
  const outputDir = join(process.cwd(), 'test', 'benchmarks', 'baselines');
  mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().split('T')[0];
  const baselineFile = join(outputDir, `retrieval-baseline-${timestamp}.json`);

  const output = {
    version: '0.2.0',
    timestamp,
    aggregate: report,
    detailed: detailedResults,
  };

  writeFileSync(baselineFile, JSON.stringify(output, null, 2));

  console.log('\n=== EVALUATION SUMMARY ===');
  console.log(`Total test cases: ${report.totalTestCases}`);
  console.log(`\nAverage Metrics:`);
  console.log(`  Precision@5:      ${report.averageMetrics.precision_at_5.toFixed(3)} (target: >0.80)`);
  console.log(`  Recall@10:        ${report.averageMetrics.recall_at_10.toFixed(3)} (target: >0.70)`);
  console.log(`  Context Precision: ${report.averageMetrics.context_precision.toFixed(3)} (target: >0.75)`);
  console.log(`  Context Recall:    ${report.averageMetrics.context_recall.toFixed(3)} (target: >0.60)`);
  console.log(`  MRR:              ${report.averageMetrics.mrr.toFixed(3)}`);
  console.log(`  NDCG@10:          ${report.averageMetrics.ndcg_at_10.toFixed(3)}`);
  console.log(`  F1@5:             ${report.averageMetrics.f1_at_5.toFixed(3)}`);

  console.log(`\nBy Scenario:`);
  for (const [scenario, metrics] of Object.entries(report.byScenario)) {
    console.log(`  ${scenario} (n=${metrics.count}):`);
    console.log(`    P@5: ${metrics.avgPrecision.toFixed(3)} | R@10: ${metrics.avgRecall.toFixed(3)} | ` +
                `CP: ${metrics.avgContextPrecision.toFixed(3)} | CR: ${metrics.avgContextRecall.toFixed(3)}`);
  }

  if (report.failureModes.length > 0) {
    console.log(`\nFailure Modes (${report.failureModes.length} cases):`);
    report.failureModes.forEach(f => {
      console.log(`  [${f.testCaseId}] ${f.scenario}: ${f.query}`);
      console.log(`    Issue: ${f.issue}`);
    });
  } else {
    console.log(`\n✓ No failure modes detected - all tests passed quality thresholds!`);
  }

  console.log(`\nBaseline saved to: ${baselineFile}`);
  console.log('=========================\n');
}
