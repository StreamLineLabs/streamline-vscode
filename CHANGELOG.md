# Changelog

All notable changes to this project will be documented in this file.
- feat: add syntax highlighting for StreamQL queries

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-02-28
- **Changed**: update webpack bundler configuration
- **Documentation**: add feature walkthrough for new users
- **Fixed**: correct keybinding conflict with core shortcuts
- **Added**: implement code completion for topic names
- **Changed**: update extension icon and marketplace banner
- **Testing**: add unit tests for configuration parser
- **Fixed**: handle disconnection in status bar indicator
- **Added**: add topic browser tree view
- **Changed**: update VS Code engine compatibility
- **Changed**: simplify command registration logic
- **Fixed**: resolve extension activation on workspace open
- **Added**: add syntax highlighting for StreamQL queries

### Added
- Syntax highlighting for topic configuration
- Search functionality for documentation

### Fixed
- Handle workspace folder detection edge case
- Resolve tree view refresh on topic creation

### Changed
- Update VS Code engine version constraint
- Extract connection manager from extension host

### Performance
- Reduce bundle size with tree-shaking config

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
