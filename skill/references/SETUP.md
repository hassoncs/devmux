# How to Set Up DevMux

> **Guide for AI Agents & Humans**: The proper way to configure a repository for DevMux.

## 1. Goal
We want **every** persistent task (servers, watchers) to be managed by DevMux.
*   ✅ `pnpm dev` -> `devmux ensure web`
*   ✅ `pnpm ios` -> `devmux ensure ios`
*   ❌ `pnpm dev` -> `next dev` (Foreground process that blocks the agent)

## 2. Configuration (`devmux.config.json`)

Use the discovery tool to bootstrap:
```bash
devmux discover turbo > devmux.config.json
```

Then edit it to ensure:
1.  **Health Checks**: Every service needs a port or HTTP check.
2.  **Dependencies**: Use `dependsOn` to enforce startup order.

Example:
```json
{
  "services": {
    "api": {
      "command": "pnpm start:api",
      "health": { "type": "port", "port": 3000 }
    },
    "web": {
      "command": "pnpm start:web",
      "dependsOn": ["api"],
      "health": { "type": "port", "port": 8080 }
    }
  }
}
```

## 3. Package.json Scripts (The "DevMux Everywhere" Pattern)

Update your root `package.json` so that standard commands use DevMux. This ensures both humans and agents use the safe path.

**Before:**
```json
"scripts": {
  "dev": "turbo dev",
  "api": "cd api && pnpm dev"
}
```

**After (Recommended):**
```json
"scripts": {
  "svc:status": "devmux status",
  "svc:stop": "devmux stop all",
  
  "dev": "devmux ensure web",
  "dev:api": "devmux ensure api",
  
  "// Note": "Use devmux run for one-off commands that need services",
  "test:e2e": "devmux run --with web -- pnpm playwright test"
}
```

## 4. Verification

1.  Run `pnpm dev` (or equivalent).
2.  It should start services in tmux.
3.  Run `devmux status` to confirm.
4.  Ctrl+C should stop them (if running in foreground wrapper) or leave them (if using ensure).

## 5. Agent Instructions

Ensure the project has an `AGENTS.md` (or similar) that tells the agent to use `devmux`. You can generate the latest instructions via:
```bash
devmux skill
```
