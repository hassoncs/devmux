import { describe, expect, it } from "vitest";
import {
  buildProxySetupCommands,
  DEFAULT_CADDYFILE_PATH,
  DEFAULT_LAUNCHD_PLIST_PATH,
  DEVMUX_CADDY_LABEL,
  formatProxyDoctorReport,
  renderLaunchdPlist,
  renderManagedCaddyfile,
  resolveCaddyBinaryPath,
} from "../proxy/system.js";

describe("proxy system helpers", () => {
  it("prefers the first existing Caddy binary candidate", () => {
    const path = resolveCaddyBinaryPath(
      ["/missing/caddy", "/opt/homebrew/bin/caddy", "/usr/local/bin/caddy"],
      (candidate) => candidate === "/opt/homebrew/bin/caddy",
    );

    expect(path).toBe("/opt/homebrew/bin/caddy");
  });

  it("renders the managed Caddyfile with explicit admin and disabled auto https", () => {
    expect(renderManagedCaddyfile()).toContain("auto_https off");
    expect(renderManagedCaddyfile()).toContain("admin localhost:2019");
  });

  it("renders the managed LaunchDaemon plist with the expected label and config path", () => {
    const plist = renderLaunchdPlist("/opt/homebrew/bin/caddy");

    expect(plist).toContain(DEVMUX_CADDY_LABEL);
    expect(plist).toContain("/opt/homebrew/bin/caddy");
    expect(plist).toContain(DEFAULT_CADDYFILE_PATH);
  });

  it("builds setup commands that write the managed config and load launchd", () => {
    const commands = buildProxySetupCommands("/opt/homebrew/bin/caddy");

    expect(commands).toContain(`sudo mkdir -p "/usr/local/etc/caddy"`);
    expect(commands[1]).toContain(DEFAULT_CADDYFILE_PATH);
    expect(commands[3]).toContain(DEFAULT_LAUNCHD_PLIST_PATH);
    expect(commands[5]).toContain(`sudo launchctl load -w "${DEFAULT_LAUNCHD_PLIST_PATH}"`);
  });

  it("formats doctor output with the next-step setup command when admin is unavailable", () => {
    const lines = formatProxyDoctorReport({
      platform: "darwin",
      supported: true,
      adminApiAvailable: false,
      caddyBinaryPath: "/opt/homebrew/bin/caddy",
      caddyBinaryExists: true,
      caddyfileExists: false,
      launchdPlistExists: false,
      caddyfilePath: DEFAULT_CADDYFILE_PATH,
      launchdPlistPath: DEFAULT_LAUNCHD_PLIST_PATH,
    });

    expect(lines).toContain("Next step: sudo devmux proxy setup --apply");
  });
});
