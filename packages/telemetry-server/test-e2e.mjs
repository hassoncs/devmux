#!/usr/bin/env node

import { createServer } from "./dist/index.js";
import { WebSocket } from "ws";

const PROTOCOL_NAME = "devmux-telemetry";
const PROTOCOL_VERSION = 1;

async function runTest() {
  console.log("=== DevMux Telemetry E2E Test ===\n");

  const server = createServer({ port: 9876, host: "127.0.0.1" });
  await server.start();
  console.log("✓ Server started\n");

  const ws = new WebSocket("ws://127.0.0.1:9876");

  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("Connection timeout")), 5000);
  });
  console.log("✓ Client connected\n");

  const clientId = "test-client-" + Date.now();

  ws.send(JSON.stringify({
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    type: "hello",
    payload: {
      resource: {
        "service.name": "test-app",
        "service.version": "1.0.0",
        "telemetry.sdk.name": "@chriscode/devmux-telemetry",
        "telemetry.sdk.version": "0.1.0",
      },
      platform: {
        kind: "browser",
        os: "web",
        url: "http://localhost:3000",
        userAgent: "Test/1.0",
      },
    },
    meta: {
      clientId,
      timestamp: Date.now(),
    },
  }));

  const helloResponse = await new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
    setTimeout(() => reject(new Error("Hello response timeout")), 5000);
  });

  console.log("✓ Hello acknowledged");
  console.log(`  Session ID: ${helloResponse.payload.sessionId}`);
  console.log(`  Stream: ${helloResponse.payload.streamName}\n`);

  const sessionId = helloResponse.payload.sessionId;

  ws.send(JSON.stringify({
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    type: "log",
    payload: {
      timestamp: Date.now(),
      severityNumber: 9,
      severityText: "info",
      body: "Hello from test client!",
    },
    meta: {
      clientId,
      sessionId,
      timestamp: Date.now(),
    },
  }));
  console.log("✓ Sent info log\n");

  ws.send(JSON.stringify({
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    type: "log",
    payload: {
      timestamp: Date.now(),
      severityNumber: 13,
      severityText: "warn",
      body: ["Warning:", { code: 123, message: "Something is off" }],
    },
    meta: {
      clientId,
      sessionId,
      timestamp: Date.now(),
    },
  }));
  console.log("✓ Sent warning log\n");

  ws.send(JSON.stringify({
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    type: "log",
    payload: {
      timestamp: Date.now(),
      severityNumber: 17,
      severityText: "error",
      body: "Something went wrong!",
      exception: {
        type: "TypeError",
        message: "Cannot read property 'foo' of undefined",
        stacktrace: "TypeError: Cannot read property 'foo' of undefined\n    at test.js:10:5\n    at main.js:20:10",
        isUnhandled: true,
      },
    },
    meta: {
      clientId,
      sessionId,
      timestamp: Date.now(),
    },
  }));
  console.log("✓ Sent error log with exception\n");

  await new Promise(r => setTimeout(r, 500));

  const status = server.getStatus();
  console.log("Server Status:");
  console.log(`  Running: ${status.running}`);
  console.log(`  Sessions: ${status.sessionCount}`);
  if (status.sessions.length > 0) {
    const s = status.sessions[0];
    console.log(`  Stream: ${s.streamName}`);
    console.log(`  Events: ${s.eventCount}\n`);
  }

  ws.send(JSON.stringify({
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    type: "goodbye",
    payload: { reason: "test-complete" },
    meta: {
      clientId,
      sessionId,
      timestamp: Date.now(),
    },
  }));

  ws.close();
  console.log("✓ Client disconnected\n");

  await new Promise(r => setTimeout(r, 200));

  await server.stop();
  console.log("✓ Server stopped\n");

  console.log("=== All tests passed! ===");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
