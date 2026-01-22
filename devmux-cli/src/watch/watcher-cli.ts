#!/usr/bin/env node

import { startWatcher } from "./watcher.js";
import type { WatcherOptions, ErrorPattern } from "./types.js";

function parseArgs(): WatcherOptions {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      options[key] = value ?? "true";
    }
  }

  const patterns: ErrorPattern[] = options.patterns 
    ? JSON.parse(options.patterns) 
    : [];

  return {
    service: options.service ?? "unknown",
    project: options.project ?? "unknown",
    sessionName: options.session ?? "unknown",
    outputDir: options.output ?? `${process.env.HOME}/.opencode/triggers`,
    patterns,
    dedupeWindowMs: parseInt(options.dedupe ?? "5000"),
    contextLines: parseInt(options.context ?? "20"),
  };
}

const options = parseArgs();
startWatcher(options);
