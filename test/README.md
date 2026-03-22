# Mneme Testing Infrastructure

Comprehensive testing and benchmarking infrastructure for Mneme v2.

## Test Status

**✅ All 66 tests passing**

### Coverage Summary

```
File         | % Stmts | % Branch | % Funcs | % Lines
-------------|---------|----------|---------|----------
All files    |   75.64 |    76.09 |   73.33 |   75.64
 ranking.ts  |   98.08 |    93.10 |  100.00 |   98.08  ✓
 import.ts   |   86.55 |    92.50 |   77.77 |   86.55  ✓
 service.ts  |   89.14 |    69.64 |   83.33 |   89.14  ✓
 tokens.ts   |   77.67 |    80.76 |   76.92 |   77.67  ~
 engine.ts   |   71.95 |    48.14 |   69.23 |   71.95  *
 search.ts   |   57.92 |    59.09 |   41.66 |   57.92  *
 assembly.ts |   51.47 |    66.66 |   63.63 |   51.47  *
```

**Legend:**
- ✓ = Above 80% target
- ~ = Close to target (75-80%)
- \* = Needs more coverage (<75%)

## Directory Structure

```
test/
├── unit/                           # Unit tests for individual modules
│   ├── ranking.test.ts             # ✅ ResultRanker (28 tests)
│   ├── import.test.ts              # ✅ SessionImporter (17 tests)
│   ├── search.test.ts              # ⏳ TODO
│   ├── assembly.test.ts            # ⏳ TODO (expand existing)
│   └── tokens.test.ts              # ⏳ TODO (expand existing)
├── integration/
│   ├── end-to-end.test.ts          # ✅ Full lifecycle workflows (8 tests)
│   ├── concurrency.test.ts         # ⏳ TODO
│   ├── database-integrity.test.ts  # ⏳ TODO
│   └── channels/
│       ├── openclaw.test.ts        # ⏳ TODO
│       └── channel-adapter.test.ts # ⏳ TODO (template)
├── benchmarks/
│   ├── dataset-generator.ts        # ✅ Generate test datasets
│   ├── search.bench.ts             # ⏳ TODO
│   ├── ingest.bench.ts             # ⏳ TODO
│   └── assembly.bench.ts           # ⏳ TODO
├── fixtures/
│   ├── sessions/                   # ✅ JSONL test files
│   │   ├── small-session.jsonl
│   │   └── medium-session.jsonl
│   ├── datasets/                   # Empty (generated on demand)
│   └── channels/                   # Empty (for future channels)
├── helpers/
│   ├── test-db.ts                  # ✅ Database test utilities
│   ├── fixtures.ts                 # ✅ Mock data generators
│   ├── performance.ts              # ✅ Benchmark utilities
│   ├── matchers.ts                 # ✅ Custom Vitest matchers
│   └── setup.ts                    # ✅ Global test setup
└── basic.test.ts                   # ✅ Original basic tests (13 tests)
```

## Implemented Features

### ✅ Test Helpers (Complete)

**test/helpers/test-db.ts**
- `createTestDb()` - Creates in-memory test database
- `cleanupTestDb()` - Cleans up test database
- `createTestConversation()` - Creates test conversation with messages
- `createTestConversations()` - Creates multiple conversations

**test/helpers/fixtures.ts**
- Mock message generators
- Mock search result generators
- JSONL content generators
- Realistic conversation generators
- Content templates (technical, conversational, code, data)

**test/helpers/performance.ts**
- `PerformanceTimer` class - High-resolution timing
- `MemoryTracker` class - Memory usage tracking
- Statistical functions (percentile, mean, stdDev)
- Benchmark runner utilities

**test/helpers/matchers.ts**
- Custom Vitest matchers:
  - `toBeValidMessageId()`
  - `toBeWithinTokenBudget()`
  - `toHaveSearchRelevance()`
  - `toHaveMessages()`
  - `toBeSortedByScore()`
  - `toHaveContiguousSequence()`

### ✅ Unit Tests (Implemented)

**test/unit/ranking.test.ts** (28 tests)
- Reciprocal Rank Fusion (RRF) merging
- Temporal decay algorithms
- Result diversification
- MRR and NDCG calculations
- BatchRanker parallel processing
- Ranking explanations

**test/unit/import.test.ts** (17 tests)
- JSONL session import
- Content block extraction
- Invalid JSON handling
- Progress callbacks
- Timestamp preservation
- Batch processing
- Directory imports
- Import verification

### ✅ Integration Tests (Implemented)

**test/integration/end-to-end.test.ts** (8 tests)
- Full lifecycle: Import → Ingest → Search → Assemble
- Compaction workflow with audit trail
- Cross-session search
- Token budget constraints
- Data integrity validation
- Search with filters
- Empty database handling
- Multiple assembly strategies

### ✅ Infrastructure

