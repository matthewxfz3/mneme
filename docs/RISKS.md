# Mneme Project Risks & Mitigations

**Last Updated**: March 2026
**Status**: M1 Complete, assessing before M2

---

## Executive Summary

**Overall Risk Level**: 🟡 **MEDIUM**

- ✅ **Low Risk**: M1 implementation (proven tech, completed)
- 🟡 **Medium Risk**: OpenClaw integration, adoption, search quality
- 🔴 **High Risk**: M2/M3 scope creep, long-term maintenance

**Recommendation**: Proceed with controlled OpenClaw integration pilot. Prove M1 value before committing to M2.

---

## Category 1: Technical Risks

### 🔴 HIGH: SQLite Performance at Scale

**Risk**: SQLite may not handle very large datasets (1M+ messages, multi-GB files)

**Evidence**:
- M1 tested at 100K messages (~100MB) ✅
- Unknown performance at 1M+ messages
- SQLite file locking issues on network drives
- FTS5 index rebuild can block writes

**Impact**:
- Slow queries (>200ms) for large datasets
- Long startup times
- Database corruption on network filesystems

**Mitigation**:
```
✅ Implemented:
- WAL mode (concurrent reads during writes)
- Batch operations (reduce lock contention)
- Lazy index updates (async where possible)

🔲 Planned:
- Benchmark at 500K, 1M, 5M messages
- Auto-archival of old conversations
- Add PostgreSQL adapter (M3)
- Document max recommended dataset size
```

**Likelihood**: Medium (users may accumulate 1M+ messages over time)
**Severity**: High (poor UX if queries slow down)
**Risk Score**: 🔴 **HIGH** (6/9)

---

### 🟡 MEDIUM: Token Counting Accuracy Dependencies

**Risk**: Depends on `tiktoken` library which may lag behind new models

**Evidence**:
- Currently supports: GPT-4, Claude (via approximation), Gemini (approx)
- New models (GPT-5, Claude Opus 5) may have different tokenizers
- tiktoken is maintained by OpenAI (not Anthropic)

**Impact**:
- Inaccurate token counts for new models → context overflows
- Need to update tokenizer mappings for each new model
- Approximations for non-OpenAI models may drift

**Mitigation**:
```
✅ Implemented:
- Model family detection (claude, gpt, gemini, llama)
- Fallback to character/4 heuristic if tokenizer unavailable
- Cache invalidation when model family changes

🔲 Planned:
- Monitor new model releases
- Add Anthropic official tokenizer when available
- Document accuracy per model family
- Add configurable tokenizer plugins
```

**Likelihood**: Medium (new models release quarterly)
**Severity**: Medium (degraded accuracy, not complete failure)
**Risk Score**: 🟡 **MEDIUM** (4/9)

---

### 🟡 MEDIUM: Search Quality May Not Meet Expectations

**Risk**: FTS5 sparse search without vectors may miss semantic matches

**Example**:
```
Query: "database connection issues"
FTS5 finds: "database connection" (keyword match) ✅
FTS5 misses: "DB pool exhausted" (semantic match) ❌

With vectors:
Query: "database connection issues"
Vector finds: "DB pool exhausted" (cosine similarity 0.85) ✅
```

**Impact**:
- Users expect "Google-quality" semantic search
- FTS5 only does keyword matching (no synonyms, no semantics)
- May frustrate users coming from vector-only systems

**Mitigation**:
```
✅ Implemented:
- Hybrid ranking (FTS5 + temporal decay)
- Query expansion possible (add synonyms)
- RRF merging for multi-strategy search

🔲 Planned (M2):
- Add sqlite-vec for dense vector search
- Benchmark FTS5-only vs Hybrid on real queries
- Document when vectors help vs don't help
- User feedback loop on search quality
```

**Likelihood**: Medium (semantic search is expected)
**Severity**: Medium (degrades UX, not blocking)
**Risk Score**: 🟡 **MEDIUM** (4/9)

---

### 🟢 LOW: Data Loss During Migration

