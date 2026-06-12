#!/usr/bin/env npx tsx

import { matchPatterns, BUILTIN_PATTERN_SETS, isStackTraceLine, resolvePatterns } from "../src/watch/patterns.js";
import type { ErrorPattern, GlobalWatchConfig, ServiceWatchConfig } from "../src/watch/types.js";

interface TestCase {
  input: string;
  expectedPattern: string | null;
  description: string;
  sets: string[];
}

function getPatternsForSets(setNames: string[]): ErrorPattern[] {
  const patterns: ErrorPattern[] = [];
  for (const name of setNames) {
    const set = BUILTIN_PATTERN_SETS[name];
    if (set) patterns.push(...set);
  }
  return patterns;
}

const nodeTestCases: TestCase[] = [
  { input: "Error: Something went wrong", expectedPattern: "js-error", description: "Standard Error", sets: ["node"] },
  { input: "error: lowercase should match (case insensitive)", expectedPattern: "js-error", description: "Lowercase error", sets: ["node"] },
  { input: "    at Object.<anonymous> (/app/index.js:10:5)", expectedPattern: "js-error", description: "Stack trace line", sets: ["node"] },
  { input: "  at async Promise.all (index 0)", expectedPattern: "js-error", description: "Async stack trace", sets: ["node"] },
  { input: "TypeError: Cannot read property 'x' of undefined", expectedPattern: "type-error", description: "TypeError", sets: ["node"] },
  { input: "ReferenceError: foo is not defined", expectedPattern: "type-error", description: "ReferenceError", sets: ["node"] },
  { input: "SyntaxError: Unexpected token", expectedPattern: "type-error", description: "SyntaxError", sets: ["node"] },
  { input: "AggregateError: multiple errors", expectedPattern: "js-error", description: "AggregateError", sets: ["node"] },
  { input: "UnhandledPromiseRejectionWarning: Error", expectedPattern: "unhandled-rejection", description: "Unhandled rejection warning", sets: ["node"] },
  { input: "[unhandledRejection] Failed to connect", expectedPattern: "unhandled-rejection", description: "Unhandled rejection event", sets: ["node"] },
  { input: "Promise rejection handled", expectedPattern: null, description: "Handled rejection (no match)", sets: ["node"] },
  { input: "FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory", expectedPattern: "oom", description: "Node.js OOM", sets: ["node"] },
  { input: "java.lang.OutOfMemoryError: Java heap space", expectedPattern: "oom", description: "Java OOM", sets: ["node"] },
  { input: "Cannot allocate memory (ENOMEM)", expectedPattern: "oom", description: "ENOMEM error", sets: ["node"] },
  { input: "OOM killer invoked", expectedPattern: "oom", description: "OOM killer", sets: ["node"] },
];

const webTestCases: TestCase[] = [
  { input: 'HTTP/1.1" 500 Internal Server Error', expectedPattern: "http-5xx", description: "HTTP 500", sets: ["web"] },
  { input: 'HTTP/2 503 Service Unavailable', expectedPattern: "http-5xx", description: "HTTP 503", sets: ["web"] },
  { input: '"statusCode": 500', expectedPattern: "http-5xx", description: "JSON status code 500", sets: ["web"] },
  { input: '"status": 502', expectedPattern: "http-5xx", description: "JSON status 502", sets: ["web"] },
  { input: 'HTTP/1.1" 200 OK', expectedPattern: null, description: "HTTP 200 (success)", sets: ["web"] },
  { input: 'HTTP/1.1" 401 Unauthorized', expectedPattern: "http-4xx-important", description: "HTTP 401", sets: ["web"] },
  { input: 'HTTP/1.1" 403 Forbidden', expectedPattern: "http-4xx-important", description: "HTTP 403", sets: ["web"] },
  { input: 'HTTP/1.1" 404 Not Found', expectedPattern: "http-4xx-important", description: "HTTP 404", sets: ["web"] },
  { input: 'HTTP/1.1" 400 Bad Request', expectedPattern: null, description: "HTTP 400 (not important)", sets: ["web"] },
];

const fatalTestCases: TestCase[] = [
  { input: "FATAL: Database connection failed", expectedPattern: "fatal", description: "FATAL message", sets: ["fatal"] },
  { input: "kernel: PANIC - not syncing", expectedPattern: "fatal", description: "Kernel panic", sets: ["fatal"] },
  { input: "Segmentation fault (core dumped)", expectedPattern: "fatal", description: "Segfault", sets: ["fatal"] },
  { input: "Process received SIGKILL", expectedPattern: "fatal", description: "SIGKILL", sets: ["fatal"] },
  { input: "Caught signal SIGSEGV", expectedPattern: "fatal", description: "SIGSEGV", sets: ["fatal"] },
  { input: "fatal: not a git repository", expectedPattern: "fatal", description: "Git fatal", sets: ["fatal"] },
];

