#!/usr/bin/env node
'use strict';
/**
 * Chestplate — entry point.
 * Starts the local web server, opens the app window, and quits cleanly.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const P = require('./src/paths');
P.ensureDirs();

const logFile = path.join(P.DATA_DIR, 'chestplate.log');
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' ')}\n`;
  try { fs.appendFileSync(logFile, line); } catch { /* ignore */ }
  if (process.stdout.isTTY) process.stdout.write(line);
}
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

const api = require('./src/api');
const manager = require('./src/servers');
const store = require('./src/store');

const PREFERRED_PORT = Number(process.env.CHESTPLATE_PORT) || 4545;
const HOST = '127.0.0.1';
const NO_WINDOW = process.argv.includes('--no-window') || process.env.CHESTPLATE_NO_WINDOW === '1';

/** Open the UI like a desktop app: Edge/Chrome "app mode" has no tabs or address bar. */
function openWindow(url) {
  if (NO_WINDOW) return;
  const tryApp = (cmd, args) => new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      p.once('error', () => resolve(false));
      p.once('spawn', () => { p.unref(); resolve(true); });
    } catch { resolve(false); }
  });
  (async () => {
    const appArg = `--app=${url}`;
    if (process.platform === 'win32') {
      const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
      const candidates = [];
      for (const base of pf) {
        candidates.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
        candidates.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
        candidates.push(path.join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
      }
      for (const exe of candidates) {
        if (fs.existsSync(exe) && await tryApp(exe, [appArg, '--window-size=1320,860'])) return;
      }
      await tryApp('cmd.exe', ['/c', 'start', '', url]);
    } else if (process.platform === 'darwin') {
      if (!(await tryApp('open', ['-na', 'Google Chrome', '--args', appArg]))) await tryApp('open', [url]);
    } else {
      for (const b of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
        if (await tryApp(b, [appArg])) return;
      }
      await tryApp('xdg-open', [url]);
    }
  })();
}

async function probeExisting(port) {
  try {
    const r = await fetch(`http://${HOST}:${port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j && j.app === 'chestplate';
  } catch { return false; }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
}

(async () => {
  // Already running? Just bring up a window and leave.
  if (await probeExisting(PREFERRED_PORT)) {
    log(`Chestplate is already running on port ${PREFERRED_PORT}; opening a window.`);
    openWindow(`http://${HOST}:${PREFERRED_PORT}`);
    setTimeout(() => process.exit(0), 300);
    return;
  }

  manager.init();
  const server = api.create();
  let port;
  try { port = await listen(server, PREFERRED_PORT); } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    port = await listen(server, 0); // someone else has our port; take any free one
  }
  const url = `http://${HOST}:${port}`;
  log(`Chestplate ${require('./package.json').version} running at ${url}`);
  log(`Data folder: ${P.HOME}`);
  if (process.stdout.isTTY) console.log(`\n  Chestplate is running → ${url}\n  Data folder: ${P.HOME}\n`);
  openWindow(url);

  // "Smart" close: when the last window closes and nothing is running, quit after a short grace period.
  if (process.env.CHESTPLATE_NO_AUTOEXIT !== '1') {
    setInterval(() => {
      const idle = api.idleMs();
      if (idle > 20000 && store.getSettings().app.closeBehavior === 'smart' && manager.runningCount() === 0) {
        log('Window closed and no servers running — quitting.');
        api.shutdown();
      }
    }, 5000).unref();
  }

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    process.on(sig, () => { log(`Received ${sig}, stopping servers…`); api.shutdown(); });
  }
})().catch((e) => { log('Fatal', e); console.error(e); process.exit(1); });
