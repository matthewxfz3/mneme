# Mneme System Card - Version 0.2.0

**Model/System Name:** Mneme Context Retrieval System
**Version:** 0.2.0
**Evaluation Date:** March 23, 2026
**Evaluator:** Internal automated evaluation framework
**Status:** ⚠️ **Critical Issues Identified** - Requires immediate improvement

---

## Table of Contents
- [Executive Summary](#executive-summary)
- [System Overview](#system-overview)
- [Evaluation Methodology](#evaluation-methodology)
- [Quantitative Results](#quantitative-results)
- [Qualitative Analysis](#qualitative-analysis)
- [Actual System Output Examples](#actual-system-output-examples)
- [Root Cause Analysis](#root-cause-analysis)
- [Identified Issues](#identified-issues)
- [Recommendations](#recommendations)
- [Appendix](#appendix)

---

## Executive Summary

### Performance Summary

| Metric | Measured | Target | Status |
|--------|----------|--------|--------|
| **Precision@5** | 0.100 | >0.80 | ❌ **-87.5% below target** |
| **Recall@10** | 0.050 | >0.70 | ❌ **-92.9% below target** |
| **Context Precision** | 0.100 | >0.75 | ❌ **-86.7% below target** |
| **Context Recall** | 0.050 | >0.60 | ❌ **-91.7% below target** |

### Critical Finding

**Root Cause:** FTS5 query preprocessing wraps entire user query in quotes for special character safety, resulting in overly restrictive exact phrase matching.

**Impact:**
- **90% of test queries return ZERO results** (9 out of 10 test cases)
- **Only 1 successful retrieval** across all test scenarios
- System is effectively **non-functional** for conversational context retrieval

### System Capabilities

| Capability | Status | Evidence |
|------------|--------|----------|
| **Basic keyword search** | ⚠️ Partially working | 1/10 test cases successful |
| **Temporal queries** | ❌ Completely fails | 0% precision/recall |
| **Multi-hop reasoning** | ❌ Completely fails | 0% precision/recall |
| **Disambiguation** | ❌ Completely fails | 0% precision/recall |
| **Exact phrase matching** | ✅ Works | tech-002 achieved P@5=1.0 |

---

## System Overview

### Architecture

**Search Pipeline:**
```
User Query
    ↓
FTS5 Query Preprocessing (wraps in quotes)
    ↓
SQLite FTS5 (BM25 ranking)
    ↓
Temporal Decay (30-day half-life)
    ↓
Score Normalization
    ↓
Ranked Results
```

**Components:**
- **Search Engine:** `src/core/search.ts` - FTS5-based sparse search
- **Ranking:** `src/core/ranking.ts` - RRF fusion, temporal decay, diversity
- **Assembly:** `src/core/assembly.ts` - Token-aware context packing

**Configuration (v0.2.0 baseline):**
- **Search Type:** Sparse only (FTS5 BM25)
- **Vector Search:** Disabled
- **Weights:** Sparse=0.5, Recency=0.2
- **Temporal Decay:** 30-day half-life
- **Query Preprocessing:** Full query wrapped in quotes (`"query"`)

---

## Evaluation Methodology

### Test Dataset

**Composition:**
- **Total Test Cases:** 10
- **Total Messages:** 62 across diverse conversation histories
- **Average Relevant Messages per Case:** 2.9
- **Ground Truth:** Manual curation with explicit relevance labels

**Scenario Distribution:**
| Scenario Type | Count | Description |
|---------------|-------|-------------|
| Technical | 4 | Specific technical errors, conceptual questions, debugging |
| Temporal | 2 | Recent decisions, time-bounded discussions |
| Multi-hop | 2 | Following references, tracing decisions through conversations |
| Disambiguation | 2 | Distinguishing similar topics, specific vs general |

### Metrics

All metrics implemented in `src/core/ranking.ts`:

- **Precision@K:** Fraction of top-K results that are relevant
- **Recall@K:** Fraction of all relevant results in top-K
- **Context Precision:** % of retrieved messages that are relevant (RAG-specific)
- **Context Recall:** % of all relevant messages retrieved (RAG-specific)
- **MRR:** Mean Reciprocal Rank - rank of first relevant result
- **NDCG@K:** Normalized Discounted Cumulative Gain
- **F1@K:** Harmonic mean of Precision@K and Recall@K

### Evaluation Process

1. Load test dataset into in-memory database
2. Execute each query through search pipeline
3. Compare retrieved results against ground truth
4. Calculate metrics per test case
5. Aggregate results by scenario type
6. Identify failure modes (P@5 <0.4, R@10 <0.5, MRR <0.5)

---

## Quantitative Results

### Aggregate Performance

| Metric | Value | Target | Gap | Interpretation |
|--------|-------|--------|-----|----------------|
| **Precision@5** | 0.100 | >0.80 | -0.70 | Only 10% of top-5 results are relevant |
| **Recall@10** | 0.050 | >0.70 | -0.65 | Only 5% of relevant messages retrieved |
| **Context Precision** | 0.100 | >0.75 | -0.65 | 90% of retrieved context is noise |
| **Context Recall** | 0.050 | >0.60 | -0.55 | Missing 95% of relevant information |
| **MRR** | 0.100 | N/A | N/A | First relevant result at rank ~10 |
| **NDCG@10** | 0.100 | N/A | N/A | Poor ranking quality |
| **F1@5** | 0.067 | N/A | N/A | Very poor precision-recall balance |

### Performance by Scenario

| Scenario | Tests | Avg P@5 | Avg R@10 | Avg CP | Avg CR | Status |
|----------|-------|---------|----------|--------|--------|--------|
| **Technical** | 4 | 0.250 | 0.125 | 0.250 | 0.125 | ⚠️ Poor |
| **Temporal** | 2 | 0.000 | 0.000 | 0.000 | 0.000 | ❌ Failed |
| **Multi-hop** | 2 | 0.000 | 0.000 | 0.000 | 0.000 | ❌ Failed |
| **Disambiguation** | 2 | 0.000 | 0.000 | 0.000 | 0.000 | ❌ Failed |

### Detailed Test Case Results

| Test ID | Scenario | Query | Results | P@5 | R@10 | Status |
|---------|----------|-------|---------|-----|------|--------|
| tech-001 | Technical | Database timeout error | **0** | 0.00 | 0.00 | ❌ No results |
| tech-002 | Technical | JWT vs session auth | **1** | 1.00 | 0.50 | ✅ Success |
| tech-003 | Technical | React infinite re-render | **0** | 0.00 | 0.00 | ❌ No results |
| temporal-001 | Temporal | Auth decision today | **0** | 0.00 | 0.00 | ❌ No results |
| temporal-002 | Temporal | Rate limiting last week | **0** | 0.00 | 0.00 | ❌ No results |
| multi-hop-001 | Multi-hop | Sarah's bug solution | **0** | 0.00 | 0.00 | ❌ No results |
| multi-hop-002 | Multi-hop | MongoDB choice reason | **0** | 0.00 | 0.00 | ❌ No results |
| disambig-001 | Disambiguation | CORS API config | **0** | 0.00 | 0.00 | ❌ No results |
| disambig-002 | Disambiguation | AWS deployment | **0** | 0.00 | 0.00 | ❌ No results |
| edge-001 | Edge case | Blockchain (no relevant) | **0** | 0.00 | 0.00 | ✅ Expected |

**Success Rate:** 1/10 (10%) - Only one test case successfully retrieved relevant results

---

## Qualitative Analysis

### Failure Mode Distribution

**Identified Failure Modes (8 cases):**

| Failure Mode | Count | % |
|--------------|-------|---|
| No results returned | 9 | 90% |
| Low precision (<0.4) | 0 | 0% |
| Low recall (<0.5) | 0 | 0% |
| Low MRR (<0.5) | 0 | 0% |

**Primary Issue:** System returns zero results for 90% of queries due to overly restrictive query preprocessing.

### Scenario-Specific Observations

**Technical Queries (4 cases):**
- ❌ 3/4 return no results
- ✅ 1/4 achieves perfect precision (exact phrase match)
- Issue: Works only when query exactly matches message text

**Temporal Queries (2 cases):**
- ❌ 2/2 return no results
- Issue: Cannot handle temporal phrases like "today" or "last week"
- Root cause: These phrases don't exist in message content

**Multi-hop Queries (2 cases):**
- ❌ 2/2 return no results
- Issue: Cannot connect related messages across conversation
- Root cause: Queries reference entities (e.g., "Sarah") not in exact phrase

**Disambiguation Queries (2 cases):**
- ❌ 2/2 return no results
- Issue: Cannot distinguish between specific and general contexts
- Root cause: Overly restrictive matching prevents any results

---

## Actual System Output Examples

### Example 1: Complete Failure (tech-001)

**Query:** "How do I fix the database connection timeout error?"

**Ground Truth (3 relevant messages):**
```
[msg-001] user:
  I am getting a database connection timeout error when trying to connect to PostgreSQL

[msg-002] assistant:
  Database connection timeouts can occur for several reasons. First, check your
  connection pool settings. Increase the timeout value in your database config
  from the default 30s to 60s or higher.

[msg-004] assistant:
  In your database configuration file, add: connection_timeout = 60000
  (in milliseconds). Also ensure your firewall is not blocking the connection.
```

**Actual System Output:**
```
--- ACTUAL RETRIEVAL (0 results) ---

--- METRICS ---
Precision@5:      0.000 (0 relevant in top 5)
Recall@10:        0.000 (0/3 relevant retrieved)
Context Precision: 0.000
Context Recall:    0.000
MRR:              0.000
```

**Analysis:**
- ❌ System returned ZERO results
- FTS5 query: `"How do I fix the database connection timeout error?"`
- Issue: Looking for exact phrase, but msg-001 says "I am getting a database connection timeout error"
- Word order mismatch: "fix" vs "getting", "How do I" vs "I am"

---

### Example 2: Successful Retrieval (tech-002)

**Query:** "What is the difference between JWT and session-based authentication?"

**Ground Truth (2 relevant messages):**
```
[msg-101] user:
  What is the difference between JWT and session-based authentication?

[msg-102] assistant:
  JWT (JSON Web Tokens) and session-based authentication are two different
  approaches. JWT is stateless - the token contains all user information and
  is stored client-side. Session-based auth is stateful - server maintains
  session data and only sends a session ID to the client.
```

**Actual System Output:**
```
--- ACTUAL RETRIEVAL (1 results) ---

[1] ✓ RELEVANT | Score: 0.2953 | ID: msg-101
    What is the difference between JWT and session-based authentication?
    Scores: BM25: 0.191 | Recency: 1.000

--- METRICS ---
Precision@5:      1.000 (5 relevant in top 5)
Recall@10:        0.500 (1/2 relevant retrieved)
Context Precision: 1.000
Context Recall:    0.500
MRR:              1.000 (first relevant at rank 1)
```

**Analysis:**
- ✅ System found 1 relevant result (msg-101)
- ❌ Missed msg-102 (the actual answer)
- Why it worked: Query is **exact phrase match** with msg-101
- Why partial: Answer message (msg-102) doesn't contain exact query phrase
- This demonstrates the system only works for exact phrase matching

---

### Example 3: Temporal Query Failure (temporal-001)

**Query:** "What did we decide about the authentication approach today?"

**Ground Truth (4 relevant messages):**
```
[msg-301] user:
  Should we use OAuth or build custom authentication?

[msg-302] assistant:
  For this project, I recommend using OAuth 2.0 with Google and GitHub
  providers. It is more secure and saves development time.

[msg-303] user:
  Agreed. Let us go with OAuth. Which library should we use?

[msg-304] assistant:
  Use next-auth for Next.js or passport.js for Express. Both have excellent
  OAuth provider support.
```

**Actual System Output:**
```
--- ACTUAL RETRIEVAL (0 results) ---

--- METRICS ---
Precision@5:      0.000 (0 relevant in top 5)
Recall@10:        0.000 (0/4 relevant retrieved)
Context Precision: 0.000
Context Recall:    0.000
MRR:              0.000
```

**Analysis:**
- ❌ System returned ZERO results
- FTS5 query: `"What did we decide about the authentication approach today?"`
- Issue 1: Word "decide" doesn't appear in any message (they say "recommend", "use")
- Issue 2: Word "today" is temporal metadata, not in content
- Issue 3: Phrase "authentication approach" doesn't match "OAuth", "custom authentication"
- The query needs semantic understanding, not exact phrase matching

---

### Example 4: Multi-hop Query Failure (multi-hop-001)

**Query:** "What was the solution to the bug Sarah reported?"

**Ground Truth (5 relevant messages):**
```
[msg-501] user:
  Sarah reported a bug where user avatars are not loading

[msg-502] assistant:
  Let me help investigate the avatar loading issue Sarah found.

[msg-503] user:
  The images are returning 404 errors

[msg-504] assistant:
  The issue is that the avatar URL path is incorrect. It is pointing to
  /static/avatars/ but should be /public/avatars/. Update the IMAGE_BASE_URL
  environment variable to fix this.

[msg-505] user:
  That fixed it! Thanks.
```

**Actual System Output:**
```
--- ACTUAL RETRIEVAL (0 results) ---

--- METRICS ---
Precision@5:      0.000 (0 relevant in top 5)
Recall@10:        0.000 (0/5 relevant retrieved)
Context Precision: 0.000
Context Recall:    0.000
MRR:              0.000
```

**Analysis:**
- ❌ System returned ZERO results
- FTS5 query: `"What was the solution to the bug Sarah reported?"`
- Issue: This exact phrase doesn't appear in any message
- msg-501 mentions "Sarah reported a bug" but not the full query phrase
- msg-504 contains the solution but doesn't contain "Sarah" or "reported"
- Requires: Multi-hop reasoning to connect Sarah → bug → solution across messages

---

## Root Cause Analysis

### Primary Root Cause: Overly Restrictive Query Processing

**Code Location:** `test/benchmarks/retrieval-evaluation.test.ts:181`

```typescript
// Current implementation (BROKEN)
const fts5Query = `"${testCase.query.replace(/"/g, '""')}"`;
```

**Issue:** Entire user query is wrapped in double quotes, forcing FTS5 to match **exact phrase** only.

**Impact:**
- FTS5 interprets `"How do I fix the database timeout?"` as a single phrase
- Will only match if a message contains that **exact sequence of words**
- Fails for:
  - Paraphrased queries (user says "fix", message says "getting")
  - Temporal queries ("today" is metadata, not content)
  - Multi-hop queries (reference entities across messages)
  - Semantic variations (different words, same meaning)

### Secondary Root Causes

1. **No Query Understanding**
   - System treats query as raw text, not semantic intent
   - No expansion of temporal terms ("today" → time filter)
   - No entity recognition ("Sarah" → person reference)

2. **No Semantic Search**
   - BM25 (keyword matching) only
   - No vector embeddings for semantic similarity
   - Cannot match "authentication approach" with "OAuth"

3. **No Context Awareness**
   - Each message scored independently
   - No conversation thread understanding
   - Cannot connect related messages (e.g., bug report → solution)

4. **No Query Preprocessing**
   - No stopword removal
   - No stemming/lemmatization
   - No query term expansion

---

## Identified Issues

### Critical Issues (P0 - System Non-Functional)

1. **Query Wrapping in Quotes**
   - **Severity:** Critical
   - **Impact:** 90% of queries return zero results
   - **Fix:** Remove quotes, use proper FTS5 query syntax with operators
   - **Effort:** 1 hour

2. **No Temporal Query Support**
   - **Severity:** Critical
   - **Impact:** All temporal queries fail (0% precision/recall)
   - **Fix:** Parse temporal phrases, convert to time filters
   - **Effort:** 4-8 hours

### High Priority Issues (P1)

3. **No Multi-hop Reasoning**
   - **Severity:** High
   - **Impact:** Cannot connect related messages
   - **Fix:** Implement conversation thread awareness
   - **Effort:** 8-16 hours

4. **No Semantic Search**
   - **Severity:** High
   - **Impact:** Requires exact keyword match
   - **Fix:** Add vector embeddings and semantic similarity
   - **Effort:** 16-24 hours

5. **Poor Recall**
   - **Severity:** High
   - **Impact:** Missing 95% of relevant messages
   - **Fix:** Improve query expansion and ranking
   - **Effort:** 8-16 hours

### Medium Priority Issues (P2)

6. **No Query Preprocessing**
   - **Severity:** Medium
   - **Impact:** Sensitive to query phrasing
   - **Fix:** Add stopword removal, stemming, expansion
   - **Effort:** 4-8 hours

7. **No Disambiguation**
   - **Severity:** Medium
   - **Impact:** Cannot distinguish specific vs general contexts
   - **Fix:** Implement context-aware ranking
   - **Effort:** 8-16 hours

---

## Recommendations

### Immediate Actions (Week 1)

1. **Fix Query Processing (P0)**
   - Remove full-query quote wrapping
   - Implement proper FTS5 query builder:
     ```typescript
     // Instead of: "How do I fix the timeout?"
     // Use: timeout AND fix AND database
     // Or: timeout OR fix OR database
     ```
   - Re-run evaluation to establish new baseline

2. **Add Basic Temporal Support (P0)**
   - Parse "today", "yesterday", "last week" from queries
   - Convert to `timeRange` filters in search options
   - Test temporal queries separately

### Short-term Improvements (Month 1)

3. **Implement Query Preprocessing (P1)**
   - Tokenize query into terms
   - Remove stopwords ("what", "is", "the", "how", "do", "I")
   - Apply stemming (Porter stemmer)
   - Generate FTS5 query with operators

4. **Enable Vector Search (P1)**
   - Generate embeddings for all messages
   - Add vector similarity as secondary ranking signal
   - Test hybrid search (BM25 + vector)

5. **Add Conversation Context (P1)**
   - Track message threads and references
   - Boost messages in same conversation
   - Implement "expansion" to include surrounding context

### Medium-term Improvements (Quarter 1)

6. **Semantic Query Understanding**
   - Parse query intent (question, command, reference)
   - Expand query terms with synonyms
   - Entity recognition (names, technical terms)

7. **Advanced Ranking**
   - Learning-to-rank based on relevance feedback
   - Personalization based on user history
   - Diversity boosting for varied results

8. **Evaluation Expansion**
   - Increase test dataset to 50-100 cases
   - Add user feedback collection
   - A/B testing framework

---

## Appendix

### A. Files and Artifacts

**Implementation:**
- `src/core/search.ts` - Search engine implementation
- `src/core/ranking.ts` - Ranking and metrics (6 metric functions)
- `src/core/assembly.ts` - Context assembly strategies

**Evaluation:**
- `test/benchmarks/retrieval-test-dataset.ts` - Test dataset (10 cases, 62 messages)
- `test/benchmarks/retrieval-evaluation.test.ts` - Evaluation harness
- `test/benchmarks/inspect-retrieval.ts` - Detailed inspection tool
- `test/unit/ranking.test.ts` - Metric unit tests (50 tests)

**Results:**
- `test/benchmarks/baselines/retrieval-baseline-2026-03-22.json` - Quantitative results
- `/tmp/retrieval-inspection.txt` - Detailed output with actual examples

**Documentation:**
- `docs/RETRIEVAL_BENCHMARKS.md` - Methodology and results overview
- `docs/SYSTEM_CARD_v0.2.0.md` - This document

### B. Version Information

**System Version:** 0.2.0
**Evaluation Date:** March 23, 2026
**Test Dataset Version:** 1.0
**Metrics Implementation:** 6 metrics (Precision@K, Recall@K, Context Precision/Recall, MRR, NDCG@K, F1@K)

### C. Test Environment

**Platform:** macOS (Darwin 24.5.0)
**Runtime:** Node.js with Vitest
**Database:** SQLite with better-sqlite3
**FTS:** FTS5 with Porter stemmer, unicode61 tokenizer
**Search Mode:** Sparse only (FTS5 BM25), vector disabled

### D. Reproducibility

**Run Evaluation:**
```bash
npm test -- test/benchmarks/retrieval-evaluation.test.ts
```

**Run Detailed Inspection:**
```bash
npx tsx test/benchmarks/inspect-retrieval.ts > detailed-output.txt
```

**View Baseline:**
```bash
cat test/benchmarks/baselines/retrieval-baseline-2026-03-22.json
```

### E. Comparison to Industry

**Target Metrics (from research literature):**
- Precision@5: >0.80 (RAG systems typically achieve 0.75-0.90)
- Recall@10: >0.70 (Good retrieval systems achieve 0.65-0.85)
- Context Precision: >0.75 (RAG-specific, reduces hallucination)
- Context Recall: >0.60 (RAG-specific, ensures completeness)

**Mneme v0.2.0 Performance:**
- **87.5% below target** on Precision@5
- **92.9% below target** on Recall@10
- **Non-functional** for production use

---

## Conclusion

**Summary:** Mneme v0.2.0 context retrieval system is **critically impaired** due to overly restrictive FTS5 query processing. The system achieves only 10% success rate on curated test cases, with 90% of queries returning zero results.

**Primary Issue:** Full-query quote wrapping forces exact phrase matching, which fails for paraphrased, temporal, multi-hop, and disambiguation queries.

**Next Steps:**
1. **Immediate:** Fix query processing (remove full-query quotes)
2. **Short-term:** Add temporal support, query preprocessing, vector search
3. **Medium-term:** Semantic understanding, advanced ranking, evaluation expansion

**Expected Impact of Fixes:**
- Fixing query processing alone should improve success rate from 10% to 60-70%
- Adding vector search should improve Precision@5 from 0.10 to 0.50-0.60
- Full implementation roadmap should achieve targets (P@5 >0.80, R@10 >0.70) within 1-2 months

**Version History:**
- **v0.2.0 (2026-03-23):** Initial evaluation - critical issues identified
- **v0.2.1 (planned):** Query processing fixes
- **v0.3.0 (planned):** Semantic search and temporal support

---

**Document Metadata:**
- **Authors:** Mneme Development Team
- **Reviewers:** Internal evaluation framework
- **Last Updated:** March 23, 2026
- **Next Review:** After v0.2.1 fixes (estimated 1 week)
