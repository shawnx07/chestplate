'use strict';
/**
 * server.properties: parsing, in-place editing (comments/order preserved),
 * and the schema that drives the Settings UI.
 */
const fs = require('fs');
const path = require('path');

/* ---------------------------------------------------------------- Java .properties format */

const UNESCAPES = { n: '\n', t: '\t', r: '\r', f: '\f' };

function unescapeValue(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})|\\([\s\S])/g, (_, hex, ch) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : (UNESCAPES[ch] ?? ch));
}

function escapeValue(v) {
  let s = String(v)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/([:=#!])/g, '\\$1')
    .replace(/^ /, '\\ ');
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code > 126) {
      // Java writes UTF-16 code units
      for (let i = 0; i < ch.length; i++) out += '\\u' + ch.charCodeAt(i).toString(16).padStart(4, '0');
    } else out += ch;
  }
  return out;
}

function escapeKey(k) {
  return String(k).replace(/([\\ =:#!])/g, '\\$1');
}

function parseLines(text) {
  return String(text || '').split(/\r?\n/).map((raw) => {
    const t = raw.trim();
    if (!t || t[0] === '#' || t[0] === '!') return { raw };
    let i = 0;
    while (i < raw.length) {
      const c = raw[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '=' || c === ':' || c === ' ' || c === '\t') break;
      i++;
    }
    const key = unescapeValue(raw.slice(0, i));
    let rest = raw.slice(i).replace(/^[ \t]*/, '');
    if (rest[0] === '=' || rest[0] === ':') rest = rest.slice(1).replace(/^[ \t]*/, '');
    return { raw, key, value: unescapeValue(rest) };
  });
}

function parse(text) {
  const values = {};
  for (const l of parseLines(text)) if (l.key !== undefined) values[l.key] = l.value;
  return values;
}

/** Apply `changes` to existing text, preserving everything else. */
function update(text, changes) {
  const lines = parseLines(text);
  const pending = new Map(Object.entries(changes).map(([k, v]) => [k, String(v)]));
  const out = [];
  for (const l of lines) {
    if (l.key !== undefined && pending.has(l.key)) {
      out.push(`${escapeKey(l.key)}=${escapeValue(pending.get(l.key))}`);
      pending.delete(l.key);
    } else out.push(l.raw);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  if (!out.length) {
    out.push('#Minecraft server properties');
    out.push(`#${new Date().toString()}`);
  }
  for (const [k, v] of pending) out.push(`${escapeKey(k)}=${escapeValue(v)}`);
  return out.join('\n') + '\n';
}

function file(dir) { return path.join(dir, 'server.properties'); }

function read(dir) {
  try { return parse(fs.readFileSync(file(dir), 'utf8')); } catch { return {}; }
}

function write(dir, changes) {
  let text = '';
  try { text = fs.readFileSync(file(dir), 'utf8'); } catch { /* new file */ }
  fs.writeFileSync(file(dir), update(text, changes));
}

/* ---------------------------------------------------------------- schema */

const B = (key, label, def, desc, group, extra = {}) => ({ key, label, type: 'bool', def, desc, group, ...extra });
const N = (key, label, def, desc, group, min, max, extra = {}) => ({ key, label, type: 'int', def, desc, group, min, max, ...extra });
const S = (key, label, def, desc, group, extra = {}) => ({ key, label, type: 'string', def, desc, group, ...extra });
const O = (key, label, def, desc, group, options, extra = {}) => ({ key, label, type: 'select', def, desc, group, options, ...extra });

const GROUPS = ['Gameplay', 'World', 'Players & Access', 'Network', 'Performance', 'Resource Pack', 'Advanced'];

const SCHEMA = [
  // Gameplay
  O('difficulty', 'Difficulty', 'easy', 'How hard the game is.', 'Gameplay', ['peaceful', 'easy', 'normal', 'hard'], { global: true }),
  O('gamemode', 'Default game mode', 'survival', 'Game mode new players start in.', 'Gameplay', ['survival', 'creative', 'adventure', 'spectator'], { global: true }),
  B('hardcore', 'Hardcore', false, 'Players are banned/spectate after dying; difficulty locked to hard.', 'Gameplay', { global: true }),
  B('pvp', 'PvP', true, 'Players can damage each other.', 'Gameplay', { global: true }),
  B('force-gamemode', 'Force game mode', false, 'Reset players to the default game mode on every join.', 'Gameplay'),
  B('allow-flight', 'Allow flight', false, 'Allow survival flight (needed for some mods/plugins).', 'Gameplay', { global: true }),
  B('enable-command-block', 'Command blocks', false, 'Enable command blocks.', 'Gameplay', { global: true }),
  N('spawn-protection', 'Spawn protection radius', 16, 'Blocks around spawn that non-ops cannot modify (0 disables).', 'Gameplay', 0, 1000, { global: true }),
  N('player-idle-timeout', 'Idle kick (minutes)', 0, 'Kick idle players after this many minutes (0 = never).', 'Gameplay', 0, 100000),
  N('function-permission-level', 'Function permission level', 2, 'Permission level for datapack functions.', 'Gameplay', 1, 4),

  // World
  S('level-name', 'World folder name', 'world', 'Name of the world folder.', 'World'),
  S('level-seed', 'World seed', '', 'Seed for NEW worlds. Leave empty for random.', 'World'),
  O('level-type', 'World type', 'minecraft:normal', 'World generator for NEW worlds.', 'World',
    ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified', 'minecraft:single_biome_surface']),
  S('generator-settings', 'Generator settings', '{}', 'JSON for flat / custom world generation.', 'World'),
  B('generate-structures', 'Generate structures', true, 'Villages, strongholds, etc.', 'World'),
  B('allow-nether', 'Allow the Nether', true, 'Players can travel to the Nether.', 'World', { global: true }),
  N('max-world-size', 'Max world size (radius)', 29999984, 'Maximum world radius in blocks.', 'World', 1, 29999984),

  // Players & Access
  N('max-players', 'Max players', 20, 'Player slots.', 'Players & Access', 0, 2147483647, { global: true }),
  B('white-list', 'Whitelist', false, 'Only whitelisted players can join.', 'Players & Access', { global: true }),
  B('enforce-whitelist', 'Enforce whitelist', false, 'Kick non-whitelisted players when the whitelist reloads.', 'Players & Access'),
  B('online-mode', 'Online mode', true, 'Verify players with Mojang. Turn OFF only for offline/cracked setups.', 'Players & Access', { global: true }),
  B('enforce-secure-profile', 'Enforce secure profiles', true, 'Require players to have a Mojang-signed public key.', 'Players & Access', { global: true }),
  N('op-permission-level', 'Default OP level', 4, 'Permission level given to /op players.', 'Players & Access', 0, 4),
  B('hide-online-players', 'Hide online players', false, 'Do not show the player list in the server list.', 'Players & Access'),
  B('log-ips', 'Log player IPs', true, 'Write player IP addresses to the log.', 'Players & Access'),

  // Network
  N('server-port', 'Server port', 25565, 'TCP port the server listens on.', 'Network', 1, 65535, { restart: true }),
  S('server-ip', 'Bind IP', '', 'Leave empty to listen on all interfaces.', 'Network', { restart: true }),
  B('accept-transfers', 'Allow transfers', false, 'Accept players transferred from other servers.', 'Network', { global: true }),
  B('enable-status', 'Respond to pings', true, 'Show up in the multiplayer server list.', 'Network'),
  B('prevent-proxy-connections', 'Block proxy connections', false, 'Kick players behind a VPN/proxy known to Mojang.', 'Network'),
  B('enable-query', 'GameSpy query', false, 'Enable the query protocol.', 'Network'),
  N('query.port', 'Query port', 25565, 'Port for the query protocol.', 'Network', 1, 65535),
  B('enable-rcon', 'RCON', false, 'Enable remote console.', 'Network'),
  N('rcon.port', 'RCON port', 25575, 'Port for RCON.', 'Network', 1, 65535),
  S('rcon.password', 'RCON password', '', 'Password for RCON.', 'Network', { secret: true }),
  N('network-compression-threshold', 'Compression threshold', 256, 'Compress packets larger than this many bytes (-1 disables).', 'Network', -1, 1000000),
  N('rate-limit', 'Packet rate limit', 0, 'Kick players sending more packets/sec than this (0 = off).', 'Network', 0, 1000000),
  B('use-native-transport', 'Native transport', true, 'Use optimized Linux networking where available.', 'Network'),

  // Performance
  N('view-distance', 'View distance', 10, 'Chunks sent to each player (2–32).', 'Performance', 2, 32, { global: true }),
  N('simulation-distance', 'Simulation distance', 10, 'Chunks around players that are ticked (2–32).', 'Performance', 2, 32, { global: true }),
  N('entity-broadcast-range-percentage', 'Entity broadcast range %', 100, 'How far entities are tracked.', 'Performance', 10, 1000),
  N('max-tick-time', 'Watchdog timeout (ms)', 60000, 'Crash a hung server after this long (-1 disables).', 'Performance', -1, 2147483647),
  N('pause-when-empty-seconds', 'Pause when empty (s)', 60, 'Pause ticking after this many seconds with no players (-1 disables).', 'Performance', -1, 2147483647),
  B('sync-chunk-writes', 'Sync chunk writes', true, 'Safer but slower disk writes.', 'Performance'),
  O('region-file-compression', 'Region compression', 'deflate', 'Chunk compression algorithm.', 'Performance', ['deflate', 'lz4', 'none']),
  N('max-chained-neighbor-updates', 'Max chained updates', 1000000, 'Limit for chained neighbour updates.', 'Performance', -1, 2147483647),

  // Resource pack
  S('resource-pack', 'Resource pack URL', '', 'Direct download URL of a resource pack.', 'Resource Pack'),
  S('resource-pack-sha1', 'Resource pack SHA-1', '', 'Hash to verify the pack.', 'Resource Pack'),
  S('resource-pack-id', 'Resource pack UUID', '', 'Optional UUID.', 'Resource Pack'),
  S('resource-pack-prompt', 'Resource pack prompt', '', 'Message shown when asking players to download.', 'Resource Pack'),
  B('require-resource-pack', 'Require resource pack', false, 'Kick players who decline the pack.', 'Resource Pack'),

  // Advanced
  S('motd', 'MOTD', 'A Minecraft Server', 'Message in the server list. Managed from General above.', 'Advanced', { hidden: true }),
  B('debug', 'Debug logging', false, 'Verbose logging.', 'Advanced'),
  B('broadcast-console-to-ops', 'Broadcast console to ops', true, 'Show console output to online ops.', 'Advanced'),
  B('broadcast-rcon-to-ops', 'Broadcast RCON to ops', true, 'Show RCON output to online ops.', 'Advanced'),
  B('enable-jmx-monitoring', 'JMX monitoring', false, 'Expose JMX metrics.', 'Advanced'),
  S('initial-enabled-packs', 'Enabled datapacks', 'vanilla', 'Datapacks enabled on world creation.', 'Advanced'),
  S('initial-disabled-packs', 'Disabled datapacks', '', 'Datapacks disabled on world creation.', 'Advanced'),
  S('bug-report-link', 'Bug report link', '', 'Link shown in crash screens.', 'Advanced'),
  S('text-filtering-config', 'Text filtering config', '', 'Path to a chat filtering config.', 'Advanced'),
];

module.exports = { parse, update, read, write, SCHEMA, GROUPS, escapeValue, unescapeValue };
