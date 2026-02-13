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
  <title>devmux — ${data.project}</title>
  <style>
    :root {
      --bg-color: #1a1a1a;
      --header-bg: #222;
      --sidebar-bg: #252525;
      --text-color: #eee;
      --text-muted: #888;
      --border-color: #333;
      --accent-color: #007acc;
      --success-color: #4caf50;
      --error-color: #f44336;
      --neutral-color: #666;
    }

    body {
      background: var(--bg-color);
      color: var(--text-color);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      margin: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Header */
    header {
      height: 40px;
      background: var(--header-bg);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 15px;
      flex-shrink: 0;
    }

    .header-left {
      font-weight: bold;
    }

    .header-right {
      font-size: 0.9em;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .health-badge {
      padding: 2px 8px;
      border-radius: 4px;
      background: #333;
      font-size: 0.85em;
    }

    .connection-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--error-color);
      display: none;
    }
    .connection-status.active { display: block; }

    /* Main Area */
    main {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* Sidebar */
    aside {
      width: 220px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border-color);
      overflow-y: auto;
      flex-shrink: 0;
    }

    .service-row {
      padding: 10px 15px;
      cursor: pointer;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 10px;
      transition: background 150ms;
    }

    .service-row:hover {
      background: #333;
    }

    .service-row.active {
      background: var(--accent-color);
      color: white;
    }

    .service-row.active .port {
      color: rgba(255, 255, 255, 0.8);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.healthy {
      background: var(--success-color);
      box-shadow: 0 0 5px var(--success-color);
    }

    .status-dot.unhealthy {
      background: var(--error-color);
    }

    .status-dot.no-check {
      background: var(--neutral-color);
    }

    .service-info {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .service-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 500;
    }

    .port {
      font-family: monospace;
      font-size: 0.85em;
      color: var(--text-muted);
    }

    /* Content Area */
    .content-area {
      flex: 1;
      background: #fff;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: white;
    }

    .fallback-panel {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: var(--bg-color);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: var(--text-color);
      z-index: 10;
    }

    .fallback-panel h3 {
      margin-bottom: 10px;
    }

    .fallback-link {
      color: var(--accent-color);
      text-decoration: none;
      padding: 8px 16px;
      border: 1px solid var(--accent-color);
      border-radius: 4px;
      margin-top: 10px;
      transition: background 150ms;
    }

    .fallback-link:hover {
      background: rgba(0, 122, 204, 0.1);
    }

    .terminal-hint {
      margin-top: 20px;
      font-family: monospace;
      background: #333;
      padding: 8px;
      border-radius: 4px;
      font-size: 0.9em;
      color: #aaa;
    }

    /* Footer */
    footer {
      height: 28px;
      background: var(--header-bg);
      border-top: 1px solid var(--border-color);
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 15px;
      flex-shrink: 0;
    }

    /* Help Overlay */
    .help-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    
    .help-content {
      background: var(--header-bg);
      padding: 20px;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      max-width: 400px;
    }

    .help-content h2 { margin-top: 0; }
    .help-content ul { padding-left: 20px; }
    .help-content li { margin-bottom: 5px; }
    
    .help-close {
      margin-top: 15px;
      text-align: right;
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>

  <header>
    <div class="header-left">devmux — ${data.project}</div>
    <div class="header-right">
      <div id="connection-status" class="connection-status" title="Connection lost"></div>
      <div id="health-summary" class="health-badge">Loading...</div>
    </div>
  </header>

  <main>
    <aside id="sidebar">
      <!-- Service rows injected here -->
    </aside>

    <div class="content-area">
      <iframe id="service-frame" src=""></iframe>
      
      <div id="fallback-panel" class="fallback-panel hidden">
        <h3 id="fallback-title">Cannot embed this service</h3>
        <p id="fallback-message">This service does not have a web interface or cannot be embedded.</p>
        <a id="fallback-link" href="#" target="_blank" class="fallback-link">Open in new tab</a>
        <div id="terminal-hint" class="terminal-hint">devmux attach <span id="hint-service-name">service</span></div>
      </div>
      
      <div id="empty-state" class="fallback-panel hidden">
        <h3>No services configured</h3>
        <p>Add services to devmux.config.json</p>
      </div>
    </div>
  </main>

  <footer>
    <div class="footer-left">Dashboard: localhost:${data.dashboardPort}</div>
    <div class="footer-right">Config: ${data.configPath}</div>
  </footer>

  <div id="help-overlay" class="help-overlay">
    <div class="help-content">
      <h2>Keyboard Shortcuts</h2>
      <ul>
        <li><strong>?</strong>: Toggle this help</li>
        <li><strong>Click</strong>: Select service</li>
      </ul>
      <div class="help-close">
        <button onclick="document.getElementById('help-overlay').style.display='none'">Close</button>
      </div>
    </div>
  </div>

  <script>
    // Initial Data Injection
    window.__DEVMUX__ = ${JSON.stringify(data)};
  </script>

  <script>
    (function() {
      // State
      let data = window.__DEVMUX__;
      let selectedServiceName = null;
      let services = data.services || [];
      
      // DOM Elements
      const sidebar = document.getElementById('sidebar');
      const healthSummary = document.getElementById('health-summary');
      const connectionStatus = document.getElementById('connection-status');
      const iframe = document.getElementById('service-frame');
      const fallbackPanel = document.getElementById('fallback-panel');
      const fallbackTitle = document.getElementById('fallback-title');
      const fallbackMessage = document.getElementById('fallback-message');
      const fallbackLink = document.getElementById('fallback-link');
      const terminalHint = document.getElementById('terminal-hint');
      const hintServiceName = document.getElementById('hint-service-name');
      const emptyState = document.getElementById('empty-state');
      const helpOverlay = document.getElementById('help-overlay');

      // Initialization
      function init() {
        renderSidebar();
        updateHealthSummary();
        
        // Auto-select first healthy service with port
        if (services.length > 0) {
          const firstWithPort = services.find(s => s.resolvedPort || s.port);
          if (firstWithPort) {
            selectService(firstWithPort.name);
          } else {
            // Select first anyway if none have ports
            selectService(services[0].name);
          }
        } else {
          emptyState.classList.remove('hidden');
          iframe.classList.add('hidden');
          fallbackPanel.classList.add('hidden');
        }

        // Start polling
        startPolling();
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
          if (e.key === '?') {
            helpOverlay.style.display = helpOverlay.style.display === 'flex' ? 'none' : 'flex';
          }
        });
      }

      // Render Functions
      function renderSidebar() {
        sidebar.innerHTML = '';
        
        if (services.length === 0) return;

        services.forEach(service => {
          const row = document.createElement('div');
          row.className = \`service-row \${selectedServiceName === service.name ? 'active' : ''}\`;
          row.onclick = () => selectService(service.name);
          
          let statusClass = 'no-check';
          if (service.hasHealthCheck) {
            statusClass = service.healthy ? 'healthy' : 'unhealthy';
          }

          const portDisplay = service.resolvedPort || service.port || '';

          row.innerHTML = \`
            <div class="status-dot \${statusClass}"></div>
            <div class="service-info">
              <div class="service-name">\${service.name}</div>
              \${portDisplay ? \`<div class="port">\${portDisplay}</div>\` : ''}
            </div>
          \`;
          
          sidebar.appendChild(row);
        });
      }

      function updateHealthSummary() {
        const total = services.length;
        const healthy = services.filter(s => s.healthy).length;
        healthSummary.textContent = \`\${healthy}/\${total} healthy\`;
        
        // Optional: change badge color based on ratio
        if (healthy === total && total > 0) {
          healthSummary.style.color = '#4caf50';
        } else if (healthy < total) {
          healthSummary.style.color = '#f44336';
        } else {
          healthSummary.style.color = '#eee';
        }
      }

      function selectService(name) {
        selectedServiceName = name;
        const service = services.find(s => s.name === name);
        
        // Update sidebar active state
        const rows = sidebar.querySelectorAll('.service-row');
        rows.forEach((row, index) => {
          if (services[index].name === name) {
            row.classList.add('active');
          } else {
            row.classList.remove('active');
          }
        });

        if (!service) return;

        // Update content area
        const port = service.resolvedPort || service.port;
        
        if (port) {
          // Has port - try to show iframe
          const url = \`http://localhost:\${port}\`;
          iframe.src = url;
          iframe.classList.remove('hidden');
          fallbackPanel.classList.add('hidden');
          emptyState.classList.add('hidden');
          
          // Note: We can't easily detect if iframe fails (X-Frame-Options)
          // But we can verify if it loaded via timeout or other heuristics if needed
          // For now, we assume it works, but users can use the fallback if not.
        } else {
          // No port - show fallback
          iframe.classList.add('hidden');
          fallbackPanel.classList.remove('hidden');
          emptyState.classList.add('hidden');
          
          fallbackTitle.textContent = 'Terminal-only Service';
          fallbackMessage.textContent = 'This service does not have a configured port.';
          fallbackLink.style.display = 'none'; // No link if no port
          
          hintServiceName.textContent = service.name;
        }
        
        // If we have a port but it might fail (e.g. strict CSP),
        // we might want to show the link anyway?
        // Let's stick to the spec: "If service has no port: show fallback panel"
        // But for robust UX, if the service HAS a port, we should probably 
        // handle the case where it doesn't load.
        // Let's check the iframe load.
        
        // Actually, let's inject a "Open External" button into the fallback panel 
        // AND show it briefly or if load fails? No, keep it simple.
        
        // If it has a port, we set the fallback link href just in case we need to show it manually?
        // We only show fallback panel if !port currently.
      }

      // Polling
      function startPolling() {
        const poll = () => {
          setTimeout(async () => {
            try {
              const res = await fetch('/api/status');
              if (!res.ok) throw new Error('Status fetch failed');
              
              const newData = await res.json();
              
              // Update state
              services = newData.services;
              data = newData; // Update global data reference if needed
              
              // Re-render
              // We want to preserve selection
              const currentSelection = selectedServiceName;
              renderSidebar();
              updateHealthSummary();
              
              // Restore active class without reloading iframe (to avoid flicker)
              if (currentSelection) {
                 const rows = sidebar.querySelectorAll('.service-row');
                 services.forEach((s, i) => {
                   if (s.name === currentSelection) rows[i].classList.add('active');
                 });
                 // If the selected service disappeared or changed port?
                 // For now assume stable config.
              }
              
              connectionStatus.classList.remove('active');
            } catch (err) {
              console.error('Polling error:', err);
              connectionStatus.classList.add('active');
            } finally {
              poll();
            }
          }, 5000);
        };
        
        poll();
      }

      // Run
      init();
    })();
  </script>
</body>
</html>`;
}
