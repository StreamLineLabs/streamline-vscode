# Changelog

All notable changes to this project will be documented in this file.
- fix: handle workspace folder detection edge case (2026-02-22)
- test: add unit tests for command palette actions (2026-02-22)
- refactor: extract connection manager from extension host (2026-02-21)
- fix: resolve tree view refresh on topic creation (2026-02-21)
- feat: add syntax highlighting for topic configuration (2026-02-21)
- feat: add search functionality to documentation (2026-02-21)
- test: add snapshot tests for serialization (2026-02-20)
- perf: reduce bundle size with tree-shaking config (2026-02-20)

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Marketplace metadata: galleryBanner, bugs/homepage URLs, expanded keywords
- Configuration settings: `serverAddress`, `httpAddress`, `autoRefresh`, `refreshInterval`, `maxMessages`, `theme`
- Auto-reconnect on connection loss with configurable interval
- TLS support for server connections (CA cert, mutual TLS, insecure mode)
- JSON Schema validation for produced messages (`produceMessageSchema` setting)
- StreamQL syntax highlighting for `.streamql` and `.sql.streamline` files
- Keyboard shortcuts: Ctrl+Shift+S (connect), Ctrl+Shift+R (refresh), Ctrl+Shift+N (new topic)
- `.vscodeignore` for clean marketplace packaging
- Connection status bar tooltip with connection details
- Deprecated `maxMessagesToShow` and `autoRefreshInterval` in favor of `maxMessages` and `refreshInterval`

## [0.2.0] - 2026-02-18

### Added
- 15+ commands for topic and consumer group management
- 4 tree views: Topics, Consumer Groups, Schemas, Connections
- Message viewer panel with filtering
- Connection profile management
- Topic creation and deletion from sidebar
- Message production from editor
- CI pipeline with tests
