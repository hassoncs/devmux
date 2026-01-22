#!/usr/bin/env npx tsx

import { Readable } from "node:stream";
import { createRingBuffer, DedupeCache, computeContentHash } from "../src/watch/deduper.js";
import { matchPatterns, BUILTIN_PATTERN_SETS, isStackTraceLine } from "../src/watch/patterns.js";

console.log("=== Testing Watcher Components ===\n");

console.log("1. Testing Ring Buffer");
const buffer = createRingBuffer<string>(5);
for (let i = 1; i <= 7; i++) {
  buffer.push(`line ${i}`);
}
const bufferContent = buffer.getAll();
console.log("   After pushing 7 items to buffer of size 5:");
console.log("   ", bufferContent);
console.log("   Expected: [line 3, line 4, line 5, line 6, line 7]");
console.log("   Pass:", JSON.stringify(bufferContent) === JSON.stringify(["line 3", "line 4", "line 5", "line 6", "line 7"]) ? "✅" : "❌");
console.log();

console.log("2. Testing Deduplication");
const deduper = new DedupeCache(1000);
const hash1 = computeContentHash("api", "js-error", "Error: Something went wrong");
const hash2 = computeContentHash("api", "js-error", "Error: Something went wrong");
const hash3 = computeContentHash("api", "js-error", "Error: Different error");
console.log("   Same content produces same hash:", hash1 === hash2 ? "✅" : "❌");
console.log("   Different content produces different hash:", hash1 !== hash3 ? "✅" : "❌");

const isDup1 = deduper.isDuplicate(hash1);
const isDup2 = deduper.isDuplicate(hash1);
console.log("   First occurrence is NOT duplicate:", !isDup1 ? "✅" : "❌");
console.log("   Second occurrence IS duplicate:", isDup2 ? "✅" : "❌");
console.log();

console.log("3. Testing Pattern Matching");
const allPatterns = Object.values(BUILTIN_PATTERN_SETS).flat();
const testLines = [
  "2024-01-22 10:00:00 Server starting...",
  "Error: Connection refused",
  "TypeError: Cannot read property 'foo' of undefined",
  "  at Object.<anonymous> (/app/index.js:10:5)",
  "HTTP/1.1 500 Internal Server Error",
  "FATAL: Database connection failed",
  "Everything is fine, just a log message",
  "Uncaught Error: React component crashed",
];

for (const line of testLines) {
  const match = matchPatterns(line, allPatterns);
  if (match) {
    console.log(`   ✅ "${line.slice(0, 50)}..." → ${match.pattern.name} (${match.pattern.severity})`);
  } else {
    console.log(`   ⚪ "${line.slice(0, 50)}..." → no match`);
  }
}
console.log();

console.log("4. Testing Stack Trace Detection");
const stackLines = [
  "Error: Something failed",
  "    at Function.Module._resolveFilename (node:internal/modules/cjs/loader:933:15)",
  "    at Module._load (node:internal/modules/cjs/loader:778:27)",
  "    ... 5 more",
  "This is not a stack trace line",
];

for (const line of stackLines) {
  const isStack = isStackTraceLine(line);
  console.log(`   ${isStack ? "📚" : "  "} "${line.slice(0, 60)}..." → ${isStack ? "stack trace" : "not stack"}`);
}
console.log();

console.log("=== All Tests Complete ===");
