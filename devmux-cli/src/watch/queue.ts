import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TriggerEvent, ErrorPattern, WatcherOptions } from "./types.js";
import { computeContentHash } from "./deduper.js";

// ---------------------------------------------------------------------------
// Default path resolution
// ---------------------------------------------------------------------------

function getDefaultOutputDir(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set; cannot determine devmux state directory");
  }
  return join(home, ".devmux");
}

// Lazily resolved so that tests can set process.env.HOME before import side-effects.
function resolveOutputDir(outputDir?: string): string {
  return outputDir ?? getDefaultOutputDir();
}

const AUTO_PRUNE_THRESHOLD_BYTES = 50 * 1024 * 1024;
const EVENTS_TO_KEEP_AFTER_PRUNE = 10000;

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer tokens
  {
    pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+=*/gi,
    replacement: "Bearer [REDACTED]",
  },
  // Key/value assignments: api_key=..., token=..., secret=..., password=..., authorization=...
  {
    pattern:
      /((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)\S+/gi,
    replacement: "$1[REDACTED]",
  },
  // AWS access key IDs
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  // GitHub tokens: ghp_, gho_, ghu_, ghs_, ghr_
  {
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g,
    replacement: "[REDACTED_GH_TOKEN]",
  },
  // Long base64 / hex runs (40+ contiguous chars from a restricted alphabet)
  {
    pattern: /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g,
    replacement: "[REDACTED_B64]",
  },
  {
    pattern: /(?<![0-9a-fA-F])[0-9a-fA-F]{40,}(?![0-9a-fA-F])/g,
    replacement: "[REDACTED_HEX]",
  },
];

export function redactSecrets(line: string): string {
  let result = line;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    // Reset lastIndex for global regexes between calls
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Directory / file helpers
// ---------------------------------------------------------------------------

export function ensureOutputDir(outputDir?: string): string {
  const dir = resolveOutputDir(outputDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    // Tighten permissions defensively if they are wider than 0o700
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Non-POSIX or permission denied — best-effort, ignore
    }
  }
  return dir;
}

export function getQueuePath(outputDir?: string): string {
  return join(resolveOutputDir(outputDir), "queue.jsonl");
}

function ensureQueueFile(queuePath: string): void {
  if (!existsSync(queuePath)) {
    writeFileSync(queuePath, "", { mode: 0o600 });
  } else {
    try {
      chmodSync(queuePath, 0o600);
    } catch {
      // Non-POSIX — ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

function atomicWriteLines(queuePath: string, lines: string[]): void {
  const tmp = `${queuePath}.tmp`;
  writeFileSync(tmp, lines.join("\n") + "\n", { mode: 0o600 });
  renameSync(tmp, queuePath);
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export function pruneQueueIfNeeded(outputDir?: string): boolean {
  const dir = resolveOutputDir(outputDir);
  const queuePath = getQueuePath(dir);

  if (!existsSync(queuePath)) {
    return false;
  }

  const stats = statSync(queuePath);
  if (stats.size < AUTO_PRUNE_THRESHOLD_BYTES) {
    return false;
  }

  const content = readFileSync(queuePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const linesToKeep = lines.slice(-EVENTS_TO_KEEP_AFTER_PRUNE);

  atomicWriteLines(queuePath, linesToKeep);
  return true;
}

export function writeEvent(
  options: WatcherOptions,
  pattern: ErrorPattern,
  rawContent: string,
  context: string[],
  stackTrace?: string[]
): TriggerEvent {
  const shouldRedact = options.redact !== false;

  const finalRaw = shouldRedact ? redactSecrets(rawContent) : rawContent;
  const finalContext = shouldRedact ? context.map(redactSecrets) : context;
  const finalStack =
    stackTrace && stackTrace.length > 0
      ? shouldRedact
        ? stackTrace.map(redactSecrets)
        : stackTrace
      : undefined;

  const outputDir = ensureOutputDir(options.outputDir);
  const queuePath = getQueuePath(outputDir);
  ensureQueueFile(queuePath);

  const event: TriggerEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source: `devmux:${options.service}`,
    service: options.service,
    project: options.project,
    severity: pattern.severity,
    pattern: pattern.name,
    rawContent: finalRaw,
    context: finalContext,
    stackTrace: finalStack,
    status: "pending",
    contentHash: computeContentHash(options.service, pattern.name, rawContent),
    firstSeen: new Date().toISOString(),
  };

  appendFileSync(queuePath, JSON.stringify(event) + "\n");
  pruneQueueIfNeeded(outputDir);
  return event;
}

export function readQueue(outputDir?: string): TriggerEvent[] {
  const queuePath = getQueuePath(outputDir);

  if (!existsSync(queuePath)) {
    return [];
  }

  const content = readFileSync(queuePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const events: TriggerEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as TriggerEvent);
    } catch {
      // Skip corrupt lines rather than throwing
    }
  }
  return events;
}

export function getPendingEvents(outputDir?: string): TriggerEvent[] {
  return readQueue(outputDir).filter((e) => e.status === "pending");
}

export function clearQueue(outputDir?: string): void {
  const queuePath = getQueuePath(outputDir);

  if (existsSync(queuePath)) {
    unlinkSync(queuePath);
  }
}

export function updateEventStatus(
  eventId: string,
  status: "pending" | "processing" | "resolved" | "dismissed",
  outputDir?: string
): boolean {
  const queuePath = getQueuePath(outputDir);

  if (!existsSync(queuePath)) {
    return false;
  }

  const events = readQueue(outputDir);
  let found = false;

  const updated = events.map((e) => {
    if (e.id === eventId) {
      found = true;
      return { ...e, status } as TriggerEvent;
    }
    return e;
  });

  if (!found) return false;

  atomicWriteLines(
    queuePath,
    updated.map((e) => JSON.stringify(e))
  );
  return true;
}
