import { createInterface } from "node:readline";
import type { ErrorPattern, WatcherOptions, PatternMatch } from "./types.js";
import { matchPatterns, isStackTraceLine } from "./patterns.js";
import { createRingBuffer, DedupeCache } from "./deduper.js";
import { writeEvent } from "./queue.js";

interface StackAccumulator {
  lines: string[];
  match: PatternMatch;
  context: string[];
  timeout: NodeJS.Timeout | null;
}

export function startWatcher(options: WatcherOptions): void {
  const contextBuffer = createRingBuffer<string>(options.contextLines);
  const dedupeCache = new DedupeCache(options.dedupeWindowMs);
  let stackAccumulator: StackAccumulator | null = null;

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  function flushStackTrace(): void {
    if (!stackAccumulator) return;

    if (stackAccumulator.timeout) {
      clearTimeout(stackAccumulator.timeout);
    }

    const { match, context, lines } = stackAccumulator;
    const stackTrace = lines.slice(1);

    writeEvent(options, match.pattern, match.line, context, stackTrace);
    console.error(`[devmux-watch] Captured ${match.pattern.severity}: ${match.pattern.name}`);

    stackAccumulator = null;
  }

  rl.on("line", (line) => {
    if (stackAccumulator) {
      if (isStackTraceLine(line)) {
        stackAccumulator.lines.push(line);
        return;
      }
      flushStackTrace();
    }

    contextBuffer.push(line);

    const match = matchPatterns(line, options.patterns);
    if (!match) return;

    const context = contextBuffer.getAll().slice(0, -1);
    const hash = `${options.service}:${match.pattern.name}:${line}`;

    if (dedupeCache.isDuplicate(hash)) {
      return;
    }

    if (match.pattern.extractStackTrace) {
      stackAccumulator = {
        lines: [line],
        match,
        context,
        timeout: setTimeout(flushStackTrace, 500),
      };
      return;
    }

    writeEvent(options, match.pattern, line, context);
    console.error(`[devmux-watch] Captured ${match.pattern.severity}: ${match.pattern.name}`);
  });

  rl.on("close", () => {
    flushStackTrace();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    flushStackTrace();
    rl.close();
  });

  process.on("SIGINT", () => {
    flushStackTrace();
    rl.close();
  });
}
