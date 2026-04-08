import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEVMUX_CADDY_LABEL = "dev.devmux.caddy";
export const DEFAULT_CADDY_ADMIN_URL = "http://localhost:2019";
export const DEFAULT_CADDYFILE_PATH = "/usr/local/etc/caddy/Caddyfile";
export const DEFAULT_LAUNCHD_PLIST_PATH =
  "/Library/LaunchDaemons/dev.devmux.caddy.plist";
export const DEFAULT_CADDY_LOG_PATH = "/var/log/devmux-caddy.log";
export const DEFAULT_CADDY_ERR_PATH = "/var/log/devmux-caddy.err";

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

export function getProxyDoctorReport(
  adminApiAvailable: boolean,
  exists: (path: string) => boolean = existsSync,
): ProxyDoctorReport {
  const paths = getManagedProxyPaths();
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
  };
}

export function renderManagedCaddyfile(): string {
  return `{
    auto_https off
    admin localhost:2019
}
`;
}

export function renderLaunchdPlist(
  caddyBinaryPath: string,
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
        <string>${caddyBinaryPath}</string>
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
  const plist = renderLaunchdPlist(caddyBinaryPath, caddyfilePath).trimEnd();

  return [
    `sudo mkdir -p "${dirname(caddyfilePath)}"`,
    `sudo tee "${caddyfilePath}" >/dev/null <<'EOF'\n${caddyfile}\nEOF`,
    `sudo mkdir -p "${dirname(launchdPlistPath)}"`,
    `sudo tee "${launchdPlistPath}" >/dev/null <<'EOF'\n${plist}\nEOF`,
    `sudo launchctl unload -w "${launchdPlistPath}" >/dev/null 2>&1 || true`,
    `sudo launchctl load -w "${launchdPlistPath}"`,
  ];
}

export function formatProxyDoctorReport(report: ProxyDoctorReport): string[] {
  const lines = [
    `Platform: ${report.platform}${report.supported ? "" : " (managed setup unavailable)"}`,
    `Admin API (${DEFAULT_CADDY_ADMIN_URL}): ${report.adminApiAvailable ? "reachable" : "not reachable"}`,
    `Caddy binary: ${report.caddyBinaryExists ? report.caddyBinaryPath : "missing"}`,
    `Caddyfile: ${report.caddyfileExists ? report.caddyfilePath : `missing (${report.caddyfilePath})`}`,
    `LaunchDaemon plist: ${report.launchdPlistExists ? report.launchdPlistPath : `missing (${report.launchdPlistPath})`}`,
  ];

  if (!report.adminApiAvailable) {
    if (report.supported && report.caddyBinaryExists) {
      lines.push("Next step: sudo devmux proxy setup --apply");
    } else if (!report.caddyBinaryExists) {
      lines.push("Next step: brew install caddy");
    }
  }

  return lines;
}

export function writeManagedProxyFiles(
  caddyBinaryPath: string,
  caddyfilePath = DEFAULT_CADDYFILE_PATH,
  launchdPlistPath = DEFAULT_LAUNCHD_PLIST_PATH,
): void {
  mkdirSync(dirname(caddyfilePath), { recursive: true });
  writeFileSync(caddyfilePath, renderManagedCaddyfile(), "utf8");
  mkdirSync(dirname(launchdPlistPath), { recursive: true });
  writeFileSync(
    launchdPlistPath,
    renderLaunchdPlist(caddyBinaryPath, caddyfilePath),
    "utf8",
  );
}
