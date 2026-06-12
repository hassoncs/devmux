# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.10.0] - initial public development

Initial public release. Covers all development through v1.10.0, including:

- tmux-based service management with idempotent `ensure` semantics
- Health-first startup (port/HTTP checks before tmux session inspection)
- Session naming convention: `devmux-{project}[-{instance}]-{service}`
- Git worktree isolation with deterministic port offsets
- Error watching via `tmux pipe-pane` with pattern sets and JSONL queue
- Portless proxy: named `*.localhost` URLs via Caddy on port 80
- Auto-discovery from `turbo.json`
- Web dashboard for service status
- Telemetry client/server packages
- Cloudflare Pages landing site

[Unreleased]: https://github.com/hassoncs/devmux/compare/v1.10.0...main
[1.10.0]: https://github.com/hassoncs/devmux/releases/tag/v1.10.0
