import { createHash } from "node:crypto";
import { chmodSync, chownSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execa } from "execa";

export const DEVMUX_CADDY_LABEL = "dev.devmux.caddy";
export const DEFAULT_CADDY_ADMIN_URL = "http://localhost:2019";
export const DEFAULT_CADDYFILE_PATH = "/usr/local/etc/caddy/Caddyfile";
export const DEFAULT_LAUNCHD_PLIST_PATH =
  "/Library/LaunchDaemons/dev.devmux.caddy.plist";
export const DEFAULT_CADDY_LOG_PATH = "/var/log/devmux-caddy.log";
export const DEFAULT_CADDY_ERR_PATH = "/var/log/devmux-caddy.err";
/** Root-owned directory where devmux copies the caddy binary to prevent Homebrew priv-esc. */
export const DEVMUX_CADDY_LIBEXEC_DIR = "/usr/local/libexec/devmux";
export const DEVMUX_CADDY_INSTALLED_BIN =
  `${DEVMUX_CADDY_LIBEXEC_DIR}/caddy`;
const PROXY_START_POLL_ATTEMPTS = 10;
const PROXY_START_POLL_MS = 250;

const DEFAULT_CADDY_BIN_CANDIDATES = [
  process.env.DEVMUX_CADDY_BIN,
  "/opt/homebrew/bin/caddy",
  "/usr/local/bin/caddy",
].filter((candidate): candidate is string => Boolean(candidate));

export interface ManagedProxyPaths {
  caddyBinaryPath: string | null;
  caddyfilePath: string;
  launchdPlistPath: string;
}

export interface ProxyDoctorReport extends ManagedProxyPaths {
  platform: NodeJS.Platform;
  supported: boolean;
  adminApiAvailable: boolean;
  caddyBinaryExists: boolean;
  caddyfileExists: boolean;
  launchdPlistExists: boolean;
  /** Whether the root-owned installed binary exists at DEVMUX_CADDY_INSTALLED_BIN. */
  installedBinaryExists: boolean;
  /** Whether the installed binary is owned by root (uid 0). Null when binary is absent or check failed. */
  installedBinaryOwnedByRoot: boolean | null;
  /** Whether the plist ProgramArguments still points at a Homebrew path (stale install). */
  plistPointsAtBrew: boolean;
  /** True when the brew caddy and installed copy differ (version string or hash mismatch). */
  binaryVersionMismatch: boolean;
  /** Human-readable version strings for display; null when unavailable. */
  brewCaddyVersion: string | null;
  installedCaddyVersion: string | null;
}

export interface ManagedProxyStartResult {
  available: boolean;
  attempted: boolean;
}

interface ManagedProxyStartOptions {
  checkAvailable?: () => Promise<boolean>;
  getReport?: () => ProxyDoctorReport;
  runCommand?: (command: string, args: string[]) => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
}

