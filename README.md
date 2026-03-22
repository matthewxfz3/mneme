# Mneme 🧠

**Unified Context Management Platform for AI Agents**

> *Named after Mneme, the Greek goddess of memory and one of the three original Muses*

Mneme is a standalone context management platform that provides AI agents with intelligent, multi-source context retrieval. Instead of searching one conversation at a time, agents can query across all your knowledge sources—chat history, documents, code repositories, and more.

## ✨ What is Mneme?

Mneme solves the **fragmented context problem** for AI agents:

- 🔍 **Unified Search**: Query across Slack, Google Chat, OpenClaw sessions, documents, RSS feeds
- 🧠 **Semantic Understanding**: Find relevant context even when exact keywords don't match
- ⚡ **Fast Retrieval**: Sub-200ms query latency with hybrid indexing (vector + full-text)
- 🔌 **Agent-Agnostic**: Works with OpenClaw, custom agents, or any LLM application
- 🏗️ **Decoupled Architecture**: Testable, maintainable, extensible

## 🎯 Quick Example

**Without Mneme:**
```
User: "What did Alice say about the API deadline?"
Agent: "I don't have that context." ❌
(Information exists in old Slack thread, not visible to agent)
```

**With Mneme:**
```
User: "What did Alice say about the API deadline?"
Agent: "Alice mentioned in Slack on March 15: 'API shipping target is Friday.'
       Also discussed in Google Chat on March 14." ✅
(Mneme searches all sources, finds relevant context)
```

## 🏛️ Architecture

```
┌──────────────────────────────────────────┐
│         Mneme Core Platform              │
├──────────────────────────────────────────┤
│  Ingest → Store → Index → Retrieve      │
└──────────────────────────────────────────┘
     ▲                              │
     │                              ▼
┌────┴─────┐              ┌─────────────┐
│ Sources  │              │   Clients   │
├──────────┤              ├─────────────┤
│• Google  │              │• OpenClaw   │
│  Chat    │              │• Custom AI  │
│• Slack   │              │• CLI        │
│• Docs    │              │• MCP clients│
│• RSS     │              └─────────────┘
└──────────┘
```

## 📚 Documentation

- [Product Requirements Document (PRD)](docs/prd/mneme-prd.md)
- [High-Level Design (HLD)](docs/design/mneme-hld.md)
- [Technical Design / RFC](docs/rfc/mneme-rfc.md)
- [C4 Architecture Diagrams](docs/diagrams/)
- [OpenClaw Integration Plan](docs/planning/openclaw-integration.md)

## 🚀 Status

**Current Phase**: Design & Planning
**Target MVP**: 4 weeks from kickoff

### Roadmap

- [ ] **Week 1**: Core API + SQLite storage + session importer
- [ ] **Week 2**: Live adapters (Google Chat, Slack)
- [ ] **Week 3**: OpenClaw integration + backward compatibility
- [ ] **Week 4**: Evaluation framework + documentation

## 🤝 Contributing

Mneme is being developed as an open-source project. We welcome contributions!

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines (coming soon).

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Inspired by [Andrew Ng's Context Hub](https://github.com/andrewyng/context-hub)
- Designed for [OpenClaw](https://github.com/openclaw/openclaw) but works with any agent
- Built on proven technologies: SQLite, sqlite-vec, MCP

---

**Questions?** Open an issue or check the [documentation](docs/).
