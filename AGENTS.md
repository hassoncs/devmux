# devmux

tmux-based service manager for monorepos. Prevents human/agent port conflicts by using tmux sessions as a shared service registry with idempotent `ensure` semantics and health-first startup.

## Key Paths

- CLI source: `devmux-cli/src/`
- Core: `devmux-cli/src/core/service.ts` — ensure, status, stop, restart
- Config loader: `devmux-cli/src/config/loader.ts`
- Health checks: `devmux-cli/src/health/checkers.ts`

## Commands

```bash
pnpm install        # Install dependencies
pnpm cli:build      # Build CLI
pnpm cli:dev        # Watch mode
pnpm test           # All tests
pnpm type-check     # TypeScript check
pnpm build          # Build all packages
```

## Config Locations (searched in order)

1. `devmux.config.json`
2. `.devmuxrc.json`
3. `.devmuxrc`
4. `package.json` with `"devmux"` key

## Key Design Rules

- **Health-first, tmux-second**: check port/URL health before checking tmux session existence
- **Idempotent**: `ensure` is safe to call repeatedly — exits immediately if already healthy
- **Cleanup ownership**: `run --with` only stops services we started, never pre-existing ones
- **Predictable naming**: `devmux-{project}[-{instance}]-{service}` so agents and humans share sessions

## Code Style

- TypeScript strict mode — no `as any`, no `@ts-ignore`
- No external dependencies without discussion; keep the footprint small
- Follow existing module structure: config/, core/, health/, tmux/, proxy/, watch/, utils/
- Use [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages (`feat:`, `fix:`, `docs:`, `chore:`, etc.)

## Wiki

This repo has a local wiki at `.llm/wiki/`. Read it before touching code.

**Agent Start Here:**
1. Read `.llm/wiki/CONTEXT.md` — what this repo does, where the important code lives, quick-start task table
2. Use the task table to find the right topic page
3. Read that topic under `.llm/wiki/topics/`
4. Only then open raw source files

**Self-update rule:** If you change architecture, add/remove commands, discover a sharp edge, or fix a non-obvious bug — update the relevant wiki page before closing out. Keep the wiki honest and operational, not decorative.
