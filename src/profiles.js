import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { userDataRoot } from './paths.js';

export const REGISTRY_DIRNAME = 'claude-code-sessions';

function hasRegistry(dir) {
  try {
    return fs.statSync(path.join(dir, REGISTRY_DIRNAME)).isDirectory();
  } catch {
    return false;
  }
}

function readDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
}

// The account uuid the desktop app last signed in as, straight from the
// profile's own config.json. Authoritative — unlike inferring it from session
// mtimes, which names the wrong directory whenever the most recent session
// predates the account switch.
export function readActiveAccountId(profileDir) {
  try {
    let raw = fs.readFileSync(path.join(profileDir, 'config.json'), 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const id = JSON.parse(raw).lastKnownAccountUuid;
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}

// One profile == one Electron --user-data-dir. The default install sits at
// <userDataRoot>/Claude; extra profiles are wherever the user pointed
// --user-data-dir, commonly a sibling such as Claude-Profiles/<name>.
export function discoverProfiles({ platform = process.platform, env = process.env, home = os.homedir(), extraDirs = [] } = {}) {
  const searchRoot = userDataRoot({ platform, env, home });
  const found = new Map();
  const taken = new Set();

  const add = (dir, preferred) => {
    const resolved = path.resolve(dir);
    if (found.has(resolved) || !hasRegistry(resolved)) return;
    let name = preferred || path.basename(resolved);
    if (taken.has(name)) name = `${path.basename(path.dirname(resolved))}/${path.basename(resolved)}`;
    taken.add(name);
    found.set(resolved, {
      name,
      dir: resolved,
      root: path.join(resolved, REGISTRY_DIRNAME),
      activeAccountId: readActiveAccountId(resolved),
    });
  };

  add(path.join(searchRoot, 'Claude'), 'default');
  // Bounded to Claude* entries and two levels deep: enough for both
  // <root>/Claude-Alt and <root>/Claude-Profiles/<name>, cheap everywhere else.
  for (const entry of readDirs(searchRoot)) {
    if (!/^claude/i.test(entry.name)) continue;
    const dir = path.join(searchRoot, entry.name);
    if (hasRegistry(dir)) {
      add(dir);
      continue;
    }
    for (const child of readDirs(dir)) add(path.join(dir, child.name));
  }
  for (const dir of extraDirs) add(dir);

  return [...found.values()];
}

export function matchProfile(profiles, query) {
  const exact = profiles.filter((p) => p.name === query);
  if (exact.length === 1) return exact[0];
  const hits = profiles.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.dir.includes(query));
  if (hits.length === 0) {
    throw new Error(`no profile matches "${query}" (known: ${profiles.map((p) => p.name).join(', ') || 'none'})`);
  }
  if (hits.length > 1) throw new Error(`"${query}" is ambiguous: ${hits.map((p) => p.name).join(', ')}`);
  return hits[0];
}
