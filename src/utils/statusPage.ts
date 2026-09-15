import { env } from '../config/env';
import { prisma } from '../lib/prisma';

export async function renderStatusPage(): Promise<string> {
  const currentTime = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Colombo',
    dateStyle: 'full',
    timeStyle: 'medium',
  });

  const upSeconds = Math.floor(process.uptime());
  const uptimeStr =
    upSeconds < 60
      ? `${upSeconds}s`
      : upSeconds < 3600
        ? `${Math.floor(upSeconds / 60)}m ${upSeconds % 60}s`
        : `${Math.floor(upSeconds / 3600)}h ${Math.floor((upSeconds % 3600) / 60)}m`;

  const memoryUsageMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

  // Live MariaDB Query Ping Test
  let dbStatus = false;
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = true;
  } catch {
    dbStatus = false;
  }

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reliance API • System Health</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --background: 240 10% 3.9%;
      --foreground: 0 0% 98%;
      --card: 240 10% 4.9%;
      --card-border: 240 3.7% 15.9%;
      --primary: 142 71% 45%;
      --muted: 240 5% 64.9%;
      --muted-bg: 240 3.7% 12%;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: #09090b;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fafafa;
      padding: 1.5rem;
      position: relative;
      overflow-x: hidden;
    }
    .glow-sphere {
      position: fixed;
      border-radius: 50%;
      filter: blur(140px);
      pointer-events: none;
      z-index: 0;
      opacity: 0.15;
    }
    .glow-1 { width: 450px; height: 450px; background: #10b981; top: -100px; right: -100px; }
    .glow-2 { width: 400px; height: 400px; background: #6366f1; bottom: -100px; left: -100px; }

    .card-container {
      position: relative;
      z-index: 10;
      width: 100%;
      max-width: 580px;
      animation: fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .shadcn-card {
      background: rgba(18, 18, 22, 0.75);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 2.25rem 2rem;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.7);
    }
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .brand-title {
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #fafafa;
    }
    .brand-subtitle {
      font-size: 0.8rem;
      color: #a1a1aa;
      margin-top: 0.2rem;
      font-weight: 500;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      border: 1px solid;
    }
    .badge-success {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border-color: rgba(16, 185, 129, 0.25);
    }
    .badge-danger {
      background: rgba(239, 68, 68, 0.1);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.25);
    }
    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 8px currentColor;
      animation: pulse 2s infinite ease-in-out;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .metric-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 1rem 1.1rem;
      transition: all 0.2s ease;
    }
    .metric-card:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.1);
    }
    .metric-label {
      font-size: 0.7rem;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
      margin-bottom: 0.35rem;
    }
    .metric-value {
      font-size: 0.95rem;
      font-weight: 600;
      color: #fafafa;
      font-family: 'JetBrains Mono', monospace;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .status-indicator {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.9rem 1.1rem;
      border-radius: 12px;
      margin-bottom: 1.5rem;
      border: 1px solid;
    }
    .status-indicator.connected {
      background: rgba(16, 185, 129, 0.04);
      border-color: rgba(16, 185, 129, 0.2);
    }
    .status-indicator.disconnected {
      background: rgba(239, 68, 68, 0.04);
      border-color: rgba(239, 68, 68, 0.2);
    }
    .status-indicator-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: #f4f4f5;
    }
    .status-indicator-desc {
      font-size: 0.75rem;
      color: #a1a1aa;
    }
    .action-links {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }
    .btn {
      flex: 1;
      text-align: center;
      padding: 0.65rem 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-decoration: none;
      border-radius: 8px;
      transition: all 0.15s ease;
      font-family: 'JetBrains Mono', monospace;
    }
    .btn-secondary {
      background: #27272a;
      color: #fafafa;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .btn-secondary:hover {
      background: #3f3f46;
    }
    .footer-text {
      text-align: center;
      font-size: 0.7rem;
      color: #52525b;
      margin-top: 1.5rem;
      letter-spacing: 0.02em;
    }
  </style>
</head>
<body>
  <div class="glow-sphere glow-1"></div>
  <div class="glow-sphere glow-2"></div>
  <div class="card-container">
    <div class="shadcn-card">
      <div class="header-row">
        <div>
          <div class="brand-title">Reliance POS &amp; Engine</div>
          <div class="brand-subtitle">Express REST API • Production Core</div>
        </div>
        <div class="badge ${dbStatus ? 'badge-success' : 'badge-danger'}">
          <span class="pulse-dot"></span>
          ${dbStatus ? 'SYSTEM OPERATIONAL' : 'DEGRADED'}
        </div>
      </div>

      <div class="status-indicator ${dbStatus ? 'connected' : 'disconnected'}">
        <div>
          <div class="status-indicator-title">MariaDB Driver Adapter (Pool: 10)</div>
          <div class="status-indicator-desc">
            ${dbStatus ? `Live ping successful • Latency: ${dbLatencyMs}ms` : 'Failed to connect to MariaDB database'}
          </div>
        </div>
        <div class="badge ${dbStatus ? 'badge-success' : 'badge-danger'}">
          ${dbStatus ? 'CONNECTED' : 'DISCONNECTED'}
        </div>
      </div>

      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Environment</div>
          <div class="metric-value">${env.nodeEnv}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Process Uptime</div>
          <div class="metric-value">${uptimeStr}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Heap Memory</div>
          <div class="metric-value">${memoryUsageMB} MB</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Socket.IO Core</div>
          <div class="metric-value">Active (WSS)</div>
        </div>
      </div>

      <div class="action-links">
        <a href="/api/health" target="_blank" class="btn btn-secondary">JSON Health Ping</a>
      </div>

      <div class="footer-text">
        Asia/Colombo Time • ${currentTime}
      </div>
    </div>
  </div>
</body>
</html>`;
}