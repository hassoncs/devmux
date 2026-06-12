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
      padding: 0;
    }

    .bar-info {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 10px;
      min-width: 0;
      overflow: hidden;
      border-right: 1px solid var(--border);
      flex-shrink: 1;
    }

    .bar-info-label {
      color: var(--text-muted);
      font-size: 10px;
      flex-shrink: 0;
    }

    .bar-info-url {
      color: var(--text-muted);
      font-size: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.7;
      user-select: all;
    }

    .bar-spacer { flex: 1; }

    .bar-tabs {
      display: flex;
      align-items: stretch;
      overflow-x: auto;
      flex-shrink: 0;
    }

    .tab {
      padding: 0 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      border-left: 1px solid var(--border);
      transition: background 100ms;
      white-space: nowrap;
      flex-shrink: 0;
      position: relative;
    }

    .tab:hover { background: #222; }
    .tab.active { background: var(--accent); color: #fff; }

    .tab-port {
      font-size: 9px;
      color: var(--text-muted);
      opacity: 0.7;
    }
    .tab.active .tab-port { color: rgba(255,255,255,0.6); }

    .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .dot.healthy { background: var(--success); }
    .dot.unhealthy { background: var(--error); }
    .dot.no-check { background: var(--muted); }

    .tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: #2a2a2a;
      border: 1px solid #3a3a3a;
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 10px;
      line-height: 1.5;
      white-space: nowrap;
      color: var(--text);
      pointer-events: none;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }

    .tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 4px solid transparent;
      border-top-color: #3a3a3a;
    }

    .tab:hover .tooltip { display: block; }

    .tooltip-row {
      display: flex;
      gap: 6px;
    }

    .tooltip-key { color: var(--text-muted); }

    .hidden { display: none !important; }
  </style>
</head>
<body>

  <div id="content" class="content-area">
    <div id="empty-state" class="empty-state">Select a service</div>
  </div>

  <nav id="bar">
    <div id="bar-info" class="bar-info">
      <span id="bar-info-label" class="bar-info-label"></span>
      <span id="bar-info-url" class="bar-info-url"></span>
    </div>
    <div class="bar-spacer"></div>
    <div id="bar-tabs" class="bar-tabs"></div>
  </nav>

  <script>
    window.__DEVMUX__ = ${JSON.stringify(data)};
  </script>

  <script>
    (function() {
      const data = window.__DEVMUX__;
      let selected = null;
      const services = data.services || [];
      const iframeCache = new Map();

      const barTabs = document.getElementById('bar-tabs');
      const barInfoLabel = document.getElementById('bar-info-label');
      const barInfoUrl = document.getElementById('bar-info-url');
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

      function getServiceUrl(s) {
        const port = s.resolvedPort || s.port;
        return port ? 'http://localhost:' + port : null;
      }

      function renderBar() {
        barTabs.innerHTML = '';
        services.forEach(s => {
          const tab = document.createElement('div');
          tab.className = 'tab' + (selected === s.name ? ' active' : '');
          tab.onclick = () => selectService(s.name);

          let dotClass = 'no-check';
          if (s.hasHealthCheck) dotClass = s.healthy ? 'healthy' : 'unhealthy';

          const port = s.resolvedPort || s.port;
          const portLabel = port ? '<span class="tab-port">:' + port + '</span>' : '';

          const tooltipRows = [];
          tooltipRows.push('<div class="tooltip-row"><span class="tooltip-key">service</span> ' + s.name + '</div>');
          if (port) tooltipRows.push('<div class="tooltip-row"><span class="tooltip-key">port</span> ' + port + '</div>');
          tooltipRows.push('<div class="tooltip-row"><span class="tooltip-key">status</span> ' + (s.hasHealthCheck ? (s.healthy ? 'healthy' : 'unhealthy') : 'no check') + '</div>');
          if (port) tooltipRows.push('<div class="tooltip-row"><span class="tooltip-key">url</span> http://localhost:' + port + '</div>');

          tab.innerHTML =
            '<div class="dot ' + dotClass + '"></div>' +
            s.name + portLabel +
            '<div class="tooltip">' + tooltipRows.join('') + '</div>';

          barTabs.appendChild(tab);
        });
      }

      function updateBarInfo() {
        const service = services.find(s => s.name === selected);
        if (!service) {
          barInfoLabel.textContent = '';
          barInfoUrl.textContent = '';
          return;
        }
        barInfoLabel.textContent = service.name;
        const url = getServiceUrl(service);
        barInfoUrl.textContent = url || '(no port)';
      }

      function selectService(name) {
        selected = name;
        const service = services.find(s => s.name === name);
        if (!service) return;

        barTabs.querySelectorAll('.tab').forEach((tab, i) => {
          tab.classList.toggle('active', services[i].name === name);
        });

        updateBarInfo();

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
            updateBarInfo();
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
