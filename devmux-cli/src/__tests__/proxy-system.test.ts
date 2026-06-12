import { describe, expect, it } from "vitest";
import {
  buildProxySetupCommands,
  buildProxyTeardownCommands,
  DEFAULT_CADDYFILE_PATH,
  DEFAULT_LAUNCHD_PLIST_PATH,
  DEVMUX_CADDY_INSTALLED_BIN,
  DEVMUX_CADDY_LABEL,
  DEVMUX_CADDY_LIBEXEC_DIR,
  formatProxyDoctorReport,
  ProxyDoctorReport,
  renderLaunchdPlist,
  renderManagedCaddyfile,
  resolveCaddyBinaryPath,
  tryStartManagedProxy,
} from "../proxy/system.js";

/** Minimal ProxyDoctorReport fixture — new security fields default to safe values. */
function makeReport(overrides: Partial<ProxyDoctorReport> = {}): ProxyDoctorReport {
  return {
    platform: "darwin",
    supported: true,
    adminApiAvailable: false,
    caddyBinaryPath: "/opt/homebrew/bin/caddy",
    caddyBinaryExists: true,
    caddyfileExists: false,
    launchdPlistExists: false,
    caddyfilePath: DEFAULT_CADDYFILE_PATH,
    launchdPlistPath: DEFAULT_LAUNCHD_PLIST_PATH,
    installedBinaryExists: false,
    installedBinaryOwnedByRoot: null,
    plistPointsAtBrew: false,
    binaryVersionMismatch: false,
    brewCaddyVersion: null,
    installedCaddyVersion: null,
    ...overrides,
  };
}

