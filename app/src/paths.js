'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

/**
 * Where Chestplate keeps everything (servers, settings, Java runtimes, backups).
 *  - CHESTPLATE_HOME overrides it.
 *  - Windows: "C:\Program Files\Chestplate" (the installer grants write access),
 *    falling back to %LOCALAPPDATA%\Chestplate if that folder isn't writable.
 *  - Other systems: ~/Chestplate (handy for development).
 */
function resolveHome() {
  if (process.env.CHESTPLATE_HOME) return path.resolve(process.env.CHESTPLATE_HOME);
  if (process.platform === 'win32') {
    const pf = process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files';
    const preferred = path.join(pf, 'Chestplate');
    if (canWrite(preferred)) return preferred;
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'Chestplate');
  }
  return path.join(os.homedir(), 'Chestplate');
}

const HOME = resolveHome();
const paths = {
  HOME,
  SERVERS_DIR: path.join(HOME, 'servers'),
  DATA_DIR: path.join(HOME, 'data'),
  RUNTIMES_DIR: path.join(HOME, 'runtimes'),
  BACKUPS_DIR: path.join(HOME, 'backups'),
  PUBLIC_DIR: path.join(__dirname, '..', 'public'),
};

function ensureDirs() {
  for (const k of ['SERVERS_DIR', 'DATA_DIR', 'RUNTIMES_DIR', 'BACKUPS_DIR']) {
    fs.mkdirSync(paths[k], { recursive: true });
  }
}

module.exports = { ...paths, ensureDirs };