const reactTestCases: TestCase[] = [
  { input: "Uncaught Error: Minified React error #130", expectedPattern: "react-error", description: "Minified React error", sets: ["react"] },
  { input: "Error: Hydration failed because the initial UI does not match", expectedPattern: "react-error", description: "Hydration error", sets: ["react"] },
  { input: "Uncaught Error: Element type is invalid", expectedPattern: "react-error", description: "React element error", sets: ["react"] },
  { input: "Warning: Each child in a list should have a unique key", expectedPattern: null, description: "React warning (no match)", sets: ["react"] },
];

const nextjsTestCases: TestCase[] = [
  { input: "ERROR in ./src/App.tsx", expectedPattern: "webpack-error", description: "Webpack ERROR in", sets: ["nextjs"] },
  { input: "Module build failed (from ./node_modules/ts-loader)", expectedPattern: "webpack-error", description: "Module build failed", sets: ["nextjs"] },
  { input: "Failed to compile.", expectedPattern: "webpack-error", description: "Failed to compile", sets: ["nextjs"] },
  { input: "Compiled successfully.", expectedPattern: null, description: "Compiled successfully (no match)", sets: ["nextjs"] },
  { input: "There was an error while hydrating this Suspense boundary", expectedPattern: "hydration-error", description: "Suspense hydration error", sets: ["nextjs"] },
];

const databaseTestCases: TestCase[] = [
  { input: "ECONNREFUSED 127.0.0.1:5432", expectedPattern: "db-error", description: "ECONNREFUSED", sets: ["database"] },
  { input: "Connection refused by host", expectedPattern: "db-error", description: "Connection refused text", sets: ["database"] },
  { input: "MySQL Connection lost: The server closed the connection", expectedPattern: "db-error", description: "Connection lost", sets: ["database"] },
  { input: "ERROR:  deadlock detected", expectedPattern: "db-error", description: "Deadlock", sets: ["database"] },
  { input: "Connected to database successfully", expectedPattern: null, description: "Connection success (no match)", sets: ["database"] },
];

const pythonTestCases: TestCase[] = [
  { input: "Exception: Something failed", expectedPattern: "exception", description: "Generic Exception", sets: ["python"] },
  { input: "Traceback (most recent call last):", expectedPattern: "exception", description: "Python traceback", sets: ["python"] },
  { input: "java.lang.NullPointerException: null", expectedPattern: null, description: "Java NPE (no match)", sets: ["python"] },
];

const noMatchTestCases: TestCase[] = [
  { input: "[2024-01-22 10:00:00] Server starting...", expectedPattern: null, description: "Normal log line", sets: ["node", "web"] },
  { input: "GET /api/health 200 5ms", expectedPattern: null, description: "Successful request", sets: ["node", "web"] },
  { input: "Database query completed in 15ms", expectedPattern: null, description: "Normal operation", sets: ["node", "database"] },
  { input: "", expectedPattern: null, description: "Empty line", sets: ["node"] },
  { input: "info: Application started", expectedPattern: null, description: "Info message", sets: ["node"] },
];

const allTestCases = [
  ...nodeTestCases,
  ...webTestCases,
  ...fatalTestCases,
  ...reactTestCases,
  ...nextjsTestCases,
  ...databaseTestCases,
  ...pythonTestCases,
  ...noMatchTestCases,
];

const stackTraceTestCases = [
  { input: "Error: Something failed", expected: false, description: "Error line itself" },
  { input: "    at Function.Module._resolveFilename (node:internal/modules/cjs/loader:933:15)", expected: true, description: "Node.js stack frame" },
  { input: "  at Module._load (node:internal/modules/cjs/loader:778:27)", expected: true, description: "Stack frame with 2 spaces" },
  { input: "    at async Promise.all (index 0)", expected: true, description: "Async stack frame" },
  { input: "    at Object.<anonymous> (/app/index.js:10:5)", expected: true, description: "Anonymous function" },
  { input: "    at processTicksAndRejections (node:internal/process/task_queues:96:5)", expected: true, description: "Internal node frame" },
  { input: "    ... 10 more", expected: true, description: "Truncated stack indicator" },
  { input: "    ... 5 more frames", expected: true, description: "Extended truncation format" },
  { input: "at something", expected: false, description: "At without indentation" },
  { input: "This is not at all a stack trace", expected: false, description: "Natural text with 'at'" },
];