**vitest.config.ts**
- Node environment configuration
- Global setup files
- v8 coverage provider
- 80% coverage thresholds
- 30s test timeout

**package.json scripts**
```json
{
  "test": "vitest",
  "test:unit": "vitest run test/unit",
  "test:integration": "vitest run test/integration",
  "test:coverage": "vitest run --coverage",
  "test:watch": "vitest watch",
  "benchmark:run": "vitest run test/benchmarks --reporter=json",
  "benchmark:compare": "node scripts/compare-benchmarks.js",
  "fixtures:generate": "tsx scripts/generate-fixtures.ts"
}
```

## Remaining Work

### Unit Tests (To Increase Coverage)

**test/unit/search.test.ts** (Priority: High)
- Filter combinations
- Pagination (limit, offset)
- Empty query handling
- Special characters
- Hybrid vs keyword search modes

**test/unit/assembly.test.ts** (Priority: High)
- All 5 strategies (recent, relevant, hybrid, sliding-window, full)
- Edge cases (zero budget, huge budget)
- Token budget enforcement
- Message ordering

**test/unit/tokens.test.ts** (Priority: Medium)
- Model family detection
- Cache edge cases
- Batch counting edge cases

### Integration Tests

**test/integration/concurrency.test.ts**
- Parallel message ingestion
- Concurrent reads during writes
- Parallel search queries
- Token cache consistency

**test/integration/database-integrity.test.ts**
- Transaction rollback
- Foreign key constraints
- FTS5 trigger functionality
- Cascade deletes

**test/integration/channels/openclaw.test.ts**
- OpenClaw JSONL import
- Content block extraction
- Error handling

**test/integration/channels/channel-adapter.test.ts**
- Template for future channels (Slack, Discord, etc.)

### Benchmarks

**test/benchmarks/search.bench.ts**
- Search latency at 1K/10K/100K scale
- P50/P95/P99 percentiles
- Target: keyword <20ms, hybrid <80ms

**test/benchmarks/ingest.bench.ts**
- Ingestion throughput
- Target: >200 msg/sec, <5ms per message

**test/benchmarks/assembly.bench.ts**
- Context packing performance
- Strategy comparison

## Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Run benchmarks
npm run benchmark:run

# Generate fixtures
npm run fixtures:generate
```

## Test Fixtures

### Session Files

**small-session.jsonl**
- 6 messages
- PostgreSQL troubleshooting conversation
- Good for quick tests

**medium-session.jsonl**
- 10 messages
- React hooks tutorial conversation
- Good for integration tests

### Generated Datasets

Run `npm run fixtures:generate` to create:
- `dataset-1K.jsonl` - 1,000 messages
- `dataset-10K.jsonl` - 10,000 messages
- `dataset-100K.jsonl` - 100,000 messages

## Custom Matchers

```typescript
// Message ID validation
expect(messageId).toBeValidMessageId();

// Token budget validation
expect(totalTokens).toBeWithinTokenBudget(budget);

// Search relevance
expect(results).toHaveSearchRelevance('database');

// Conversation state
expect(conversation).toHaveMessages();

// Result ordering
expect(results).toBeSortedByScore();

// Sequence validation
expect(messages).toHaveContiguousSequence();
```

## Performance Testing

```typescript
import { PerformanceTimer, runBenchmark } from './helpers/performance.js';

// Measure operation
const timer = new PerformanceTimer();
const { result, duration } = await timer.measure(async () => {
  return await searchEngine.search({ query: 'test' });
});

// Get statistics
const stats = timer.getStats();
console.log(`P50: ${stats.p50}ms, P95: ${stats.p95}ms`);

// Run benchmark suite
const result = await runBenchmark('Search 1K', async () => {
  await searchEngine.search({ query: 'test' });
}, 100);
```

## Key Testing Principles

1. **Isolation**: Each test uses fresh in-memory database (`:memory:`)
2. **Determinism**: Mock timestamps, use fixed seeds
3. **Cleanup**: Always close databases in `afterEach()`
4. **Realism**: Use realistic message content and patterns
5. **Performance**: Keep unit tests fast (<100ms each)
6. **Documentation**: Document edge cases in test descriptions

## Contributing

When adding new tests:

1. Use appropriate test helpers from `test/helpers/`
2. Follow existing test structure and naming
3. Add custom matchers if needed
4. Ensure cleanup in `afterEach()`
5. Document complex test scenarios
6. Run coverage to ensure improvement

## Next Steps to 80% Coverage

1. **search.test.ts** - Add 15-20 tests for SearchEngine
2. **assembly.test.ts** - Expand to cover all 5 strategies and edge cases
3. **tokens.test.ts** - Add model family and cache edge case tests
4. **concurrency.test.ts** - Add parallel operation tests

Estimated effort: 2-3 days to reach 80% coverage threshold.