**Risk**: Importing existing OpenClaw sessions could fail or corrupt data

**Impact**:
- Users lose conversation history
- Corrupted database unrecoverable
- Trust in Mneme damaged

**Mitigation**:
```
✅ Implemented:
- JSONL import is non-destructive (keeps original files)
- Transaction rollback on errors
- Validation step after import
- Import progress callbacks for debugging

✅ Best Practices:
- Always backup before migration
- Test import on copy first
- Dual-write period (both systems)
- Verification queries after import
```

**Likelihood**: Low (robust import, tested with fixtures)
**Severity**: High (data loss is catastrophic)
**Risk Score**: 🟢 **LOW** (3/9)

---

## Category 2: Integration Risks

### 🟡 MEDIUM: OpenClaw Integration Complexity

**Risk**: Integrating Mneme into OpenClaw may require extensive refactoring

**Evidence**:
- OpenClaw's context code spread across 900K+ LOC
- Tight coupling to existing `MemoryIndexManager`
- 10+ channel-specific implementations
- Unknown edge cases in production usage

**Impact**:
- Integration takes longer than expected (>4 weeks)
- Breaking changes to OpenClaw internals
- Regression bugs in existing features
- User complaints during transition

**Mitigation**:
```
✅ Designed:
- ContextEngine interface for clean integration
- Backward-compatible shim layer
- Feature flag for gradual rollout

🔲 Integration Plan:
1. Week 1-2: Shadow mode (run both, compare)
2. Week 3-4: Opt-in beta (flag-gated)
3. Week 5-6: Default enabled (with escape hatch)
4. Week 7-8: Deprecate old system

✅ Risk Reduction:
- Comprehensive integration tests
- Canary deployments (1% → 10% → 50% → 100%)
- Quick rollback mechanism
- Monitor error rates closely
```

**Likelihood**: Medium (integration always harder than expected)
**Severity**: Medium (delays, not blockers)
**Risk Score**: 🟡 **MEDIUM** (4/9)

---

### 🟢 LOW: Breaking API Changes

**Risk**: Future Mneme updates break OpenClaw integration

**Impact**:
- OpenClaw stuck on old Mneme version
- Security/bug fixes require code changes
- Maintenance burden increases

**Mitigation**:
```
✅ Implemented:
- Semantic versioning (MAJOR.MINOR.PATCH)
- ContextEngine interface is stable
- Extensive type definitions (TypeScript)

🔲 Policy:
- No breaking changes in MINOR/PATCH versions
- Deprecation warnings before MAJOR bumps
- Maintain compatibility shims for 1 major version
- Document migration guides for breaking changes
```

**Likelihood**: Low (stable API design)
**Severity**: Medium (migration overhead)
**Risk Score**: 🟢 **LOW** (2/9)

---

## Category 3: Adoption Risks

### 🔴 HIGH: Users May Not Migrate

**Risk**: OpenClaw users resist migrating to Mneme, stay on legacy system

**Reasons**:
- "If it ain't broke, don't fix it" mentality
- Fear of data loss during migration
- Learning curve for new CLI/API
- Skepticism about benefits

**Impact**:
- Dual maintenance burden (legacy + Mneme)
- Fragmented ecosystem
- Wasted development effort
- M2/M3 delayed or cancelled

**Mitigation**:
```
✅ Value Proposition:
- Demonstrate clear benefits (cross-session search)
- Show before/after comparisons
- Highlight pain points Mneme solves

🔲 Adoption Strategy:
1. Pilot with 5-10 power users
2. Gather feedback and iterate
3. Create migration success stories
4. Provide migration support (scripts, docs)
5. Make migration reversible (keep old data)

🔲 Communication:
- Blog post: "Why We Built Mneme"
- Video tutorial: Migration walkthrough
- Discord AMA: Answer questions live
- Case study: "How Mneme Saved Me 2 Hours/Week"
```

**Likelihood**: High (change is hard)
**Severity**: High (project success depends on adoption)
**Risk Score**: 🔴 **HIGH** (9/9)

