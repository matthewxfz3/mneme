# Context Retrieval Accuracy Benchmarks

This document tracks Mneme's context retrieval accuracy using systematic evaluation with ground-truth test datasets.

## Table of Contents
- [Overview](#overview)
- [Evaluation Methodology](#evaluation-methodology)
- [Baseline Results (v0.2.0)](#baseline-results-v020)
- [Test Dataset](#test-dataset)
- [Metrics Explained](#metrics-explained)
- [Running Evaluations](#running-evaluations)

---

## Overview

**Goal:** Measure and improve Mneme's ability to retrieve the right messages for conversational context queries.

**Approach:** Internal evaluation framework with curated test datasets containing ground truth relevance labels.

**Key Questions:**
1. **Relevance:** Are the retrieved messages actually relevant to the query?
2. **Completeness:** Did we get all the important relevant messages?
3. **Precision:** What % of retrieved messages are relevant? (avoid noise)
4. **Ranking Quality:** Are the most relevant messages ranked highest?

---

## Evaluation Methodology

### Test Dataset

**Location:** `test/benchmarks/retrieval-test-dataset.ts`

**Composition:**
- **10 curated test cases** with ground truth relevance labels
- **62 total messages** across diverse conversation histories
- **Average 2.9 relevant messages per test case**

**Scenario Coverage:**
- **Technical (4 cases):** Specific technical errors, conceptual questions, code debugging
- **Temporal (2 cases):** Recent decisions, time-bounded discussions
- **Multi-hop (2 cases):** Following references, tracing decisions through conversations
- **Disambiguation (2 cases):** Distinguishing similar topics, specific vs general

### Metrics

**Implemented Metrics:** (`src/core/ranking.ts`)
- **Precision@K:** Fraction of top-K results that are relevant
- **Recall@K:** Fraction of all relevant results in top-K
- **Context Precision:** % of retrieved messages that are relevant (RAG-specific)
- **Context Recall:** % of all relevant messages that were retrieved (RAG-specific)
- **MRR:** Mean Reciprocal Rank - rank of first relevant result
- **NDCG@K:** Normalized Discounted Cumulative Gain - ranking quality
- **F1@K:** Harmonic mean of Precision@K and Recall@K

### Evaluation Harness

**Location:** `test/benchmarks/retrieval-evaluation.test.ts`

**Process:**
1. Load test dataset into in-memory database
2. Execute each query through Mneme's search pipeline
3. Compare retrieved results against ground truth
4. Calculate metrics per test case
5. Aggregate results by scenario type
6. Identify failure modes (P@5 <0.4, R@10 <0.5, MRR <0.5)
7. Generate detailed report with per-query breakdown

---

## Baseline Results (v0.2.0)

**Date:** 2026-03-22
**Configuration:** Sparse search only (FTS5 BM25), no vector search
**Baseline File:** `test/benchmarks/baselines/retrieval-baseline-2026-03-22.json`

### Aggregate Metrics

| Metric | Value | Target | Gap |
|--------|-------|--------|-----|
| **Precision@5** | 0.100 | >0.80 | -0.70 |
| **Recall@10** | 0.050 | >0.70 | -0.65 |
| **Context Precision** | 0.100 | >0.75 | -0.65 |
| **Context Recall** | 0.050 | >0.60 | -0.55 |
| **MRR** | 0.100 | N/A | N/A |
| **NDCG@10** | 0.100 | N/A | N/A |
| **F1@5** | 0.067 | N/A | N/A |

### Performance by Scenario

| Scenario | Test Cases | Avg P@5 | Avg R@10 | Avg CP | Avg CR |
|----------|-----------|---------|----------|--------|--------|
| **Technical** | 4 | 0.250 | 0.125 | 0.250 | 0.125 |
| **Temporal** | 2 | 0.000 | 0.000 | 0.000 | 0.000 |
| **Multi-hop** | 2 | 0.000 | 0.000 | 0.000 | 0.000 |
| **Disambiguation** | 2 | 0.000 | 0.000 | 0.000 | 0.000 |

### Key Findings

**✅ What Works:**
- Technical scenario (P@5: 0.25) performs best among all scenarios
- One test case (tech-002) achieved perfect precision

**❌ Major Issues:**
1. **Temporal queries fail completely** (0.00 precision/recall)
   - Example: "What did we decide about the authentication approach today?"
   - Issue: Not prioritizing recency correctly

2. **Multi-hop reasoning fails** (0.00 precision/recall)
   - Example: "What was the solution to the bug Sarah reported?"
   - Issue: Cannot connect related messages across conversation

3. **Disambiguation fails** (0.00 precision/recall)
   - Example: "How do I configure CORS for the API server?"
   - Issue: Retrieving general CORS info instead of API-specific config

### Failure Modes (8/10 test cases)

**Common Pattern:** "Low precision (0.00) - too many irrelevant results in top 5"

**Failed Test Cases:**
1. `tech-001`: Database connection timeout error (should retrieve timeout-specific messages)
2. `tech-003`: React infinite re-render (should retrieve debugging thread)
3. `temporal-001`: Recent authentication decision (should prioritize today's messages)
4. `temporal-002`: Rate limiting strategy from last week (should use time filter)
5. `multi-hop-001`: Sarah's bug solution (should connect bug report → discussion → solution)
6. `multi-hop-002`: MongoDB vs PostgreSQL decision (should trace decision through conversation)
7. `disambig-001`: CORS API server config (should distinguish from frontend/general CORS)
8. `disambig-002`: AWS deployment (should distinguish from other platforms/general deployment)

---

## Test Dataset

### Example Test Cases

#### Technical: Database Timeout Error
**Query:** "How do I fix the database connection timeout error?"
**Relevant Messages:** 3 (msg-001, msg-002, msg-004)
**Challenge:** Distinguish timeout-specific discussion from general database topics

#### Temporal: Recent Decision
**Query:** "What did we decide about the authentication approach today?"
**Relevant Messages:** 4 (msg-301, msg-302, msg-303, msg-304)
**Challenge:** Prioritize recent messages (1 hour ago) over older ones (1 month ago)

#### Multi-hop: Bug Solution
**Query:** "What was the solution to the bug Sarah reported?"
**Relevant Messages:** 5 (msg-501, msg-502, msg-503, msg-504, msg-505)
**Challenge:** Connect Sarah's bug report with subsequent discussion and solution

#### Disambiguation: API CORS Config
**Query:** "How do I configure CORS for the API server?"
**Relevant Messages:** 2 (msg-701, msg-702)
**Challenge:** Retrieve API server configuration, not frontend or general CORS info

---

## Metrics Explained

### Precision@K
**Definition:** Fraction of top-K retrieved messages that are relevant
**Formula:** `relevant_in_top_k / k`
**Interpretation:** Higher is better - measures noise reduction
**Target:** >0.80 (80%+ of top 5 results should be relevant)

### Recall@K
**Definition:** Fraction of all relevant messages that appear in top-K
**Formula:** `relevant_in_top_k / total_relevant`
**Interpretation:** Higher is better - measures completeness
**Target:** >0.70 (70%+ of relevant messages should be in top 10)

### Context Precision
**Definition:** % of retrieved messages that are relevant (RAG-specific)
**Formula:** `relevant_retrieved / total_retrieved`
**Interpretation:** Measures signal-to-noise ratio in assembled context
**Target:** >0.75 (75%+ of context should be relevant)

### Context Recall
**Definition:** % of all relevant messages that were retrieved (RAG-specific)
**Formula:** `relevant_retrieved / total_relevant`
**Interpretation:** Measures coverage of important information
**Target:** >0.60 (60%+ of relevant messages should be retrieved)

### Mean Reciprocal Rank (MRR)
**Definition:** Reciprocal of rank of first relevant result
**Formula:** `1 / rank_of_first_relevant`
**Interpretation:** Higher is better - measures ranking quality
**Example:** First relevant at rank 2 → MRR = 0.5

### NDCG@K
**Definition:** Normalized Discounted Cumulative Gain at K
**Formula:** `DCG@K / IDCG@K` (discounts relevance by position)
**Interpretation:** 1.0 = perfect ranking, 0.0 = worst possible
**Use:** Measures overall ranking quality accounting for position

---

## Running Evaluations

### Quick Evaluation
```bash
npm test -- test/benchmarks/retrieval-evaluation.test.ts
```

### Generate New Baseline
```bash
npm test -- test/benchmarks/retrieval-evaluation.test.ts --reporter=verbose
```

Results saved to: `test/benchmarks/baselines/retrieval-baseline-YYYY-MM-DD.json`

### Understanding Output

**Per-test output:**
```
[tech-001] technical: How do I fix the database connection timeout error?
  P@5: 0.000 | R@10: 0.000 | CP: 0.000 | CR: 0.000
  ⚠️  Failure: Low precision (0.00) - too many irrelevant results in top 5
  Top 3 results:
    ✗ [1] 0.842 - How do I set up PostgreSQL on Ubuntu?...
    ✗ [2] 0.789 - What are the advantages of PostgreSQL...
    ✗ [3] 0.654 - I am getting a database connection...
```

**Legend:**
- `P@5`: Precision at 5 (what % of top 5 are relevant)
- `R@10`: Recall at 10 (what % of relevant messages in top 10)
- `CP`: Context Precision (overall relevance %)
- `CR`: Context Recall (coverage of relevant messages)
- `✓`: Relevant result
- `✗`: Irrelevant result
- `[rank]`: Position in results
- `score`: Retrieval confidence score

---

## Improvement Roadmap

Based on baseline findings, priority improvements:

### Phase 1: Temporal Awareness (Highest Impact)
- **Issue:** Temporal queries have 0.00 precision/recall
- **Fix:** Improve recency weighting in ranking
- **Target:** Achieve P@5 >0.60 for temporal scenarios

### Phase 2: Multi-hop Reasoning
- **Issue:** Cannot connect related messages
- **Fix:** Implement conversation thread awareness
- **Target:** Achieve P@5 >0.50 for multi-hop scenarios

### Phase 3: Disambiguation
- **Issue:** Cannot distinguish similar topics
- **Fix:** Better query understanding and term weighting
- **Target:** Achieve P@5 >0.60 for disambiguation scenarios

### Phase 4: Overall Quality
- **Goal:** Meet all targets across all scenarios
- **Targets:**
  - Precision@5 >0.80
  - Recall@10 >0.70
  - Context Precision >0.75
  - Context Recall >0.60

---

## Comparison to Previous Versions

| Version | Date | P@5 | R@10 | CP | CR | Notes |
|---------|------|-----|------|----|----|-------|
| **v0.2.0** | 2026-03-22 | 0.100 | 0.050 | 0.100 | 0.050 | Baseline - sparse search only |

*(Future versions will be added as improvements are implemented)*

---

## Related Documentation

- **Implementation:** See `src/core/ranking.ts` for metric implementations
- **Test Dataset:** See `test/benchmarks/retrieval-test-dataset.ts` for test case definitions
- **Evaluation Harness:** See `test/benchmarks/retrieval-evaluation.test.ts` for evaluation code
- **Search Pipeline:** See `src/core/search.ts` for retrieval implementation
- **Assembly:** See `src/core/assembly.ts` for context assembly strategies

---

## Acknowledgments

**Methodology inspired by:**
- Standard Information Retrieval metrics (Precision, Recall, NDCG, MRR)
- RAG evaluation frameworks (Context Precision/Recall)
- TREC evaluation campaigns (ground truth labeling)
