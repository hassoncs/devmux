#!/usr/bin/env node

import { join } from "node:path";
import { homedir } from "node:os";
import { startWatcher } from "./watcher.js";
import type { WatcherOptions, ErrorPattern } from "./types.js";

function parseArgs(): WatcherOptions {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith("--")) {
      // Split on the FIRST '=' only — values (e.g. patterns JSON) may
      // themselves contain '='.
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq === -1) {
        options[body] = "true";
      } else {
        options[body.slice(0, eq)] = body.slice(eq + 1);
      }
    }
  }

  const patterns: ErrorPattern[] = options.patterns
    ? JSON.parse(options.patterns)
    : [];

  return {
    service: options.service ?? "unknown",
    project: options.project ?? "unknown",
    sessionName: options.session ?? "unknown",
    outputDir: options.output ?? join(homedir(), ".devmux"),
    patterns,
    redact: options.redact !== "false",
    dedupeWindowMs: parseInt(options.dedupe ?? "5000"),
    contextLines: parseInt(options.context ?? "20"),
  };
}

const options = parseArgs();
startWatcher(options);