export function resolveCaddyBinaryPath(
  candidates = DEFAULT_CADDY_BIN_CANDIDATES,
  exists: (path: string) => boolean = existsSync,
): string | null {
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function getManagedProxyPaths(): ManagedProxyPaths {
  return {
    caddyBinaryPath: resolveCaddyBinaryPath(),
    caddyfilePath: DEFAULT_CADDYFILE_PATH,
    launchdPlistPath: DEFAULT_LAUNCHD_PLIST_PATH,
  };
}

/** Returns a SHA-256 hex digest of a file, or null on any error. */
function fileHash(
  filePath: string,
  readFile: (p: string) => Buffer = (p) => readFileSync(p),
): string | null {
  try {
    return createHash("sha256").update(readFile(filePath)).digest("hex");
  } catch {
    return null;
  }
}

/** Detects whether the LaunchDaemon plist ProgramArguments[0] is a Homebrew path. */
function plistPointsAtBrew(
  plistPath: string,
  exists: (p: string) => boolean = existsSync,
): boolean {
  if (!exists(plistPath)) return false;
  try {
    const content = readFileSync(plistPath, "utf8");
    // Match the first <string> after <key>ProgramArguments</key>/<array>
    const match = content.match(
      /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/,
    );
    if (!match) return false;
    const programPath = match[1];
    return (
      programPath.startsWith("/opt/homebrew/") ||
      programPath.startsWith("/usr/local/Cellar/") ||
      programPath.startsWith("/home/linuxbrew/")
    );
  } catch {
    return false;
  }
}

export function getProxyDoctorReport(
  adminApiAvailable: boolean,
  exists: (path: string) => boolean = existsSync,
): ProxyDoctorReport {
  const paths = getManagedProxyPaths();

  const installedBinaryExists = exists(DEVMUX_CADDY_INSTALLED_BIN);

  // Check root ownership via stat (sync, no subprocess needed).
  let installedBinaryOwnedByRoot: boolean | null = null;
  if (installedBinaryExists) {
    try {
      const stat = statSync(DEVMUX_CADDY_INSTALLED_BIN);
      installedBinaryOwnedByRoot = stat.uid === 0;
    } catch {
      installedBinaryOwnedByRoot = null;
    }
  }

  // Compare brew vs installed binary by file hash (cheap, no subprocess).
  let binaryVersionMismatch = false;
  let brewCaddyVersion: string | null = null;
  let installedCaddyVersion: string | null = null;

  if (installedBinaryExists && paths.caddyBinaryPath && exists(paths.caddyBinaryPath)) {
    const brewHash = fileHash(paths.caddyBinaryPath);
    const installedHash = fileHash(DEVMUX_CADDY_INSTALLED_BIN);
    if (brewHash !== null && installedHash !== null && brewHash !== installedHash) {
      binaryVersionMismatch = true;
      // Use truncated hashes as "version" stand-ins for display when real
      // version strings aren't cheaply available without spawning processes.
      brewCaddyVersion = `sha256:${brewHash.slice(0, 12)}`;
      installedCaddyVersion = `sha256:${installedHash.slice(0, 12)}`;
    }
  }

  return {
    ...paths,
    platform: process.platform,
    supported: process.platform === "darwin",
    adminApiAvailable,
    caddyBinaryExists: paths.caddyBinaryPath
      ? exists(paths.caddyBinaryPath)
      : false,
    caddyfileExists: exists(paths.caddyfilePath),
    launchdPlistExists: exists(paths.launchdPlistPath),
    installedBinaryExists,
    installedBinaryOwnedByRoot,
    plistPointsAtBrew: plistPointsAtBrew(paths.launchdPlistPath, exists),
    binaryVersionMismatch,
    brewCaddyVersion,
    installedCaddyVersion,
  };
}

export function renderManagedCaddyfile(): string {
  return `{
    auto_https off
    admin localhost:2019
    default_bind 127.0.0.1
}
`;
}

/**
 * Renders a LaunchDaemon plist.
 * The plist ProgramArguments always point at the root-owned installed binary
 * (DEVMUX_CADDY_INSTALLED_BIN) regardless of where caddy was originally
 * discovered, to prevent privilege-escalation via a Homebrew-writable path.
 */
export function renderLaunchdPlist(
  _brewCaddyBinaryPath: string,
  caddyfilePath = DEFAULT_CADDYFILE_PATH,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${DEVMUX_CADDY_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${DEVMUX_CADDY_INSTALLED_BIN}</string>
        <string>run</string>
        <string>--config</string>
        <string>${caddyfilePath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${DEFAULT_CADDY_LOG_PATH}</string>
    <key>StandardErrorPath</key>
    <string>${DEFAULT_CADDY_ERR_PATH}</string>
</dict>
</plist>
`;
}

export function buildProxySetupCommands(
  caddyBinaryPath: string,
  caddyfilePath = DEFAULT_CADDYFILE_PATH,
  launchdPlistPath = DEFAULT_LAUNCHD_PLIST_PATH,
): string[] {
  const caddyfile = renderManagedCaddyfile().trimEnd();
  // plist already hard-codes DEVMUX_CADDY_INSTALLED_BIN; brewCaddyBinaryPath is
  // only used during setup to know what to copy.
  const plist = renderLaunchdPlist(caddyBinaryPath, caddyfilePath).trimEnd();

  return [
    // 1. Install caddy to a root-owned directory to prevent Homebrew priv-esc.
    `sudo mkdir -p "${DEVMUX_CADDY_LIBEXEC_DIR}"`,
    `sudo chown root:wheel "${DEVMUX_CADDY_LIBEXEC_DIR}"`,
    `sudo chmod 755 "${DEVMUX_CADDY_LIBEXEC_DIR}"`,
    `sudo cp "${caddyBinaryPath}" "${DEVMUX_CADDY_INSTALLED_BIN}"`,
    `sudo chown root:wheel "${DEVMUX_CADDY_INSTALLED_BIN}"`,
    `sudo chmod 755 "${DEVMUX_CADDY_INSTALLED_BIN}"`,
    // 2. Write Caddyfile (binds only 127.0.0.1 via default_bind).
    `sudo mkdir -p "${dirname(caddyfilePath)}"`,
    `sudo tee "${caddyfilePath}" >/dev/null <<'EOF'\n${caddyfile}\nEOF`,
    // 3. Write and load LaunchDaemon plist.
    `sudo mkdir -p "${dirname(launchdPlistPath)}"`,
    `sudo tee "${launchdPlistPath}" >/dev/null <<'EOF'\n${plist}\nEOF`,
    `sudo launchctl unload -w "${launchdPlistPath}" >/dev/null 2>&1 || true`,
    `sudo launchctl load -w "${launchdPlistPath}"`,
  ];
}

/**
 * Builds the ordered list of sudo commands that fully remove the managed proxy.
 * Mirror of buildProxySetupCommands — safe to run on a system where setup was
 * never completed (each step is best-effort / idempotent via || true).
 */
export function buildProxyTeardownCommands(
  caddyfilePath = DEFAULT_CADDYFILE_PATH,
  launchdPlistPath = DEFAULT_LAUNCHD_PLIST_PATH,
): string[] {
  const caddyfileDir = dirname(caddyfilePath);
  return [
    // 1. Unload and remove the LaunchDaemon.
    `sudo launchctl unload -w "${launchdPlistPath}" >/dev/null 2>&1 || true`,
    `sudo rm -f "${launchdPlistPath}"`,
    // 2. Remove the root-owned caddy binary and its directory.
    `sudo rm -rf "${DEVMUX_CADDY_LIBEXEC_DIR}"`,
    // 3. Remove the Caddyfile; also remove its parent dir when empty.
    `sudo rm -f "${caddyfilePath}"`,
    `sudo rmdir "${caddyfileDir}" 2>/dev/null || true`,
  ];
}

/**
 * Prints teardown instructions to stdout, mirroring how setup --apply/print
 * works. Pass apply=true to execute via sudo, false to print commands only.
 */
export async function printTeardownInstructions(
  apply: boolean,
  caddyfilePath = DEFAULT_CADDYFILE_PATH,
  launchdPlistPath = DEFAULT_LAUNCHD_PLIST_PATH,
): Promise<void> {
  const commands = buildProxyTeardownCommands(caddyfilePath, launchdPlistPath);
  if (!apply) {
    console.log("Run the following commands to remove the devmux managed proxy:\n");
    for (const cmd of commands) {
      console.log(`  ${cmd}`);
    }
    console.log();
    return;
  }

  console.log("Removing devmux managed proxy...\n");
  for (const cmd of commands) {
    console.log(`  $ ${cmd}`);
    // Each command is already shell syntax (pipes, redirects, || true) so we
    // must run via a shell.
    const result = await execa("sh", ["-c", cmd], {
      reject: false,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) {
      // Non-fatal: log and continue so subsequent cleanup steps still run.
      console.warn(`  Warning: command exited with ${result.exitCode}`);
    }
  }
  console.log("\nDevmux managed proxy removed.");
}

export function formatProxyDoctorReport(report: ProxyDoctorReport): string[] {
  const lines = [
    `Platform: ${report.platform}${report.supported ? "" : " (managed setup unavailable)"}`,
    `Admin API (${DEFAULT_CADDY_ADMIN_URL}): ${report.adminApiAvailable ? "reachable" : "not reachable"}`,
    `Caddy binary (brew): ${report.caddyBinaryExists ? report.caddyBinaryPath : "missing"}`,
    `Caddy binary (installed): ${
      report.installedBinaryExists
        ? `${DEVMUX_CADDY_INSTALLED_BIN}${
            report.installedBinaryOwnedByRoot === false
              ? " ⚠ NOT owned by root"
              : report.installedBinaryOwnedByRoot === true
                ? " (root-owned)"
                : ""
          }`
        : `missing (${DEVMUX_CADDY_INSTALLED_BIN})`
    }`,
    `Caddyfile: ${report.caddyfileExists ? report.caddyfilePath : `missing (${report.caddyfilePath})`}`,
    `LaunchDaemon plist: ${report.launchdPlistExists ? report.launchdPlistPath : `missing (${report.launchdPlistPath})`}`,
  ];

  if (report.plistPointsAtBrew) {
    lines.push(
      `⚠ Plist ProgramArguments still points at a Homebrew path (stale install). Re-run: devmux proxy setup --apply`,
    );
  }

  if (report.binaryVersionMismatch) {
    lines.push(
      `⚠ Brew caddy and installed copy differ — brew: ${report.brewCaddyVersion}, installed: ${report.installedCaddyVersion}. Re-run: devmux proxy setup --apply`,
    );
  }

  if (!report.adminApiAvailable) {
    if (report.supported && report.caddyBinaryExists) {
      lines.push("Next step: devmux proxy setup --apply");
    } else if (!report.caddyBinaryExists) {
      lines.push("Next step: brew install caddy");
    }
  }

  return lines;
}

async function defaultRunCommand(
  command: string,
  args: string[],
): Promise<number> {
  const result = await execa(command, args, {
    reject: false,
    stdout: "ignore",
    stderr: "ignore",
  });
  return result.exitCode ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProxyAvailability(
  checkAvailable: () => Promise<boolean>,
  delay: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < PROXY_START_POLL_ATTEMPTS; attempt++) {
    if (await checkAvailable()) return true;
    if (attempt < PROXY_START_POLL_ATTEMPTS - 1) {
      await delay(PROXY_START_POLL_MS);
    }
  }
  return false;
}

export async function tryStartManagedProxy(
  options: ManagedProxyStartOptions = {},
): Promise<ManagedProxyStartResult> {
  const checkAvailable = options.checkAvailable ?? (() => Promise.resolve(false));
  if (await checkAvailable()) {
    return { available: true, attempted: false };
  }

  const report = options.getReport?.() ?? getProxyDoctorReport(false);
  if (!report.supported || !report.launchdPlistExists) {
    return { available: false, attempted: false };
  }

  const runCommand = options.runCommand ?? defaultRunCommand;
  const delay = options.sleep ?? sleep;
  const commands: Array<[string, string[]]> = [
    ["launchctl", ["kickstart", "-k", `system/${DEVMUX_CADDY_LABEL}`]],
    ["sudo", ["-n", "launchctl", "kickstart", "-k", `system/${DEVMUX_CADDY_LABEL}`]],
    [
      "sudo",
      [
        "-n",
        "launchctl",
        "bootstrap",
        "system",
        report.launchdPlistPath,
      ],
    ],
  ];

  for (const [command, args] of commands) {
    const exitCode = await runCommand(command, args);
    if (exitCode !== 0) continue;

    const available = await waitForProxyAvailability(checkAvailable, delay);
    if (available) {
      return { available: true, attempted: true };
    }
  }

  return { available: false, attempted: true };
}

/**
 * Copy the caddy binary into the root-owned libexec dir the LaunchDaemon
 * executes from. Must run as root (callers gate on getuid() === 0): a root
 * daemon must never execute a user-writable (Homebrew) binary.
 */
export function installCaddyBinary(caddyBinaryPath: string): void {
  mkdirSync(DEVMUX_CADDY_LIBEXEC_DIR, { recursive: true });
  chownSync(DEVMUX_CADDY_LIBEXEC_DIR, 0, 0);
  chmodSync(DEVMUX_CADDY_LIBEXEC_DIR, 0o755);
  copyFileSync(caddyBinaryPath, DEVMUX_CADDY_INSTALLED_BIN);
  chownSync(DEVMUX_CADDY_INSTALLED_BIN, 0, 0);
  chmodSync(DEVMUX_CADDY_INSTALLED_BIN, 0o755);
}

export function writeManagedProxyFiles(
  caddyBinaryPath: string,
  caddyfilePath = DEFAULT_CADDYFILE_PATH,
  launchdPlistPath = DEFAULT_LAUNCHD_PLIST_PATH,
): void {
  installCaddyBinary(caddyBinaryPath);
  mkdirSync(dirname(caddyfilePath), { recursive: true });
  writeFileSync(caddyfilePath, renderManagedCaddyfile(), "utf8");
  mkdirSync(dirname(launchdPlistPath), { recursive: true });
  writeFileSync(
    launchdPlistPath,
    renderLaunchdPlist(caddyBinaryPath, caddyfilePath),
    "utf8",
  );
}
