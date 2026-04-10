import { describe, it, expect } from "vitest";
import {
  parseHostname,
  formatUrl,
  getServiceHostname,
} from "../proxy/manager.js";

describe("parseHostname", () => {
  it("appends .localhost to bare names", () => {
    expect(parseHostname("myapp")).toBe("myapp.localhost");
  });

  it("preserves existing .localhost suffix", () => {
    expect(parseHostname("myapp.localhost")).toBe("myapp.localhost");
  });

  it("rejects non-localhost fully qualified hostnames", () => {
    expect(() => parseHostname("api.town.lan")).toThrow(
      "must end with .localhost",
    );
    expect(() => parseHostname("https://storybook.pencil.town.lan")).toThrow(
      "must end with .localhost",
    );
  });

  it("strips protocol prefixes", () => {
    expect(parseHostname("http://myapp")).toBe("myapp.localhost");
    expect(parseHostname("https://myapp.localhost")).toBe("myapp.localhost");
  });

  it("supports dotted subdomains", () => {
    expect(parseHostname("api.myapp")).toBe("api.myapp.localhost");
  });

  it("rejects empty hostnames", () => {
    expect(() => parseHostname("")).toThrow("cannot be empty");
  });

  it("rejects consecutive dots", () => {
    expect(() => parseHostname("my..app")).toThrow("consecutive dots");
  });

  it("rejects invalid characters", () => {
    expect(() => parseHostname("my_app")).toThrow("must contain only");
  });
});

describe("formatUrl", () => {
  it("returns clean http url", () => {
    expect(formatUrl("app.localhost")).toBe("http://app.localhost");
  });
});

describe("getServiceHostname", () => {
  it("defaults to localhost hostnames", () => {
    expect(
      getServiceHostname(
        {
          project: "waypoint",
          version: 1,
          services: { web: { cwd: ".", command: "pnpm dev" } },
          configRoot: "/tmp",
          resolvedSessionPrefix: "omo-waypoint",
          instanceId: "",
        },
        "web",
      ),
    ).toBe("web.waypoint.localhost");
  });

  it("allows an explicit per-project hostname pattern override", () => {
    expect(
      getServiceHostname(
        {
          project: "waypoint",
          version: 1,
          proxy: { enabled: true, hostnamePattern: "{service}.localhost" },
          services: { web: { cwd: ".", command: "pnpm dev" } },
          configRoot: "/tmp",
          resolvedSessionPrefix: "omo-waypoint",
          instanceId: "",
        },
        "web",
      ),
    ).toBe("web.localhost");
  });
});
