#!/bin/bash

# Simulate error output for testing the watcher
# Usage: ./simulate-errors.sh | node dist/watch/watcher-cli.js --service=test --project=test-project

echo "[2024-01-22 10:00:00] Starting server..."
sleep 0.5

echo "[2024-01-22 10:00:01] Connecting to database..."
sleep 0.5

echo "[2024-01-22 10:00:02] Server ready on port 3000"
sleep 0.5

echo "[2024-01-22 10:00:03] GET /api/health 200 5ms"
sleep 0.5

echo "Error: Connection refused"
echo "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1187:16)"
sleep 0.5

echo "[2024-01-22 10:00:05] GET /api/users 200 12ms"
sleep 0.5

echo "TypeError: Cannot read property 'name' of undefined"
echo "    at UserService.getUser (/app/services/user.js:42:15)"
echo "    at async Router.handle (/app/routes/users.js:15:20)"
echo "    at async Layer.handle_request (/app/node_modules/express/lib/router/layer.js:95:5)"
sleep 0.5

echo "[2024-01-22 10:00:07] POST /api/webhook 200 3ms"
sleep 0.5

# Duplicate error - should be deduped
echo "Error: Connection refused"
sleep 0.3

# Another duplicate
echo "Error: Connection refused"
sleep 0.5

echo "FATAL: Database connection lost"
sleep 0.5

echo "[2024-01-22 10:00:10] Server shutting down..."