console.log("=== Pattern Set Tests ===\n");

let passed = 0;
let failed = 0;

console.log("## Testing Pattern Matching by Set\n");

for (const tc of allTestCases) {
  const patterns = getPatternsForSets(tc.sets);
  const match = matchPatterns(tc.input, patterns);
  const actualPattern = match?.pattern.name ?? null;
  const success = actualPattern === tc.expectedPattern;
  
  if (success) {
    passed++;
    console.log(`✅ [${tc.sets.join(",")}] ${tc.description}`);
  } else {
    failed++;
    console.log(`❌ [${tc.sets.join(",")}] ${tc.description}`);
    console.log(`   Input: "${tc.input.slice(0, 60)}${tc.input.length > 60 ? '...' : ''}"`);
    console.log(`   Expected: ${tc.expectedPattern ?? 'no match'}`);
    console.log(`   Actual: ${actualPattern ?? 'no match'}`);
  }
}

console.log("\n## Testing Stack Trace Detection\n");

for (const tc of stackTraceTestCases) {
  const result = isStackTraceLine(tc.input);
  const success = result === tc.expected;
  
  if (success) {
    passed++;
    console.log(`✅ ${tc.description}`);
  } else {
    failed++;
    console.log(`❌ ${tc.description}`);
    console.log(`   Input: "${tc.input}"`);
    console.log(`   Expected: ${tc.expected}, Actual: ${result}`);
  }
}

console.log("\n## Testing Pattern Resolution\n");

const globalConfig: GlobalWatchConfig = {
  patternSets: {
    "custom-nextjs": [
      { name: "nextjs-hydration-custom", regex: "Hydration.*mismatch", severity: "error" },
    ],
    "express": [
      { name: "express-error", regex: "Express error:", severity: "error" },
    ],
  },
};

const serviceConfig: ServiceWatchConfig = {
  include: ["node", "custom-nextjs"],
  exclude: ["oom"],
  overrides: {
    "js-error": "critical",
  },
  patterns: [
    { name: "custom-error", regex: "MyAppError:", severity: "warning" },
  ],
};

const resolved = resolvePatterns(globalConfig, serviceConfig);

const resolutionTests = [
  { check: () => resolved.some(p => p.name === "js-error" && p.severity === "critical"), description: "js-error severity overridden to critical" },
  { check: () => resolved.some(p => p.name === "type-error"), description: "type-error included from node set" },
  { check: () => resolved.some(p => p.name === "unhandled-rejection"), description: "unhandled-rejection included from node set" },
  { check: () => !resolved.some(p => p.name === "oom"), description: "oom excluded" },
  { check: () => resolved.some(p => p.name === "nextjs-hydration-custom"), description: "custom pattern set included" },
  { check: () => !resolved.some(p => p.name === "express-error"), description: "express set NOT included (not in include list)" },
  { check: () => resolved.some(p => p.name === "custom-error"), description: "inline custom pattern added" },
  { check: () => !resolved.some(p => p.name === "http-5xx"), description: "web patterns NOT included (web not in include)" },
  { check: () => !resolved.some(p => p.name === "fatal"), description: "fatal NOT included (fatal not in include)" },
];

for (const test of resolutionTests) {
  if (test.check()) {
    passed++;
    console.log(`✅ ${test.description}`);
  } else {
    failed++;
    console.log(`❌ ${test.description}`);
  }
}

console.log("\n## Testing Built-in Pattern Sets Exist\n");

const expectedSets = ["node", "web", "react", "nextjs", "database", "fatal", "python"];
for (const setName of expectedSets) {
  if (BUILTIN_PATTERN_SETS[setName] && BUILTIN_PATTERN_SETS[setName].length > 0) {
    passed++;
    console.log(`✅ ${setName} pattern set exists (${BUILTIN_PATTERN_SETS[setName].length} patterns)`);
  } else {
    failed++;
    console.log(`❌ ${setName} pattern set missing or empty`);
  }
}

console.log("\n=== Test Summary ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
console.log(`Coverage: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log("\n⚠️ Some tests failed. Review patterns or test cases.");
  process.exit(1);
} else {
  console.log("\n✅ All tests passed!");
}
