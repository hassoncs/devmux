import { createHash } from "node:crypto";

export function computeContentHash(service: string, patternName: string, content: string): string {
  const normalized = content
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "TIMESTAMP")
    .replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/g, "TIMESTAMP")
    .replace(/:\d+:\d+/g, ":LINE:COL")
    .replace(/0x[0-9a-f]+/gi, "0xADDR")
    .replace(/\b\d{5,}\b/g, "NUM");

  return createHash("sha256")
    .update(`${service}:${patternName}:${normalized}`)
    .digest("hex")
    .slice(0, 16);
}

export interface RingBuffer<T> {
  push(item: T): void;
  getAll(): T[];
  clear(): void;
}

export function createRingBuffer<T>(capacity: number): RingBuffer<T> {
  const buffer: T[] = [];
  let writeIndex = 0;
  let full = false;

  return {
    push(item: T): void {
      if (buffer.length < capacity) {
        buffer.push(item);
      } else {
        buffer[writeIndex] = item;
        full = true;
      }
      writeIndex = (writeIndex + 1) % capacity;
    },

    getAll(): T[] {
      if (!full) return [...buffer];

      const result: T[] = [];
      for (let i = 0; i < capacity; i++) {
        result.push(buffer[(writeIndex + i) % capacity]);
      }
      return result;
    },

    clear(): void {
      buffer.length = 0;
      writeIndex = 0;
      full = false;
    },
  };
}

export class DedupeCache {
  private cache = new Map<string, number>();
  private windowMs: number;
  private maxSize: number;

  constructor(windowMs: number, maxSize: number = 1000) {
    this.windowMs = windowMs;
    this.maxSize = maxSize;
  }

  isDuplicate(hash: string): boolean {
    const now = Date.now();
    const lastSeen = this.cache.get(hash);

    if (lastSeen && now - lastSeen < this.windowMs) {
      this.cache.set(hash, now);
      return true;
    }

    this.cache.set(hash, now);
    this.cleanup(now);
    return false;
  }

  private cleanup(now: number): void {
    if (this.cache.size <= this.maxSize) return;

    const cutoff = now - this.windowMs * 2;
    for (const [hash, timestamp] of this.cache) {
      if (timestamp < cutoff) {
        this.cache.delete(hash);
      }
    }
  }
}
