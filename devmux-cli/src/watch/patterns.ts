import type { ErrorPattern, PatternMatch, GlobalWatchConfig, ServiceWatchConfig } from "./types.js";

export const BUILTIN_PATTERN_SETS: Record<string, ErrorPattern[]> = {
  node: [
    { name: "unhandled-rejection", regex: "UnhandledPromiseRejection|unhandledRejection", severity: "critical", extractStackTrace: true },
    { name: "oom", regex: "out of memory|OutOfMemoryError|heap out of memory|ENOMEM|OOM killer", severity: "critical" },
    { name: "type-error", regex: "TypeError:|ReferenceError:|SyntaxError:", severity: "error", extractStackTrace: true },
    { name: "js-error", regex: "^Error:|^\\w*Error:|^\\s+at\\s+", severity: "error", extractStackTrace: true },
  ],
  web: [
    { name: "http-5xx", regex: "HTTP/[\\d.]+[\"'\\s]+5\\d{2}|\"(status|statusCode)\":\\s*5\\d{2}", severity: "error" },
    { name: "http-4xx-important", regex: "HTTP/[\\d.]+[\"'\\s]+40[134]", severity: "warning" },
  ],
  react: [
    { name: "react-error", regex: "Uncaught Error:|Error: Minified React|Hydration failed", severity: "error", extractStackTrace: true },
  ],
  nextjs: [
    { name: "webpack-error", regex: "^ERROR in|Module build failed|Failed to compile", severity: "error" },
    { name: "hydration-error", regex: "Hydration failed|Text content does not match|There was an error while hydrating", severity: "error" },
  ],
  database: [
    { name: "db-error", regex: "ECONNREFUSED|connection refused|Connection lost|\\bdeadlock\\b", severity: "error" },
  ],
  fatal: [
    { name: "fatal", regex: "\\bFATAL\\b|\\bPANIC\\b|Segmentation fault|SIGKILL|SIGSEGV", severity: "critical" },
  ],
  python: [
    { name: "exception", regex: "^Exception:|Traceback \\(most recent", severity: "error", extractStackTrace: true },
  ],
};

const compiledPatterns = new Map<string, RegExp>();

function getCompiledRegex(pattern: ErrorPattern): RegExp {
  const cached = compiledPatterns.get(pattern.regex);
  if (cached) return cached;

  const compiled = new RegExp(pattern.regex, "i");
  compiledPatterns.set(pattern.regex, compiled);
  return compiled;
}

export function matchPatterns(line: string, patterns: ErrorPattern[]): PatternMatch | null {
  for (const pattern of patterns) {
    const regex = getCompiledRegex(pattern);
    if (regex.test(line)) {
      return { pattern, line };
    }
  }
  return null;
}

export function resolvePatterns(
  globalConfig: GlobalWatchConfig | undefined,
  serviceConfig: ServiceWatchConfig | undefined
): ErrorPattern[] {
  const patterns: ErrorPattern[] = [];
  const excludes = new Set(serviceConfig?.exclude ?? []);
  const overrides = serviceConfig?.overrides ?? {};

  for (const setName of serviceConfig?.include ?? []) {
    const builtinSet = BUILTIN_PATTERN_SETS[setName];
    const customSet = globalConfig?.patternSets?.[setName];
    const set = builtinSet ?? customSet;

    if (!set) continue;

    for (const p of set) {
      if (excludes.has(p.name)) continue;
      patterns.push({
        ...p,
        severity: overrides[p.name] ?? p.severity,
      });
    }
  }

  for (const p of serviceConfig?.patterns ?? []) {
    patterns.push(p);
  }

  return patterns;
}

export function isStackTraceLine(line: string): boolean {
  return /^\s+at\s+/.test(line) || /^\s+\.\.\.\s*\d+\s*more/.test(line);
}
