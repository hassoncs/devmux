import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TriggerEvent, ErrorPattern, WatcherOptions } from "./types.js";
import { computeContentHash } from "./deduper.js";

const DEFAULT_OUTPUT_DIR = join(process.env.HOME ?? "~", ".opencode", "triggers");
const AUTO_PRUNE_THRESHOLD_BYTES = 50 * 1024 * 1024;
const EVENTS_TO_KEEP_AFTER_PRUNE = 10000;

export function ensureOutputDir(outputDir: string = DEFAULT_OUTPUT_DIR): string {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

export function getQueuePath(outputDir: string = DEFAULT_OUTPUT_DIR): string {
  return join(outputDir, "queue.jsonl");
}

export function pruneQueueIfNeeded(outputDir: string = DEFAULT_OUTPUT_DIR): boolean {
  const queuePath = getQueuePath(outputDir);
  
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
  
  writeFileSync(queuePath, linesToKeep.join("\n") + "\n");
  return true;
}

export function writeEvent(
  options: WatcherOptions,
  pattern: ErrorPattern,
  rawContent: string,
  context: string[],
  stackTrace?: string[]
): TriggerEvent {
  const outputDir = ensureOutputDir(options.outputDir);
  const queuePath = getQueuePath(outputDir);

  const event: TriggerEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source: `devmux:${options.service}`,
    service: options.service,
    project: options.project,
    severity: pattern.severity,
    pattern: pattern.name,
    rawContent,
    context,
    stackTrace: stackTrace && stackTrace.length > 0 ? stackTrace : undefined,
    status: "pending",
    contentHash: computeContentHash(options.service, pattern.name, rawContent),
    firstSeen: new Date().toISOString(),
  };

  appendFileSync(queuePath, JSON.stringify(event) + "\n");
  pruneQueueIfNeeded(outputDir);
  return event;
}

export function readQueue(outputDir: string = DEFAULT_OUTPUT_DIR): TriggerEvent[] {
  const queuePath = getQueuePath(outputDir);

  if (!existsSync(queuePath)) {
    return [];
  }

  const content = readFileSync(queuePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  return lines.map((line) => JSON.parse(line) as TriggerEvent);
}

export function getPendingEvents(outputDir: string = DEFAULT_OUTPUT_DIR): TriggerEvent[] {
  return readQueue(outputDir).filter((e) => e.status === "pending");
}

export function clearQueue(outputDir: string = DEFAULT_OUTPUT_DIR): void {
  const queuePath = getQueuePath(outputDir);

  if (existsSync(queuePath)) {
    unlinkSync(queuePath);
  }
}

export function updateEventStatus(
  eventId: string,
  status: "pending" | "processing" | "resolved" | "dismissed",
  outputDir: string = DEFAULT_OUTPUT_DIR
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

  writeFileSync(queuePath, updated.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return true;
}
