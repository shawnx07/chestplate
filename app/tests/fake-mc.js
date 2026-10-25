'use strict';
// A stand-in for a Minecraft server: same log shapes, same stdin commands. Used by the tests.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const t = () => new Date().toTimeString().slice(0, 8);
const log = (m, lvl = 'INFO') => console.log(`[${t()} ${lvl}]: ${m}`);
const eula = (() => { try { return /eula=true/.test(fs.readFileSync('eula.txt', 'utf8')); } catch { return false; } })();
if (!eula) { log('You need to agree to the EULA in order to run the server. Go to eula.txt for more info.', 'WARN'); process.exit(0); }
const jf = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
log('Starting minecraft server version fake-1.0');
log('Starting Minecraft server on *:25565');
fs.mkdirSync('world', { recursive: true });
fs.writeFileSync(path.join('world', 'level.dat'), 'fake');
fs.mkdirSync('logs', { recursive: true });
setTimeout(() => log('Done (0.123s)! For help, type "help"'), 150);
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const [cmd, ...a] = line.trim().split(/\s+/);
  if (cmd === 'stop') { log('Stopping server'); setTimeout(() => process.exit(0), 100); }
  else if (cmd === 'op') { const o = jf('ops.json', []); o.push({ uuid: 'x', name: a[0], level: 4 }); fs.writeFileSync('ops.json', JSON.stringify(o)); log(`Made ${a[0]} a server operator`); }
  else if (cmd === 'deop') { fs.writeFileSync('ops.json', JSON.stringify(jf('ops.json', []).filter((p) => p.name !== a[0]))); log(`Made ${a[0]} no longer a server operator`); }
  else if (cmd === 'whitelist' && a[0] === 'add') { const o = jf('whitelist.json', []); o.push({ uuid: 'x', name: a[1] }); fs.writeFileSync('whitelist.json', JSON.stringify(o)); log(`Added ${a[1]} to the whitelist`); }
  else if (cmd === 'whitelist' && a[0] === 'remove') { fs.writeFileSync('whitelist.json', JSON.stringify(jf('whitelist.json', []).filter((p) => p.name !== a[1]))); log(`Removed ${a[1]} from the whitelist`); }
  else if (cmd === 'whitelist' && (a[0] === 'on' || a[0] === 'off')) {
    let p = fs.readFileSync('server.properties', 'utf8'); p = p.replace(/white-list=.*/, `white-list=${a[0] === 'on'}`); fs.writeFileSync('server.properties', p); log(`Whitelist is now turned ${a[0]}`); }
  else if (cmd === 'fakejoin') log(`${a[0]} joined the game`);
  else if (cmd === 'fakeleave') log(`${a[0]} left the game`);
  else if (cmd === 'crash') process.exit(1);
  else if (cmd === 'list') log('There are 0 of a max of 20 players online:');
  else if (cmd) log(`Unknown or incomplete command, see below for error`);
});
