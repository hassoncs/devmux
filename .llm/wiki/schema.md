# Wiki Schema — Writing Rules

## Purpose

This file separates **normative rules** (how the system must behave) from **implementation details** (how it currently works). When the code changes, implementation details update but the rules endure.

## Separation of Concerns

### Normative (rules in topic/concept files)

Describes **what the system guarantees** regardless of implementation:

- Health checks are always checked before tmux session existence
- `ensure` must be idempotent
- Session names must be predictable and discoverable
- Port offsets must be deterministic for the same instance ID
- Proxy hostnames must end in `.localhost`

### Implementation (how it works now)

Describes **how the current code achieves** the rules:

- TCP `createConnection()` for port checks
- djb2 hash algorithm for port offsets
- Caddy admin API at `http://localhost:2019`
- `tmux send-keys` for env var injection
- JSONL queue at `~/.devmux/queue.jsonl`

When implementation changes, update the relevant topic file but keep the normative rules intact.

## Article Structure

Each topic file follows:

1. **Purpose** — what this functional area does
2. **Normative Rules** — invariants that must hold
3. **How It Works** — current implementation grounded in source
4. **Key Files** — specific file paths with role descriptions
5. **Edge Cases** — known quirks or failure modes
6. **Source Attribution** — file paths used as reference

Each concept file follows:

1. **Definition** — what this concept means
2. **Why It Matters** — the problem it solves
3. **How It Manifests** — where you see it in the code
4. **Source Attribution** — file paths used as reference

## Grounding Rules

- Every claim about behavior must cite a source file
- Code snippets must include file path attribution
- Never invent behavior not present in the source
- "Should" or "must" statements are normative; "currently" or "as of" statements are implementation
