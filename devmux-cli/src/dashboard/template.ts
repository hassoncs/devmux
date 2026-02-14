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
      --sidebar-bg: #1a1a1a;
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
      overflow: hidden;
    }

    aside {
      width: 140px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .sidebar-header {
      padding: 6px 8px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }

    .sidebar-services { flex: 1; overflow-y: auto; }

    .service-row {
      padding: 5px 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      border-bottom: 1px solid var(--border);
      transition: background 100ms;
    }

    .service-row:hover { background: #222; }
    .service-row.active { background: var(--accent); color: #fff; }

    .status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.healthy { background: var(--success); }
    .status-dot.unhealthy { background: var(--error); }
    .status-dot.no-check { background: var(--muted); }

    .service-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .service-row.active .service-name { font-weight: 500; }

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

    .hidden { display: none !important; }
  </style>
</head>
<body>

  <aside>
    <div class="sidebar-header">${data.project}</div>
    <div id="sidebar" class="sidebar-services"></div>
  </aside>

  <div id="content" class="content-area">
    <div id="empty-state" class="empty-state">Select a service</div>
  </div>

  <script>
    window.__DEVMUX__ = ${JSON.stringify(data)};
  </script>

  <script>
    (function() {
      const data = window.__DEVMUX__;
      let selected = null;
      const services = data.services || [];
      const iframeCache = new Map();

      const sidebar = document.getElementById('sidebar');
      const content = document.getElementById('content');
      const emptyState = document.getElementById('empty-state');

      function init() {
        renderSidebar();
        if (services.length > 0) {
          const first = services.find(s => s.resolvedPort || s.port) || services[0];
          selectService(first.name);
        }
        startPolling();
      }

      function renderSidebar() {
        sidebar.innerHTML = '';
        services.forEach(s => {
          const row = document.createElement('div');
          row.className = 'service-row' + (selected === s.name ? ' active' : '');
          row.onclick = () => selectService(s.name);

          let dotClass = 'no-check';
          if (s.hasHealthCheck) dotClass = s.healthy ? 'healthy' : 'unhealthy';

          row.innerHTML = '<div class="status-dot ' + dotClass + '"></div>' +
                          '<div class="service-name">' + s.name + '</div>';
          sidebar.appendChild(row);
        });
      }

      function selectService(name) {
        selected = name;
        const service = services.find(s => s.name === name);
        if (!service) return;

        sidebar.querySelectorAll('.service-row').forEach((row, i) => {
          row.classList.toggle('active', services[i].name === name);
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
            renderSidebar();
            if (selected) {
              sidebar.querySelectorAll('.service-row').forEach((row, i) => {
                row.classList.toggle('active', services[i].name === selected);
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