---

### 🟡 MEDIUM: Learning Curve

**Risk**: Users struggle with new concepts (assemblies, strategies, token budgets)

**Evidence**:
- Current OpenClaw: Simple JSONL append
- Mneme: Multiple strategies, hybrid search, token budgets
- New CLI commands (8 commands vs 0)

**Impact**:
- Slower adoption
- Support burden (answering questions)
- Frustration if concepts aren't clear

**Mitigation**:
```
✅ Documentation:
- Clear README with examples
- MNEME_FOR_OPENCLAW.md explainer
- API documentation with use cases

🔲 Planned:
- Interactive tutorial (first-run wizard)
- Video walkthroughs (YouTube)
- Sensible defaults (hybrid strategy, auto token budgets)
- Error messages with helpful hints

🔲 Support:
- Discord channel for questions
- FAQ document (common issues)
- Quick start guide (5 minutes to value)
```

**Likelihood**: Medium (new concepts always have learning curve)
**Severity**: Medium (slows adoption, not blocking)
**Risk Score**: 🟡 **MEDIUM** (4/9)

---

## Category 4: Project Risks

### 🔴 HIGH: M2/M3 Scope Creep

**Risk**: Attempting M2/M3 before proving M1 value leads to over-engineering

**Evidence**:
- Original v1 PRD was ambitious (multi-source, multi-tenant, webhooks)
- M1 deliberately scoped down to prove value
- Temptation to add features before validating core

**Impact**:
- Resources spread thin
- M1 quality suffers
- Never ship anything useful
- Classic second-system syndrome

**Mitigation**:
```
✅ Already Done:
- Phased roadmap (M1 → M2 → M3)
- M1 scoped to OpenClaw only
- Clear success criteria before M2

🔲 Gates Before Next Milestone:
M1 → M2 Gate:
  ☐ 50% OpenClaw adoption
  ☐ Search quality >80% precision
  ☐ <5 critical bugs per month
  ☐ Positive user feedback (>4/5 rating)

M2 → M3 Gate:
  ☐ 5+ source adapters working
  ☐ Community demand for multi-tenant
  ☐ Enterprise customer interest
  ☐ M2 proven stable for 3 months

🔲 Policy:
- Don't start M2 until M1 proven
- Don't start M3 until M2 proven
- Be willing to stop at M1 if sufficient
```

**Likelihood**: High (feature creep is common)
**Severity**: High (can kill project)
**Risk Score**: 🔴 **HIGH** (9/9)

---

### 🟡 MEDIUM: Long-Term Maintenance Burden

**Risk**: Mneme becomes another system to maintain, adding to OpenClaw's complexity

**Evidence**:
- OpenClaw already has large surface area
- Adding Mneme = more code, more bugs, more support
- If main contributors move on, who maintains Mneme?

**Impact**:
- Technical debt accumulates
- Security vulnerabilities unpatched
- Users stuck on old versions
- Project abandoned

**Mitigation**:
```
✅ Code Quality:
- 75%+ test coverage
- TypeScript for type safety
- Clear architecture (easy to understand)
- Documentation for contributors

🔲 Sustainability Plan:
- Contributor guide (CONTRIBUTING.md)
- Good first issue labels
- Code review process
- Automated CI/CD (tests, linting)
- Security dependency scanning

🔲 Bus Factor:
- Cross-train multiple maintainers
- Document architectural decisions
- Modular design (easy to swap components)
- Consider: Donate to foundation if needed
```

**Likelihood**: Medium (maintenance is inevitable)
**Severity**: Medium (manageable if prepared)
**Risk Score**: 🟡 **MEDIUM** (4/9)

---

### 🟢 LOW: Competitive Risk

**Risk**: Someone builds a better context management solution

**Evidence**:
- Active research in RAG, context compression, retrieval
- Commercial solutions (Pinecone, Weaviate) improving
- OpenAI, Anthropic may solve this natively

**Impact**:
- Mneme becomes obsolete
- Wasted effort
- Users migrate to better solution

