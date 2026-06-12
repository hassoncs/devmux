# Security Policy

## Supported Versions

Only the latest minor release of `@chriscode/devmux` receives security fixes.

| Version | Supported |
|---------|-----------|
| Latest minor | Yes |
| Older minors | No — please upgrade |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/hassoncs/devmux/security/advisories/new).

We aim to acknowledge reports within **7 days** and will keep you updated on triage and fix progress.

## Scope

The following are in scope and treated as security-relevant:

### Command injection
DevMux executes commands defined in `devmux.config.json`. Vulnerabilities that allow a malicious config, environment variable, or service name to inject unintended shell commands are in scope.

### Secret exposure via the watch queue
The error-watching feature captures service log output (including context lines) and writes it to `~/.devmux/queue.jsonl`. Vulnerabilities that cause secrets (tokens, passwords, keys) present in log output to be persisted in an unintended location, sent over the network, or exposed to other processes are in scope.

### Network exposure of local servers
DevMux optionally starts local servers (telemetry server, portless proxy/Caddy LaunchDaemon, dashboard). Vulnerabilities that allow remote or unintended local network access to these servers — particularly unauthenticated access to log data or service control — are in scope.

### Root LaunchDaemon privilege escalation
The portless proxy feature installs a LaunchDaemon running as root. Vulnerabilities that allow unprivileged processes to escalate privileges through this daemon are in scope.

## Out of Scope

- Issues in `devmux.config.json` content that the user authored themselves (you control what commands run)
- Bugs in tmux itself
- General npm supply-chain risks unrelated to devmux's own code
