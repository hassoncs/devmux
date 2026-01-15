# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release

### Changed
- Initial project setup

## [1.0.0] - 2026-01-15

### Added
- tmux-based service management for monorepos
- `devmux ensure` command - idempotent service startup
- `devmux status` command - show running services with health checks
- `devmux stop` command - stop services gracefully
- `devmux attach` command - attach to tmux session for logs
- `devmux run` command - run commands with services, auto-cleanup on Ctrl+C
- `devmux discover turbo` - auto-discover from turbo.json
- `devmux init` - generate config template
- Health-first checking (port/URL verification)
- Session naming convention: `omo-{project}-{service}`
- Cleanup tracking (only stop services "we started")
- Support for multiple services in parallel
- Cloudflare Pages deployment for landing page

### Changed
- Improved session naming to match OpenCode conventions

### Documentation
- Comprehensive getting started guide
- Configuration documentation
- AI integration documentation
- CLI reference

### Internal
- Monorepo structure with pnpm workspaces
- TypeScript with tsup bundler
- Clean separation of concerns (commands, lib, config)

[Unreleased]: https://github.com/hassoncs/devmux/compare/v1.0.0...main
[1.0.0]: https://github.com/hassoncs/devmux/releases/tag/v1.0.0