**Mitigation**:
```
✅ Advantages:
- Local-first (privacy, speed)
- Open source (no vendor lock-in)
- Integrated with OpenClaw (tight coupling)
- Free (no API costs)

🔲 Stay Competitive:
- Monitor research (ablation study up-to-date)
- Quick to adopt new techniques
- Modular (swap in better components)
- Community-driven (responsive to needs)

🔴 Accept Reality:
- If LLMs get 10M token windows, Mneme less needed
- If native solutions emerge, be willing to deprecate
- Focus on solving real problems today
```

**Likelihood**: Low (niche is local-first + OpenClaw)
**Severity**: Low (can adapt or deprecate gracefully)
**Risk Score**: 🟢 **LOW** (1/9)

---

## Category 5: Quality Risks

### 🟡 MEDIUM: Vector Search Not Yet Implemented

**Risk**: M1 ships without vector search, users expect it

**Status**:
- Infrastructure ready (schema has vector table)
- sqlite-vec integration not implemented
- FTS5-only may be sufficient, unknown

**Impact**:
- Missing semantic search capabilities
- Users disappointed by keyword-only search
- Competitive disadvantage vs vector-first systems

**Mitigation**:
```
✅ Current State:
- FTS5 works well for keyword search
- Temporal ranking helps (recent = relevant)
- Hybrid infrastructure ready (can add vectors later)

🔲 Decision Tree:
IF search quality feedback is good (>80% precision):
  → Delay vectors to M2 ✅
ELSE:
  → Prioritize vector search in M1.1 🔴

🔲 M2 Plan:
- sqlite-vec extension integration
- Embedding provider abstraction (OpenAI, local)
- Async embedding generation
- Benchmark FTS5 vs Hybrid
```

**Likelihood**: Medium (users expect semantic search)
**Severity**: Medium (degrades perception, not blocking)
**Risk Score**: 🟡 **MEDIUM** (4/9)

---

### 🟢 LOW: Compaction Strategies Not Implemented

**Risk**: Only audit trail exists, no actual smart compaction

**Status**:
- `recordCompaction()` works (audit trail)
- No compaction algorithms implemented yet
- Users must implement their own logic

**Impact**:
- Mneme doesn't solve full problem
- Users still need to write compaction code
- Value proposition slightly weaker

**Mitigation**:
```
✅ Current:
- Audit trail is valuable (know what was dropped)
- OpenClaw already has compaction logic
- Can copy existing approach initially

🔲 Future (M1.1 or M2):
- Implement 3-5 compaction strategies:
  1. LRU (least recently used)
  2. Importance-based (keep tool calls, drop chitchat)
  3. Summary-based (replace N messages with 1 summary)
  4. Sliding-window (keep last N)
  5. Custom (user-provided function)

🔲 Research:
- Benchmark strategies on real data
- User feedback on which strategies help
```

**Likelihood**: Low (audit trail already useful)
**Severity**: Low (nice-to-have, not critical)
**Risk Score**: 🟢 **LOW** (1/9)

---

## Risk Matrix

### By Category

| Category | High Risk | Medium Risk | Low Risk |
|----------|-----------|-------------|----------|
| **Technical** | SQLite scale (6/9) | Token accuracy (4/9)<br/>Search quality (4/9) | Data loss (3/9) |
| **Integration** | - | OpenClaw complexity (4/9) | Breaking changes (2/9) |
| **Adoption** | User resistance (9/9) | Learning curve (4/9) | - |
| **Project** | Scope creep (9/9) | Maintenance burden (4/9) | Competition (1/9) |
| **Quality** | - | No vectors (4/9) | No compaction (1/9) |

### Top Risks (Risk Score ≥ 6)

| Rank | Risk | Score | Priority |
|------|------|-------|----------|
| 1 | 🔴 User adoption resistance | 9/9 | **CRITICAL** |
| 2 | 🔴 M2/M3 scope creep | 9/9 | **CRITICAL** |
| 3 | 🔴 SQLite performance at scale | 6/9 | **HIGH** |

