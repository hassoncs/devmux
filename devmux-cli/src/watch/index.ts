export type {
  ErrorPattern,
  PatternSet,
  GlobalWatchConfig,
  ServiceWatchConfig,
  TriggerEvent,
  ServiceWatchState,
  WatcherOptions,
  PatternMatch,
} from "./types.js";

export { BUILTIN_PATTERN_SETS, matchPatterns, resolvePatterns, isStackTraceLine } from "./patterns.js";

export { computeContentHash, createRingBuffer, DedupeCache } from "./deduper.js";

export {
  ensureOutputDir,
  getQueuePath,
  writeEvent,
  readQueue,
  getPendingEvents,
  clearQueue,
  updateEventStatus,
} from "./queue.js";

export { startWatcher } from "./watcher.js";

export {
  getWatcherStatus,
  getAllWatcherStatuses,
  startWatcher as startServiceWatcher,
  stopWatcher as stopServiceWatcher,
  startAllWatchers,
  stopAllWatchers,
} from "./manager.js";
