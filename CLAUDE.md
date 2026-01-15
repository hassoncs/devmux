# CLAUDE.md

This file provides guidance to AI assistants when working with this codebase.

## Project Overview

**Devmux** - tmux-based service management for monorepos. Shared awareness between humans and AI agents—both can see and reuse running dev servers.

- **Main CLI:** `@chriscode/devmux` (TypeScript, tsup)
- **Landing Page:** Astro site (Cloudflare Pages)
- **Version:** 1.0.0

## Commands

### Development

```bash
pnpm install              # Install dependencies
pnpm build                # Build all packages
pnpm test                 # Run all tests (if available)
pnpm dev                  # Development mode
pnpm type-check           # TypeScript checking
```

### CLI Package

```bash
pnpm cli:build            # Build CLI only
pnpm cli:dev              # Watch mode for CLI
```

### Landing Page

```bash
pnpm landing:dev          # Landing page dev server
pnpm landing:build        # Build landing page
pnpm landing:deploy       # Deploy to Cloudflare Pages
```

### Release

```bash
./scripts/release.sh              # Interactive release
./scripts/release.sh --version 1.0.1  # Specify version
./scripts/changelog.sh 1.0.1          # Generate changelog
```

## Architecture

### Source Code Structure

```
devmux-cli/src/
├── bin/              # CLI entry point (devmux.js)
├── commands/         # CLI commands (ensure, status, stop, attach, run, etc.)
├── lib/              # Core logic (tmux, health checks, config)
├── config/           # Configuration loading
└── types.ts          # TypeScript types
```

### Key Concepts

- **Health-first, tmux-second** - Checks if service is actually healthy, not just if tmux session exists
- **Session naming convention** - `{prefix}-{project}-{service}` (e.g., `omo-myapp-api`)
- **Cleanup tracking** - Only stops services "we started" on Ctrl+C
- **Idempotent operations** - `devmux ensure` is safe to call multiple times

## Release Procedures

### Version Bumping

When releasing a new version:

1. **Determine version bump type:**
   - `patch` → Bug fixes, small changes (1.0.0 → 1.0.1)
   - `minor` → New features, backwards compatible (1.0.0 → 1.1.0)
   - `major` → Breaking changes (1.0.0 → 2.0.0)

2. **Run the release script:**
   ```bash
   ./scripts/release.sh --version 1.0.1
   ```

   This will:
   - Build all packages
   - Run tests (if available)
   - Generate changelog
   - Prompt for npm OTP
   - Deploy in parallel: npm publish + Cloudflare Pages

3. **Manual version bump (if needed):**
   ```bash
   jq '.version = "1.0.1"' devmux-cli/package.json > tmp.json && mv tmp.json devmux-cli/package.json
   git add devmux-cli/package.json
   git commit -m "chore: bump version to 1.0.1"
   ```

### Commit Message Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Type | Description | Changelog Section |
|------|-------------|-------------------|
| `feat` | New feature | Added |
| `fix` | Bug fix | Fixed |
| `docs` | Documentation | Documentation |
| `style` | Formatting | Internal |
| `refactor` | Code restructuring | Changed |
| `test` | Tests | Tests |
| `chore` | Maintenance | Internal |

Examples:
```
feat(cli): add new command devmux attach
fix(tmux): resolve session detection issue
docs(readme): update installation instructions
```

### Before Creating a Release

1. ✅ All tests pass: `pnpm test`
2. ✅ Build succeeds: `pnpm build`
3. ✅ Changelog generated and reviewed
4. ✅ Version in package.json matches intended release
5. ✅ No TODO comments in code
6. ✅ README updated if API changed

### Release Checklist

- [ ] Version bumped in `devmux-cli/package.json`
- [ ] Changelog generated: `./scripts/changelog.sh X.Y.Z`
- [ ] All tests passing
- [ ] Build succeeds
- [ ] Commit with message: `chore(release): X.Y.Z`
- [ ] Tag created: `git tag vX.Y.Z`
- [ ] npm publish successful
- [ ] Landing page deployed to Cloudflare Pages
- [ ] GitHub release created

## Testing

### Running Tests

```bash
pnpm test                  # All tests
pnpm cli:test              # CLI tests only
```

## Configuration

### Key Files

| File | Purpose |
|------|---------|
| `devmux-cli/package.json` | CLI package config, version |
| `devmux-cli/tsconfig.json` | TypeScript config |
| `landing/astro.config.mjs` | Landing page (Astro) config |
| `landing/wrangler.toml` | Cloudflare Pages config |
| `tsconfig.base.json` | Shared TypeScript config |

### Environment Variables

None required for local development. tmux must be installed for full functionality.

```bash
brew install tmux
```

## Claude Code Skill

Similar skill structure to hush - supports AI agents in managing dev services safely.

## Troubleshooting

### Common Issues

**"tmux is not installed"**
```bash
brew install tmux
```

**"Session not found"**
- Check tmux is running: `tmux ls`
- Verify session naming: `omo-{project}-{service}`
- Check config file: `devmux.config.json`

**"Port not responding"**
- Verify service is actually running on the expected port
- Check health check configuration in `devmux.config.json`

### Debug Mode

```bash
devmux status --json     # Machine-readable output for debugging
```

## Notes for AI Assistants

- Always check `devmux status` before starting services
- Use `devmux ensure <service>` instead of starting manually (idempotent)
- Session names follow pattern `omo-{project}-{service}`
- Don't kill services you didn't start - let cleanup tracking handle it
- For this codebase: TypeScript with strict mode, uses tsup for bundling
- Follow conventional commit messages for changelog auto-generation
