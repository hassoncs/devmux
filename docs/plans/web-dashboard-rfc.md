# RFC: devmux Web Dashboard

**Status**: Draft
**Author**: Antigravity
**Date**: 2026-02-12
**Target**: devmux-cli

## 1. Problem Statement

As projects grow, the number of microservices and support tools (API, Metro, Storybook, DB proxies, etc.) increases. Managing 10+ services via CLI status checks becomes cognitively expensive. 

While `devmux status` provides a great snapshot, developers often need to:
1. Verify that a specific service is up and accessible in the browser.
2. Quickly switch between multiple web-based services (e.g., toggling between the App, Storybook, and a local DB admin UI).
3. Have a "mission control" view that stays open in a pinned tab, providing passive health monitoring without context-switching to a terminal.

Existing solutions are either too heavy (React-based dashboards) or too limited (CLI-only). We need a "tmux for web services" that remains as lightweight as devmux itself.

## 2. Proposed Solution

We propose a `devmux dashboard` command that launches a tiny, zero-dependency web server. This server serves a single-page application (SPA) that acts as a visual wrapper for the project's services.

**Key Features:**
- **Zero Build Step**: The dashboard is a single HTML file with inline CSS and vanilla JS. No `node_modules` for the frontend.
- **Iframe-First**: The UI is a slim sidebar with the rest of the viewport dedicated to an iframe containing the active service.
- **Health-at-a-Glance**: Real-time (polling) status dots for all services.
- **Native devmux Integration**: Reuses the existing `devmux.config.json` and programmatic APIs.

## 3. Architecture

### Server-Side
The dashboard server will live in `devmux-cli/src/commands/dashboard.ts`. It will use the Node.js native `http` module to avoid new dependencies.

```typescript
// Sketch: devmux-cli/src/commands/dashboard.ts
import http from 'http';
import { getAllStatus, loadConfig } from '../api';

export async function startDashboard(port = 9000) {
  const config = await loadConfig();
  
  const server = http.createServer((req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getAllStatus()));
      return;
    }

    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DASHBOARD_HTML_TEMPLATE(config));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    console.log(`🚀 devmux dashboard running at http://localhost:${port}`);
  });
}
```

### Data Flow
1. **CLI** launches the server.
2. **Browser** loads the HTML template.
3. **Frontend JS** starts a 5-second interval timer.
4. **Frontend JS** fetches `/api/status` and updates the sidebar status dots.
5. **User** clicks a service; the iframe's `src` is updated to the service's port.

## 4. UI Design

### Wireframe (ASCII)
```
__________________________________________________________________________
| devmux — slopcade [ 8/10 ]                                         [?] |
|________________________________________________________________________|
|              |                                                         |
| 🟢 api:8789  |                                                         |
| 🟢 metro:8085|                                                         |
| 🔴 story:6007|                MAIN IFRAME AREA                         |
| 🟡 auth:3000 |                                                         |
| ⚪️ db:none   |            (Displays active service)                    |
|              |                                                         |
|              |                                                         |
|              |                                                         |
|              |                                                         |
|______________|_________________________________________________________|
| Dashboard: 9000 | Config: ~/work/slopcade/devmux.config.json           |
|________________________________________________________________________|
```

### Frontend Sketch (HTML/JS)
```html
<style>
  body { display: flex; flex-direction: column; height: 100vh; margin: 0; font-family: sans-serif; background: #1a1a1a; color: #eee; }
  #header { height: 40px; background: #222; border-bottom: 1px solid #333; display: flex; align-items: center; padding: 0 15px; }
  #main { flex: 1; display: flex; overflow: hidden; }
  #sidebar { width: 220px; background: #252525; border-right: 1px solid #333; overflow-y: auto; }
  #content { flex: 1; background: #fff; position: relative; }
  iframe { width: 100%; height: 100%; border: none; }
  .service-row { padding: 10px 15px; cursor: pointer; border-bottom: 1px solid #333; display: flex; align-items: center; }
  .service-row:hover { background: #333; }
  .service-row.active { background: #007acc; color: white; }
  .dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 10px; }
  .green { background: #4caf50; box-shadow: 0 0 5px #4caf50; }
  .red { background: #f44336; }
  .yellow { background: #ffeb3b; }
  .gray { background: #9e9e9e; }
</style>

<script>
  async function pollStatus() {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateUI(data);
  }
  setInterval(pollStatus, 5000);
  
  function selectService(name, url) {
    document.querySelector('iframe').src = url;
    // Update active class logic...
  }
</script>
```

## 5. iframe Considerations

Security headers often prevent embedding:
- **X-Frame-Options: DENY / SAMEORIGIN**: Many modern frameworks (and local dev servers) might block embedding.
- **Fallback Mechanism**: If the iframe fails to load or the user clicks a "Terminal-only" service (e.g., a DB proxy with no web UI), the dashboard should display a fallback screen:
  > **Cannot embed this service.**
  > [Open in new tab: http://localhost:8085]
  > [Attach in terminal: devmux attach metro]

## 6. CLI Integration

The dashboard should be accessible via a dedicated command:

- `devmux dashboard`: Starts server on default 9000 and opens browser.
- `devmux dashboard --port 9001`: Custom port.
- `devmux dashboard --no-open`: Start server without launching the browser.

We can also add an optional config block to `devmux.config.json`:
```json
{
  "dashboard": {
    "enabled": true,
    "port": 9000,
    "autoOpen": true
  }
}
```

## 7. Scope & Non-Goals

### In Scope
- Visual status dashboard.
- Iframe-based service switching.
- Health polling (5s interval).
- Minimalist, zero-build frontend.

### Non-Goals
- **Service Control**: We will NOT add Start/Stop buttons in V1 to keep the server side stateless and simple.
- **Log Viewing**: Log streaming is complex (WebSockets/SSE). Users should still use `devmux attach` for deep debugging.
- **Config Editing**: The dashboard is read-only.

## 8. Implementation Estimate

- **Frontend (HTML/CSS/JS)**: ~250 lines. Focus on CSS layout and polling logic. (4 hours)
- **Dashboard Server**: ~100 lines. Routing and serving the static template. (2 hours)
- **API Endpoint**: ~50 lines. Mapping `getAllStatus()` to JSON. (1 hour)
- **CLI Command**: Wiring up the `commander` action. (1 hour)
- **Total**: ~1 working day.

## 9. Alternatives Considered

1. **Full React/Next.js App**: Rejected. Increases bundle size and requires a build step for devmux-cli contributors.
2. **Terminal UI (TUI)**: Rejected. We already have `devmux status`. A TUI cannot embed browser-based services.
3. **VS Code Extension**: Rejected. Limits the dashboard to VS Code users only. devmux should remain editor-agnostic.

## 10. Open Questions

1. **Auto-start**: Should the dashboard automatically start when `devmux run` is called? Or should it remain an explicit opt-in?
2. **Telemetry Integration**: Should we leverage the existing `telemetry-server` to provide real-time status updates instead of polling?
3. **Deep Linking**: Should services be able to define a specific `dashboardPath` (e.g., `/admin`) that differs from their root URL?
