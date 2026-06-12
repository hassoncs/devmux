# Contributing to DevMux

Thank you for your interest in contributing.

## Dev Setup

**Prerequisites:** Node.js >=18, pnpm, tmux

```bash
# Install tmux (macOS)
brew install tmux

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type-check
pnpm type-check
```

For iterative CLI development:

```bash
pnpm cli:dev   # watch mode — rebuilds on change
```

## Commit Messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). **Every merge to `main` may trigger an automated npm release**, so commit message format directly controls the published version.

| Type | Description | Version bump |
|------|-------------|--------------|
| `feat` | New feature | minor |
| `fix` | Bug fix | patch |
| `docs` | Documentation only | patch |
| `refactor` | Code restructuring, no behavior change | patch |
| `test` | Test changes | patch |
| `chore` | Maintenance, tooling | patch |
| `ci` | CI/CD changes | patch |
| any type with `!` | Breaking change | major |

Examples:

```
feat(cli): add devmux attach command
fix(health): handle unreachable ports without timeout hang
feat(proxy)!: remove support for legacy proxy config format

BREAKING CHANGE: The `proxy.port` field is no longer supported.
```

Commits that do not follow the conventional format will not trigger a release but are otherwise accepted.

## Pull Requests

- Open a PR against `main`.
- Include tests for any behavior change. The test suite uses [Vitest](https://vitest.dev/).
- Do not use `as any`, `@ts-ignore`, or `@ts-expect-error` — PRs with these will be asked to revise.
- Keep changes focused. Large refactors separate from feature/fix PRs are easier to review.
- CI must pass before merge (build, tests, type-check).

## Automated Releases

Merging to `main` runs CI which:
1. Builds and tests the packages
2. Analyzes commits since the last npm release
3. Bumps the version, publishes to npm, and creates a GitHub Release automatically

You do not need to bump versions or publish manually.
