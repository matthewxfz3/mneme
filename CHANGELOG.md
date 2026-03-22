# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-22

### Added
- **Database Manager** - Multi-user database management with connection pooling
  - User-scoped SQLite databases (one per user) for perfect data isolation
  - LRU-based connection pooling with configurable limits
  - Automatic idle connection cleanup with configurable timeout
- **Resource Management & Monitoring**
  - Adaptive connection pooling - dynamically adjusts max connections based on available memory
  - File descriptor monitoring with configurable warning thresholds
  - Automatic vacuum on idle connections to reclaim disk space
  - Comprehensive resource metrics (memory, file descriptors, disk usage)
  - Performance metrics (cache hit rate, evictions, vacuum operations)
  - Health scoring system (0-100) with status levels (healthy/degraded/critical)
- **Documentation**
  - Complete resource management guide (`docs/RESOURCE_MANAGEMENT.md`)
  - Multi-user support documentation (`docs/MULTI_USER_SUPPORT.md`)
  - Implementation summary with benchmarks and scaling characteristics
  - Working examples for basic multi-user usage and resource monitoring
- **Testing**
  - Comprehensive test suite with 25 tests covering all database manager features
  - Tests for connection pooling, resource monitoring, adaptive pooling, and auto-vacuum

### Changed
- None

### Fixed
- None

### Removed
- None

## [0.1.0] - Initial Release
