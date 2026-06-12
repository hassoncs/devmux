import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  redactSecrets,
  ensureOutputDir,
  getQueuePath,
  writeEvent,
  readQueue,
  clearQueue,
  updateEventStatus,
} from "../src/watch/queue.js";
import type { WatcherOptions, ErrorPattern } from "../src/watch/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "devmux-queue-test-"));
}

function makeOptions(outputDir: string, redact?: boolean): WatcherOptions {
  return {
    service: "api",
    project: "myapp",
    sessionName: "devmux-myapp-api",
    outputDir,
    patterns: [],
    dedupeWindowMs: 5000,
    contextLines: 5,
    ...(redact !== undefined ? { redact } : {}),
  };
}

const TEST_PATTERN: ErrorPattern = {
  name: "js-error",
  regex: "Error:",
  severity: "error",
};

// ---------------------------------------------------------------------------
// redactSecrets
// ---------------------------------------------------------------------------

describe("redactSecrets", () => {
  it("redacts Bearer tokens", () => {
    // Use a raw Authorization header that is NOT matched by the key=value pattern
    const line = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123def";
    const result = redactSecrets(line);
    // Token value must not appear in output regardless of which pattern fires
    expect(result).not.toMatch(/eyJ/);
    expect(result).not.toContain("abc123def");
    // Value is replaced with a [REDACTED] marker
    expect(result).toContain("[REDACTED]");
  });

  it("redacts api_key= assignments", () => {
    const line = "api_key=supersecret123";
    const result = redactSecrets(line);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("supersecret123");
  });

  it("redacts token= assignments", () => {
    const line = "token=abc123xyz";
    const result = redactSecrets(line);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("abc123xyz");
  });

  it("redacts secret: assignments (colon separator)", () => {
    const line = "secret: mysecretvalue";
    const result = redactSecrets(line);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("mysecretvalue");
  });

  it("redacts password= assignments", () => {
    const line = "password=hunter2";
    const result = redactSecrets(line);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("hunter2");
  });

  it("redacts AWS access key IDs", () => {
    const line = "Using key AKIAIOSFODNN7EXAMPLE for request";
    const result = redactSecrets(line);
    expect(result).toContain("[REDACTED_AWS_KEY]");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts GitHub personal access tokens (ghp_)", () => {
    const line = "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ab";
    const result = redactSecrets(line);
    expect(result).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ab");
  });

  it("redacts GitHub OAuth tokens (gho_)", () => {
    const line = "auth=gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ab";
    const result = redactSecrets(line);
    expect(result).not.toContain("gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ab");
  });

  it("does not alter innocuous log lines", () => {
    const line = "Server started on port 3000";
    expect(redactSecrets(line)).toBe(line);
  });

  it("does not alter short alphanumeric tokens (under 40 chars)", () => {
    const line = "id=abc123def";
    // No redaction of short values that don't match named patterns
    const result = redactSecrets(line);
    // The key=value pattern matches token/api_key/secret/password/authorization only
    expect(result).toBe(line);
  });

  it("redacts long hex strings (40+ chars)", () => {
    const line = "sha=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const result = redactSecrets(line);
    expect(result).toContain("[REDACTED_HEX]");
    expect(result).not.toContain("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
  });

  it("keeps key name, replaces value for authorization header", () => {
    const line = "authorization: Bearer tok123";
    const result = redactSecrets(line);
    expect(result).toContain("authorization");
    expect(result).not.toContain("tok123");
  });
});

// ---------------------------------------------------------------------------
// Default path uses ~/.devmux
// ---------------------------------------------------------------------------

describe("default output directory", () => {
  it("resolves to ~/.devmux when HOME is set", () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/tmp/fakehome";
    try {
      const path = getQueuePath();
      expect(path).toBe("/tmp/fakehome/.devmux/queue.jsonl");
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it("throws when HOME is unset", () => {
    const originalHome = process.env.HOME;
    delete process.env.HOME;
    try {
      expect(() => getQueuePath()).toThrow(
        "HOME is not set; cannot determine devmux state directory"
      );
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it("ensureOutputDir throws when HOME is unset", () => {
    const originalHome = process.env.HOME;
    delete process.env.HOME;
    try {
      expect(() => ensureOutputDir()).toThrow(
        "HOME is not set; cannot determine devmux state directory"
      );
    } finally {
      process.env.HOME = originalHome;
    }
  });
});

// ---------------------------------------------------------------------------
// Corrupt-line tolerance in readQueue
// ---------------------------------------------------------------------------

describe("readQueue corrupt-line tolerance", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips corrupt lines and returns the valid events", () => {
    const opts = makeOptions(tmpDir);
    // Write one valid event
    const ev = writeEvent(opts, TEST_PATTERN, "Error: boom", ["context line"]);

    // Corrupt the file by injecting garbage
    const queuePath = getQueuePath(tmpDir);
    const existing = readFileSync(queuePath, "utf-8");
    writeFileSync(queuePath, `{not valid json}\n${existing}{also bad}\n`);

    const events = readQueue(tmpDir);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(ev.id);
  });

  it("returns empty array for fully corrupt queue", () => {
    const queuePath = getQueuePath(tmpDir);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(queuePath, "garbage\nmore garbage\n");

    const events = readQueue(tmpDir);
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// File permissions
// ---------------------------------------------------------------------------

describe("file permissions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates queue file with mode 0o600", () => {
    const opts = makeOptions(tmpDir);
    writeEvent(opts, TEST_PATTERN, "Error: test", []);

    const queuePath = getQueuePath(tmpDir);
    const { mode } = require("node:fs").statSync(queuePath);
    // mode & 0o777 should be 0o600
    expect(mode & 0o777).toBe(0o600);
  });
});

// ---------------------------------------------------------------------------
// Redaction applied in writeEvent
// ---------------------------------------------------------------------------

describe("writeEvent redaction", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("redacts rawContent and context by default", () => {
    const opts = makeOptions(tmpDir);
    const ev = writeEvent(
      opts,
      TEST_PATTERN,
      "token=supersecret Error: boom",
      ["context: api_key=abc123"],
      ["  at fn (file.js:1:1)"]
    );

    expect(ev.rawContent).not.toContain("supersecret");
    expect(ev.rawContent).toContain("[REDACTED]");
    expect(ev.context[0]).not.toContain("abc123");
    expect(ev.context[0]).toContain("[REDACTED]");
  });

  it("does not redact when redact: false", () => {
    const opts = makeOptions(tmpDir, false);
    const ev = writeEvent(
      opts,
      TEST_PATTERN,
      "token=supersecret Error: boom",
      ["context: api_key=abc123"]
    );

    expect(ev.rawContent).toContain("supersecret");
    expect(ev.context[0]).toContain("abc123");
  });

  it("persisted JSON also has redacted content", () => {
    const opts = makeOptions(tmpDir);
    writeEvent(opts, TEST_PATTERN, "token=mysecret Error: boom", []);

    const events = readQueue(tmpDir);
    expect(events[0].rawContent).not.toContain("mysecret");
    expect(events[0].rawContent).toContain("[REDACTED]");
  });
});

// ---------------------------------------------------------------------------
// updateEventStatus — atomic write
// ---------------------------------------------------------------------------

describe("updateEventStatus", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates event status and persists atomically", () => {
    const opts = makeOptions(tmpDir);
    const ev = writeEvent(opts, TEST_PATTERN, "Error: test", []);

    const result = updateEventStatus(ev.id, "resolved", tmpDir);
    expect(result).toBe(true);

    const events = readQueue(tmpDir);
    expect(events[0].status).toBe("resolved");
  });

  it("returns false for unknown event ID", () => {
    const opts = makeOptions(tmpDir);
    writeEvent(opts, TEST_PATTERN, "Error: test", []);

    const result = updateEventStatus("non-existent-id", "resolved", tmpDir);
    expect(result).toBe(false);
  });
});
