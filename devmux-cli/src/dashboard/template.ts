export interface DashboardService {
	name: string;
	healthy: boolean;
	port?: number;
	resolvedPort?: number;
	hasHealthCheck: boolean;
}

export interface DashboardData {
	project: string;
	instanceId: string;
	configPath: string;
	dashboardPort: number;
	services: DashboardService[];
}

export function renderDashboard(data: DashboardData): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.project}</title>
  <style>
    :root {
      --bg: #111;
      --bar-bg: #1a1a1a;
      --text: #ccc;
      --text-muted: #666;
      --border: #222;
      --accent: #007acc;
      --success: #4caf50;
      --error: #f44336;
      --muted: #444;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--text);
      font: 11px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .content-area { flex: 1; position: relative; background: #fff; }

    iframe {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      border: none;
      background: white;
      display: none;
    }

    iframe.active { display: block; }

    .empty-state {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 12px;
    }

    nav {
      height: 28px;
      background: var(--bar-bg);
      border-top: 1px solid var(--border);
      display: flex;
      align-items: stretch;
      flex-shrink: 0;
      overflow-x: auto;
      padding: 0 8px;
    }

    .tab {
      padding: 0 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      border-right: 1px solid var(--border);
      transition: background 100ms;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .tab:hover { background: #222; }
    .tab.active { background: var(--accent); color: #fff; }

    .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .dot.healthy { background: var(--success); }
    .dot.unhealthy { background: var(--error); }
    .dot.no-check { background: var(--muted); }

    .hidden { display: none !important; }
  </style>
</head>
<body>

  <div id="content" class="content-area">
    <div id="empty-state" class="empty-state">Select a service</div>
  </div>

  <nav id="bar"></nav>

  <script>
    window.__DEVMUX__ = ${JSON.stringify(data)};
  </script>

  <script>
    (function() {
      const data = window.__DEVMUX__;
      let selected = null;
      const services = data.services || [];
      const iframeCache = new Map();

      const bar = document.getElementById('bar');
      const content = document.getElementById('content');
      const emptyState = document.getElementById('empty-state');

      function init() {
        renderBar();
        if (services.length > 0) {
          const first = services.find(s => s.resolvedPort || s.port) || services[0];
          selectService(first.name);
        }
        startPolling();
      }

      function renderBar() {
        bar.innerHTML = '';
        services.forEach(s => {
          const tab = document.createElement('div');
          tab.className = 'tab' + (selected === s.name ? ' active' : '');
          tab.onclick = () => selectService(s.name);

          let dotClass = 'no-check';
          if (s.hasHealthCheck) dotClass = s.healthy ? 'healthy' : 'unhealthy';

          tab.innerHTML = '<div class="dot ' + dotClass + '"></div>' + s.name;
          bar.appendChild(tab);
        });
      }

      function selectService(name) {
        selected = name;
        const service = services.find(s => s.name === name);
        if (!service) return;

        bar.querySelectorAll('.tab').forEach((tab, i) => {
          tab.classList.toggle('active', services[i].name === name);
        });

        iframeCache.forEach(iframe => iframe.classList.remove('active'));

        const port = service.resolvedPort || service.port;
        if (!port) {
          emptyState.classList.remove('hidden');
          emptyState.textContent = name + ' (no port)';
          return;
        }

        emptyState.classList.add('hidden');

        let iframe = iframeCache.get(name);
        if (!iframe) {
          iframe = document.createElement('iframe');
          iframe.src = 'http://localhost:' + port;
          iframe.id = 'frame-' + name;
          content.appendChild(iframe);
          iframeCache.set(name, iframe);
        }

        iframe.classList.add('active');
      }

      function startPolling() {
        const poll = () => setTimeout(async () => {
          try {
            const res = await fetch('/api/status');
            const newData = await res.json();
            services.length = 0;
            services.push(...newData.services);
            renderBar();
            if (selected) {
              bar.querySelectorAll('.tab').forEach((tab, i) => {
                tab.classList.toggle('active', services[i].name === selected);
              });
            }
          } catch (e) {
            console.error('Poll error:', e);
          } finally {
            poll();
          }
        }, 5000);
        poll();
      }

      init();
    })();
  </script>
</body>
</html>`;
}
