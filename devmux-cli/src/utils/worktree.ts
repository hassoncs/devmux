import { execSync } from "node:child_process";

export function detectWorktreeName(): string | null {
  try {
    const gitDir = execSync("git rev-parse --git-dir", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Worktree git-dir format: /path/to/main/.git/worktrees/<worktree-name>
    const worktreeMatch = gitDir.match(/\.git\/worktrees\/([^/]+)/);
    if (worktreeMatch) {
      return worktreeMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

export function sanitizeInstanceId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export function resolveInstanceId(): string {
  const envInstanceId = process.env.DEVMUX_INSTANCE_ID;
  if (envInstanceId) {
    return sanitizeInstanceId(envInstanceId);
  }

  const worktreeName = detectWorktreeName();
  if (worktreeName) {
    return sanitizeInstanceId(worktreeName);
  }

  return "";
}
