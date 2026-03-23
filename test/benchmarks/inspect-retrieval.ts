/**
 * Detailed Retrieval Inspection
 *
 * Shows actual system output vs expected for manual verification
 */

import { MnemeService } from '../../src/core/service.js';
import { SearchEngine } from '../../src/core/search.js';
import { ResultRanker } from '../../src/core/ranking.js';
import {
  generateRetrievalTestDataset,
  type RetrievalTestCase,
} from './retrieval-test-dataset.js';

async function inspectTestCase(
  testCase: RetrievalTestCase,
  searchEngine: SearchEngine
): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log(`TEST CASE: ${testCase.id}`);
  console.log(`SCENARIO: ${testCase.scenario}`);
  console.log('='.repeat(80));
  console.log(`\nQUERY: "${testCase.query}"`);
  console.log(`DESCRIPTION: ${testCase.description}`);

  // Show ground truth
  console.log(`\n--- GROUND TRUTH (${testCase.groundTruthRelevant.length} relevant messages) ---`);
  const relevantSet = new Set(testCase.groundTruthRelevant);

  for (const msgId of testCase.groundTruthRelevant) {
    const msg = testCase.conversationHistory.find(m => m.message_id === msgId);
    if (msg) {
      console.log(`\n[${msgId}] ${msg.role}:`);
      console.log(`  ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
    }
  }

  // Perform search
  const fts5Query = `"${testCase.query.replace(/"/g, '""')}"`;
  const searchResponse = await searchEngine.search({
    query: fts5Query,
    limit: 10,
    useVector: false,
  });

  const results = searchResponse.results;

  // Show what was retrieved
  console.log(`\n--- ACTUAL RETRIEVAL (${results.length} results) ---`);

  for (let i = 0; i < Math.min(10, results.length); i++) {
    const result = results[i];
    const isRelevant = relevantSet.has(result.message.message_id);
    const marker = isRelevant ? '✓ RELEVANT' : '✗ IRRELEVANT';

    console.log(`\n[${i + 1}] ${marker} | Score: ${result.score.toFixed(4)} | ID: ${result.message.message_id}`);
    console.log(`    ${result.message.content.substring(0, 200)}${result.message.content.length > 200 ? '...' : ''}`);

    if (result.explanation) {
      const parts = [];
      if (result.explanation.sparse_score !== undefined) {
        parts.push(`BM25: ${result.explanation.sparse_score.toFixed(3)}`);
      }
      if (result.explanation.recency_score !== undefined) {
        parts.push(`Recency: ${result.explanation.recency_score.toFixed(3)}`);
      }
      console.log(`    Scores: ${parts.join(' | ')}`);
    }
  }

  // Calculate metrics
  const rankedResults = results.map((r, i) => ({ ...r, rank: i + 1 }));
  const relevantIds = new Set(testCase.groundTruthRelevant);

  const p5 = ResultRanker.calculatePrecisionAtK(rankedResults, relevantIds, 5);
  const r10 = ResultRanker.calculateRecallAtK(rankedResults, relevantIds, 10);
  const cp = ResultRanker.calculateContextPrecision(rankedResults.slice(0, 10), relevantIds);
  const cr = ResultRanker.calculateContextRecall(rankedResults.slice(0, 10), relevantIds);
  const mrr = ResultRanker.calculateMRR(rankedResults, relevantIds);

  console.log(`\n--- METRICS ---`);
  console.log(`Precision@5:      ${p5.toFixed(3)} (${(p5 * 5).toFixed(0)} relevant in top 5)`);
  console.log(`Recall@10:        ${r10.toFixed(3)} (${(r10 * relevantIds.size).toFixed(0)}/${relevantIds.size} relevant retrieved)`);
  console.log(`Context Precision: ${cp.toFixed(3)}`);
  console.log(`Context Recall:    ${cr.toFixed(3)}`);
  console.log(`MRR:              ${mrr.toFixed(3)}${mrr > 0 ? ` (first relevant at rank ${Math.round(1/mrr)})` : ''}`);

  // Analysis
  console.log(`\n--- ANALYSIS ---`);

  if (results.length === 0) {
    console.log(`❌ NO RESULTS RETURNED - Query may be too restrictive or FTS5 issue`);
  } else if (p5 === 0 && relevantIds.size > 0) {
    console.log(`❌ ZERO RELEVANT IN TOP 5 - Complete retrieval failure`);
    console.log(`   Possible issues:`);
    console.log(`   - Query terms don't match relevant message vocabulary`);
    console.log(`   - BM25 scoring not matching semantic relevance`);
    console.log(`   - Missing temporal/contextual signals`);
  } else if (p5 < 0.4) {
    console.log(`⚠️  LOW PRECISION - Too much noise in top results`);
  } else if (r10 < 0.5 && relevantIds.size <= 10) {
    console.log(`⚠️  LOW RECALL - Missing relevant messages`);
  } else if (p5 >= 0.8 && r10 >= 0.7) {
    console.log(`✅ GOOD PERFORMANCE - Meeting targets`);
  } else {
    console.log(`⚠️  MODERATE PERFORMANCE - Room for improvement`);
  }
}

async function main() {
  console.log('Mneme Retrieval System Inspection');
  console.log('Detailed output showing actual vs expected retrieval');
  console.log('');

  // Initialize
  const service = new MnemeService({ dbPath: ':memory:' });
  const db = (service as any).db;
  const searchEngine = new SearchEngine(db);

  // Load test dataset
  const testDataset = generateRetrievalTestDataset();

  // Insert data
  for (const testCase of testDataset) {
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

  // Inspect each test case
  for (const testCase of testDataset) {
    await inspectTestCase(testCase, searchEngine);
  }

  service.close();

  console.log('\n' + '='.repeat(80));
  console.log('Inspection complete');
  console.log('='.repeat(80));
}

main().catch(console.error);