---

## Mitigation Priority

### 🔥 Immediate (Before OpenClaw Integration)

1. **Pilot Program** (Address: User adoption resistance)
   - Recruit 5-10 beta users
   - 1-on-1 migration support
   - Gather feedback, iterate

2. **Performance Benchmarks** (Address: SQLite scale)
   - Test at 500K, 1M messages
   - Document performance characteristics
   - Set max recommended dataset size

3. **Rollback Plan** (Address: Integration complexity)
   - Document how to revert to legacy system
   - Test rollback procedure
   - Keep old code path functional

### 📅 Short-Term (M1 Integration Phase)

4. **Search Quality Evaluation** (Address: Search quality)
   - Build evaluation dataset (100 queries)
   - Measure precision/recall
   - Compare to legacy system

5. **Documentation Blitz** (Address: Learning curve)
   - Video walkthrough
   - Interactive tutorial
   - FAQ document

6. **Gate Enforcement** (Address: Scope creep)
   - Define M1→M2 gate criteria
   - Regular check-ins on scope
   - Say "no" to feature requests until M1 proven

### 🔮 Long-Term (Post-M1)

7. **Sustainability Plan** (Address: Maintenance burden)
   - Cross-train maintainers
   - Contributor guide
   - Automated testing/releases

8. **Vector Search Decision** (Address: No vectors)
   - IF search quality <80%: Prioritize vectors
   - ELSE: Defer to M2

---

## Risk Acceptance

### Risks We Accept

**Local-Only (M1)**: Accept that single-process SQLite doesn't scale to enterprise multi-tenant
- **Why**: M1 scope is intentionally local-first
- **Plan**: M3 addresses if needed

**No Real-Time Sync**: Accept that M1 doesn't sync across devices
- **Why**: Out of scope for local-first
- **Plan**: M3 cloud option if demanded

**Model Tokenizer Lag**: Accept that new models may have token count drift
- **Why**: Can't predict future, fallback exists
- **Plan**: Update as models release

**Community Adoption Uncertainty**: Accept that users may not migrate
- **Why**: Can't force adoption
- **Plan**: Make it so good they want to

---

## Success Criteria (Risk Indicators)

### M1 Success = Low Risk to Proceed

✅ **Adoption**: 30%+ OpenClaw users migrated within 3 months
✅ **Quality**: Search precision >75% on eval dataset
✅ **Performance**: p95 query latency <200ms at 100K messages
✅ **Stability**: <5 critical bugs per month after 1 month
✅ **Feedback**: >4.0/5 user satisfaction rating

### M1 Failure = High Risk to Proceed

❌ **Adoption**: <10% users migrated after 6 months
❌ **Quality**: Search precision <50%
❌ **Performance**: p95 >500ms or frequent crashes
❌ **Stability**: >20 critical bugs per month
❌ **Feedback**: <3.0/5 user satisfaction

**If M1 fails**: Deprecate Mneme, return to legacy system, learn lessons

---

## Recommendation

### Proceed with Controlled Rollout

1. ✅ **M1 is technically sound** (low technical risk)
2. ⚠️ **Adoption is uncertain** (high adoption risk)
3. ⚠️ **Scope must be controlled** (high scope creep risk)

**Strategy**:
- **DO**: Pilot with 5-10 users, gather feedback, iterate
- **DO**: Measure search quality, performance, satisfaction
- **DO**: Enforce M1→M2 gate criteria strictly
- **DON'T**: Promise M2/M3 timeline until M1 proven
- **DON'T**: Add features until core is validated
- **DON'T**: Force migration on all users immediately

**Next Steps**:
1. Recruit pilot users (1 week)
2. Migration support (2 weeks)
3. Gather feedback (4 weeks)
4. Decision point: Proceed to broader rollout OR iterate OR deprecate

---

**Document Owner**: Product & Engineering
**Review Frequency**: Monthly during M1 rollout, quarterly after
**Last Risk Assessment**: March 2026
