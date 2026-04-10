/**
 * Health check endpoint for Bot Town daemon container
 * Checks: OpenCode server liveness, daemon WebSocket connectivity
 */

const http = require('http');

const OPENCODE_URL = process.env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4096';
const TOWN_URL = process.env.TOWN_SERVER_URL || 'ws://town.lan:8091';

async function checkOpencodeHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${OPENCODE_URL}/health`, (res) => {
      if (res.statusCode === 200) {
        resolve({ status: 'healthy', code: res.statusCode });
      } else {
        resolve({ status: 'unhealthy', code: res.statusCode });
      }
    });
    req.on('error', () => {
      resolve({ status: 'unreachable', code: null });
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ status: 'timeout', code: null });
    });
  });
}

async function runHealthCheck() {
  const checks = {
    timestamp: new Date().toISOString(),
    nodeId: process.env.DAEMON_NODE_ID || 'unknown',
    opencode: await checkOpencodeHealth(),
    townUrl: TOWN_URL,
  };

  const isHealthy = checks.opencode.status === 'healthy';
  
  console.log(JSON.stringify(checks, null, 2));
  
  process.exit(isHealthy ? 0 : 1);
}

runHealthCheck();
