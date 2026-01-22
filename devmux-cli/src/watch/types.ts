export interface ErrorPattern {
  name: string;
  regex: string;
  severity: "info" | "warning" | "error" | "critical";
  extractStackTrace?: boolean;
}

export interface PatternSet {
  [name: string]: ErrorPattern[];
}

export interface GlobalWatchConfig {
  enabled?: boolean;
  outputDir?: string;
  dedupeWindowMs?: number;
  contextLines?: number;
  patternSets?: PatternSet;
}

export interface ServiceWatchConfig {
  enabled?: boolean;
  include?: string[];
  exclude?: string[];
  patterns?: ErrorPattern[];
  overrides?: Record<string, "info" | "warning" | "error" | "critical">;
}

export interface TriggerEvent {
  id: string;
  timestamp: string;
  source: string;
  service: string;
  project: string;
  severity: "info" | "warning" | "error" | "critical";
  pattern: string;
  rawContent: string;
  context: string[];
  stackTrace?: string[];
  status: "pending";
  contentHash: string;
  firstSeen: string;
}

export interface ServiceWatchState {
  service: string;
  sessionName: string;
  pipeActive: boolean;
  startedAt?: string;
  lastError?: string;
}

export interface WatcherOptions {
  service: string;
  project: string;
  sessionName: string;
  outputDir: string;
  patterns: ErrorPattern[];
  dedupeWindowMs: number;
  contextLines: number;
}

export interface PatternMatch {
  pattern: ErrorPattern;
  line: string;
}
