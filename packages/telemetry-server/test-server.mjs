#!/usr/bin/env node

import { createServer } from "./dist/index.js";

const server = createServer({ port: 9876, host: "0.0.0.0" });

server.start().then(() => {
  console.log("Test server running on ws://0.0.0.0:9876");
  console.log("Press Ctrl+C to stop");
});

process.on("SIGINT", () => {
  console.log("\nStopping...");
  server.stop().then(() => {
    console.log("Stopped");
    process.exit(0);
  });
});
