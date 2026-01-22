#!/usr/bin/env node
import { createServer } from "./server.js";

const args = process.argv.slice(2);
const command = args[0];

function parseArgs(args: string[]): { port?: number; host?: string } {
  const result: { port?: number; host?: string } = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      result.port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--host" && args[i + 1]) {
      result.host = args[i + 1];
      i++;
    }
  }
  
  return result;
}

function printUsage(): void {
  console.log(`
devmux-telemetry-server - WebSocket server for DevMux telemetry

USAGE:
  devmux-telemetry-server <command> [options]

COMMANDS:
  start     Start the telemetry server (foreground)
  help      Show this help message

OPTIONS:
  --port <number>   Port to listen on (default: 9876)
  --host <string>   Host to bind to (default: 0.0.0.0)

EXAMPLES:
  devmux-telemetry-server start
  devmux-telemetry-server start --port 9876 --host 0.0.0.0
`);
}

async function main(): Promise<void> {
  switch (command) {
    case "start": {
      const options = parseArgs(args.slice(1));
      const server = createServer({
        port: options.port ?? 9876,
        host: options.host ?? "0.0.0.0",
      });

      process.on("SIGTERM", async () => {
        await server.stop();
        process.exit(0);
      });

      process.on("SIGINT", async () => {
        await server.stop();
        process.exit(0);
      });

      await server.start();
      break;
    }

    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;

    default:
      if (command) {
        console.error(`Unknown command: ${command}`);
      }
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