describe("proxy system helpers", () => {
  it("prefers the first existing Caddy binary candidate", () => {
    const path = resolveCaddyBinaryPath(
      ["/missing/caddy", "/opt/homebrew/bin/caddy", "/usr/local/bin/caddy"],
      (candidate) => candidate === "/opt/homebrew/bin/caddy",
    );

    expect(path).toBe("/opt/homebrew/bin/caddy");
  });

  it("renders the managed Caddyfile with explicit admin, disabled auto https, and 127.0.0.1 binding", () => {
    expect(renderManagedCaddyfile()).toContain("auto_https off");
    expect(renderManagedCaddyfile()).toContain("admin localhost:2019");
    expect(renderManagedCaddyfile()).toContain("default_bind 127.0.0.1");
  });

  it("renders the managed LaunchDaemon plist pointing at the root-owned installed binary", () => {
    const plist = renderLaunchdPlist("/opt/homebrew/bin/caddy");

    expect(plist).toContain(DEVMUX_CADDY_LABEL);
    // Must point at the installed binary, NOT at the Homebrew source path.
    expect(plist).toContain(DEVMUX_CADDY_INSTALLED_BIN);
    expect(plist).not.toContain("/opt/homebrew/bin/caddy");
    expect(plist).toContain(DEFAULT_CADDYFILE_PATH);
  });

  it("builds setup commands that copy caddy to the root-owned dir, write config, and load launchd", () => {
    const commands = buildProxySetupCommands("/opt/homebrew/bin/caddy");

    // First block: create root-owned libexec dir and copy caddy there.
    expect(commands[0]).toBe(`sudo mkdir -p "${DEVMUX_CADDY_LIBEXEC_DIR}"`);
    expect(commands[3]).toBe(`sudo cp "/opt/homebrew/bin/caddy" "${DEVMUX_CADDY_INSTALLED_BIN}"`);
    // Caddyfile write.
    expect(commands.some((c) => c.includes(DEFAULT_CADDYFILE_PATH))).toBe(true);
    // LaunchDaemon plist write and load.
    expect(commands.some((c) => c.includes(DEFAULT_LAUNCHD_PLIST_PATH))).toBe(true);
    expect(commands[commands.length - 1]).toContain(`sudo launchctl load -w "${DEFAULT_LAUNCHD_PLIST_PATH}"`);
  });

  it("builds teardown commands that unload launchd, remove the installed binary dir, and remove the Caddyfile", () => {
    const commands = buildProxyTeardownCommands();

    expect(commands[0]).toContain(`sudo launchctl unload -w "${DEFAULT_LAUNCHD_PLIST_PATH}"`);
    expect(commands[1]).toBe(`sudo rm -f "${DEFAULT_LAUNCHD_PLIST_PATH}"`);
    expect(commands[2]).toBe(`sudo rm -rf "${DEVMUX_CADDY_LIBEXEC_DIR}"`);
    expect(commands[3]).toBe(`sudo rm -f "${DEFAULT_CADDYFILE_PATH}"`);
  });

  it("formats doctor output with the next-step setup command when admin is unavailable", () => {
    const lines = formatProxyDoctorReport(makeReport());

    expect(lines).toContain("Next step: devmux proxy setup --apply");
  });

  it("formats doctor output with stale-plist warning when plist points at brew", () => {
    const lines = formatProxyDoctorReport(makeReport({ plistPointsAtBrew: true }));

    expect(lines.some((l) => l.includes("Homebrew path") && l.includes("--apply"))).toBe(true);
  });

  it("formats doctor output with version-mismatch warning when binary hashes differ", () => {
    const lines = formatProxyDoctorReport(
      makeReport({
        binaryVersionMismatch: true,
        brewCaddyVersion: "sha256:aabbcc112233",
        installedCaddyVersion: "sha256:ddeeff445566",
      }),
    );

    expect(lines.some((l) => l.includes("differ") && l.includes("--apply"))).toBe(true);
  });

  it("formats doctor output with root-ownership warning when installed binary not owned by root", () => {
    const lines = formatProxyDoctorReport(
      makeReport({ installedBinaryExists: true, installedBinaryOwnedByRoot: false }),
    );

    expect(lines.some((l) => l.includes("NOT owned by root"))).toBe(true);
  });

  it("tries launchctl first and reports a successful lazy start once the admin API responds", async () => {
    const checks = [false, false, true];
    const commands: Array<{ command: string; args: string[] }> = [];

    const result = await tryStartManagedProxy({
      checkAvailable: async () => checks.shift() ?? true,
      getReport: () => makeReport({ caddyfileExists: true, launchdPlistExists: true }),
      runCommand: async (command, args) => {
        commands.push({ command, args });
        return 0;
      },
      sleep: async () => {},
    });

    expect(result).toEqual({ available: true, attempted: true });
    expect(commands).toEqual([
      {
        command: "launchctl",
        args: ["kickstart", "-k", `system/${DEVMUX_CADDY_LABEL}`],
      },
    ]);
  });

  it("falls back to sudo -n launchctl when direct kickstart fails", async () => {
    const commands: Array<{ command: string; args: string[] }> = [];

    const result = await tryStartManagedProxy({
      checkAvailable: async () => false,
      getReport: () => makeReport({ caddyfileExists: true, launchdPlistExists: true }),
      runCommand: async (command, args) => {
        commands.push({ command, args });
        return command === "launchctl" ? 1 : 0;
      },
      sleep: async () => {},
    });

    expect(result).toEqual({ available: false, attempted: true });
    expect(commands).toEqual([
      {
        command: "launchctl",
        args: ["kickstart", "-k", `system/${DEVMUX_CADDY_LABEL}`],
      },
      {
        command: "sudo",
        args: ["-n", "launchctl", "kickstart", "-k", `system/${DEVMUX_CADDY_LABEL}`],
      },
      {
        command: "sudo",
        args: [
          "-n",
          "launchctl",
          "bootstrap",
          "system",
          DEFAULT_LAUNCHD_PLIST_PATH,
        ],
      },
    ]);
  });

  it("bootstraps the plist when kickstart cannot recover a booted-out proxy", async () => {
    const checks = [false, false, true];
    const commands: Array<{ command: string; args: string[] }> = [];

    const result = await tryStartManagedProxy({
      checkAvailable: async () => checks.shift() ?? true,
      getReport: () => makeReport({ caddyfileExists: true, launchdPlistExists: true }),
      runCommand: async (command, args) => {
        commands.push({ command, args });
        return args.includes("bootstrap") ? 0 : 1;
      },
      sleep: async () => {},
    });

    expect(result).toEqual({ available: true, attempted: true });
    expect(commands).toEqual([
      {
        command: "launchctl",
        args: ["kickstart", "-k", `system/${DEVMUX_CADDY_LABEL}`],
      },
      {
        command: "sudo",
        args: ["-n", "launchctl", "kickstart", "-k", `system/${DEVMUX_CADDY_LABEL}`],
      },
      {
        command: "sudo",
        args: [
          "-n",
          "launchctl",
          "bootstrap",
          "system",
          DEFAULT_LAUNCHD_PLIST_PATH,
        ],
      },
    ]);
  });

  it("skips lazy start when the managed launchd setup is missing", async () => {
    const runCommand = async () => 0;

    const result = await tryStartManagedProxy({
      checkAvailable: async () => false,
      getReport: () => makeReport({ caddyfileExists: true, launchdPlistExists: false }),
      runCommand,
    });

    expect(result).toEqual({ available: false, attempted: false });
  });
});
