import { execSync, spawn, ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { LogPayload } from "./protocol.js";
import type { Session } from "./session.js";
import { formatLogForTmux, formatLogForQueue } from "./formatter.js";
import { SeverityNumber } from "./protocol.js";

const DEFAULT_OUTPUT_DIR = join(process.env.HOME ?? "~", ".opencode", "triggers");
const AUTO_PRUNE_THRESHOLD_BYTES = 50 * 1024 * 1024;
const EVENTS_TO_KEEP_AFTER_PRUNE = 10000;

interface TmuxStream {
  sessionName: string;
  process: ChildProcess | null;
}

export class Router {
  private tmuxStreams = new Map<string, TmuxStream>();
  private outputDir: string;

  constructor(outputDir: string = DEFAULT_OUTPUT_DIR) {
    this.outputDir = outputDir;
    this.ensureOutputDir();
  }

  private ensureOutputDir(): void {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  private hasTmuxSession(sessionName: string): boolean {
    try {
      execSync(`tmux has-session -t "${sessionName}"`, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }

  private createTmuxSession(sessionName: string): boolean {
    try {
      execSync(
        `tmux new-session -d -s "${sessionName}" -x 200 -y 50 'cat'`,
        { stdio: ["pipe", "pipe", "pipe"] }
      );
      execSync(`tmux set-option -t "${sessionName}" remain-on-exit on`, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }

  private sendToTmux(sessionName: string, content: string): void {
    try {
      const escaped = content.replace(/'/g, "'\\''");
      execSync(`tmux send-keys -t "${sessionName}" '${escaped}' Enter`, {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Session might have been closed
    }
  }

  ensureStream(session: Session): void {
    const { streamName } = session;

    if (this.tmuxStreams.has(streamName)) {
      return;
    }

    const sessionName = `telemetry-${streamName.replace(/[^a-zA-Z0-9-]/g, "-")}`;

    if (!this.hasTmuxSession(sessionName)) {
      this.createTmuxSession(sessionName);
    }

    this.tmuxStreams.set(streamName, {
      sessionName,
      process: null,
    });

    this.sendToTmux(
      sessionName,
      `\x1b[36m━━━ Telemetry stream: ${streamName} ━━━\x1b[0m`
    );
    this.sendToTmux(
      sessionName,
      `\x1b[90mConnected at ${new Date().toISOString()}\x1b[0m`
    );
    this.sendToTmux(sessionName, "");
  }

  closeStream(streamName: string): void {
    const stream = this.tmuxStreams.get(streamName);
    if (!stream) return;

    this.sendToTmux(
      stream.sessionName,
      `\n\x1b[90m━━━ Disconnected at ${new Date().toISOString()} ━━━\x1b[0m`
    );

    this.tmuxStreams.delete(streamName);
  }

  routeLog(session: Session, log: LogPayload): void {
    const stream = this.tmuxStreams.get(session.streamName);

    if (stream) {
      const formatted = formatLogForTmux(log, session.streamName);
      this.sendToTmux(stream.sessionName, formatted);
    }

    this.writeToQueue(session, log);
  }

  private writeToQueue(session: Session, log: LogPayload): void {
    const queuePath = join(this.outputDir, "queue.jsonl");

    const severity = this.mapSeverity(log.severityNumber);
    const pattern = log.exception
      ? log.exception.isUnhandled
        ? "telemetry-unhandled"
        : "telemetry-error"
      : "telemetry-console";

    const rawContent = formatLogForQueue(log);
    const contentHash = this.computeContentHash(
      session.streamName,
      pattern,
      rawContent
    );

    const event = {
      id: randomUUID(),
      timestamp: new Date(log.timestamp).toISOString(),
      source: `telemetry:${session.streamName}`,
      service: session.streamName,
      project: "telemetry",
      severity,
      pattern,
      rawContent,
      context: [],
      stackTrace: log.exception?.stacktrace?.split("\n"),
      status: "pending",
      contentHash,
      firstSeen: new Date(log.timestamp).toISOString(),
    };

    appendFileSync(queuePath, JSON.stringify(event) + "\n");
    this.pruneQueueIfNeeded(queuePath);
  }

  private pruneQueueIfNeeded(queuePath: string): void {
    if (!existsSync(queuePath)) {
      return;
    }

    const stats = statSync(queuePath);
    if (stats.size < AUTO_PRUNE_THRESHOLD_BYTES) {
      return;
    }

    const content = readFileSync(queuePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const linesToKeep = lines.slice(-EVENTS_TO_KEEP_AFTER_PRUNE);
    
    writeFileSync(queuePath, linesToKeep.join("\n") + "\n");
  }

  private mapSeverity(
    severityNumber: number
  ): "info" | "warning" | "error" | "critical" {
    if (severityNumber >= SeverityNumber.FATAL) {
      return "critical";
    }
    if (severityNumber >= SeverityNumber.ERROR) {
      return "error";
    }
    if (severityNumber >= SeverityNumber.WARN) {
      return "warning";
    }
    return "info";
  }

  private computeContentHash(
    service: string,
    patternName: string,
    content: string
  ): string {
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

  getActiveStreams(): Array<{ name: string; tmuxSession: string }> {
    return Array.from(this.tmuxStreams.entries()).map(([name, stream]) => ({
      name,
      tmuxSession: stream.sessionName,
    }));
  }
}
