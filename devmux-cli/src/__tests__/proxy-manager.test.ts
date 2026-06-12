import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAvailable: vi.fn<() => Promise<boolean>>(),
  tryStartManagedProxy: vi.fn(),
  getProxyDoctorReport: vi.fn(),
  formatProxyDoctorReport: vi.fn(),
}));

vi.mock("../proxy/caddy.js", () => ({
  caddy: {
    isAvailable: mocks.isAvailable,
  },
}));

vi.mock("../proxy/system.js", () => ({
  getProxyDoctorReport: mocks.getProxyDoctorReport,
  formatProxyDoctorReport: mocks.formatProxyDoctorReport,
  tryStartManagedProxy: mocks.tryStartManagedProxy,
}));

import { ensureProxyRunning } from "../proxy/manager.js";

describe("ensureProxyRunning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProxyDoctorReport.mockReturnValue({ platform: "darwin" });
    mocks.formatProxyDoctorReport.mockReturnValue(["Next step: sudo devmux proxy setup --apply"]);
  });

  const config = {
    version: 1 as const,
    project: "devmux",
    proxy: { enabled: true },
    services: {},
    configRoot: "/tmp/devmux",
    resolvedSessionPrefix: "custom-devmux",
    instanceId: "",
  };

  it("returns once the managed proxy lazy start succeeds", async () => {
    mocks.isAvailable.mockResolvedValueOnce(false);
    mocks.tryStartManagedProxy.mockResolvedValueOnce({ available: true, attempted: true });

    await expect(ensureProxyRunning(config)).resolves.toBeUndefined();
    expect(mocks.tryStartManagedProxy).toHaveBeenCalledTimes(1);
  });

  it("mentions the lazy-start attempt when the proxy is still unavailable", async () => {
    mocks.isAvailable.mockResolvedValueOnce(false);
    mocks.tryStartManagedProxy.mockResolvedValueOnce({ available: false, attempted: true });

    await expect(ensureProxyRunning(config)).rejects.toThrow(
      "DevMux tried to start the managed proxy automatically",
    );
  });
});
