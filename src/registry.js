import fs from 'node:fs';
import path from 'node:path';
import { timestamp } from './paths.js';

export function readJson(file) {
  let raw = fs.readFileSync(file, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try {
    return JSON.parse(raw);
  } catch (err) {
    return { __parseError: err.message };
  }
}

function sessionActivity(session) {
  const t = session.data && typeof session.data.lastActivityAt === 'number' ? session.data.lastActivityAt : 0;
  return Math.max(t, session.mtimeMs || 0);
}

// registry layout: <root>/<account-uuid>/<workspace-uuid>/local_<id>.json
export function scanRegistry(root) {
  const result = { root, accounts: [] };
  if (!fs.existsSync(root)) return result;
  for (const acc of fs.readdirSync(root, { withFileTypes: true })) {
    if (!acc.isDirectory()) continue;
    const accDir = path.join(root, acc.name);
    const leaves = [];
    for (const leaf of fs.readdirSync(accDir, { withFileTypes: true })) {
      if (!leaf.isDirectory()) continue;
      const leafDir = path.join(accDir, leaf.name);
      const sessions = [];
      for (const f of fs.readdirSync(leafDir, { withFileTypes: true })) {
        if (!f.isFile() || !f.name.startsWith('local_') || !f.name.endsWith('.json')) continue;
        const file = path.join(leafDir, f.name);
        sessions.push({ file, name: f.name, data: readJson(file), mtimeMs: fs.statSync(file).mtimeMs });
      }
      leaves.push({ id: leaf.name, dir: leafDir, sessions });
    }
    const lastActivityAt = Math.max(0, ...leaves.flatMap((l) => l.sessions.map(sessionActivity)));
    result.accounts.push({ id: acc.name, dir: accDir, leaves, lastActivityAt });
  }
  result.accounts.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return result;
}

// The signed-in account, whose directory is the only one the app writes to.
// `activeAccountId` comes from the profile's config.json and is authoritative
// when present; otherwise fall back to whichever account was written last.
export function pickCurrentAccount(accounts, activeAccountId) {
  if (activeAccountId) {
    const declared = accounts.find((a) => a.id === activeAccountId);
    if (declared) return declared;
  }
  return accounts.length ? accounts[0] : undefined;
}

// Scan every discovered profile into one addressable set. Each account keeps a
// back-reference to its profile so a restore plan can span user-data dirs.
export function scanProfiles(profiles) {
  return profiles.map((profile) => {
    const { accounts } = scanRegistry(profile.root);
    const scanned = { ...profile, accounts };
    for (const account of accounts) account.profile = scanned;
    scanned.current = pickCurrentAccount(accounts, profile.activeAccountId);
    return scanned;
  });
}

export function activeLeaf(account) {
  if (!account || account.leaves.length === 0) return undefined;
  return account.leaves
    .slice()
    .sort((a, b) => Math.max(0, ...b.sessions.map(sessionActivity)) - Math.max(0, ...a.sessions.map(sessionActivity)))[0];
}

export function matchAccount(accounts, prefix) {
  const hits = accounts.filter((a) => a.id.startsWith(prefix));
  if (hits.length === 0) throw new Error(`no account directory matches "${prefix}"`);
  if (hits.length > 1) throw new Error(`"${prefix}" is ambiguous: ${hits.map((a) => a.id).join(', ')}`);
  return hits[0];
}

// bridgeSessionIds reference server-side sessions created under the source
// account; carrying them to a *different* account is the only known hazard, so
// they are cleared by default. Moving an account's own entries between two
// profiles keeps them — the identity is unchanged, so the references still
// resolve and dropping them would lose working state for no benefit.
export function patchForRestore(data, { sameAccount = false } = {}) {
  const copy = structuredClone(data);
  if (!sameAccount) copy.bridgeSessionIds = [];
  return copy;
}

export function matchesFilters(session, filters) {
  if (!filters || filters.length === 0) return true;
  const d = session.data || {};
  return filters.some(
    (f) =>
      session.name.includes(f) ||
      (typeof d.sessionId === 'string' && d.sessionId.includes(f)) ||
      (typeof d.cliSessionId === 'string' && d.cliSessionId.startsWith(f)) ||
      (typeof d.title === 'string' && d.title.toLowerCase().includes(f.toLowerCase()))
  );
}

export function buildRestorePlan({ registry, fromAccounts, toAccount, includeArchived = false, force = false, sessionFilters = [], projectFilter }) {
  const targetLeaf = activeLeaf(toAccount);
  if (!targetLeaf) {
    throw new Error(
      `account ${toAccount ? toAccount.id : '(none)'} has no session directory yet — open the Claude desktop app once (any new session) under this account, then re-run`
    );
  }
  const existing = new Set(toAccount.leaves.flatMap((l) => l.sessions.map((s) => s.name)));
  const items = [];
  for (const acc of fromAccounts) {
    for (const leaf of acc.leaves) {
      for (const session of leaf.sessions) {
        if (!matchesFilters(session, sessionFilters)) continue;
        if (projectFilter && !(session.data.cwd || '').toLowerCase().includes(projectFilter.toLowerCase())) continue;
        let action = 'copy';
        if (session.data.__parseError) action = 'skip-invalid';
        else if (session.data.isArchived && !includeArchived) action = 'skip-archived';
        else if (existing.has(session.name) && !force) action = 'skip-exists';
        items.push({
          session,
          sourceAccount: acc,
          sourceProfile: acc.profile,
          sameAccount: acc.id === toAccount.id,
          action,
        });
      }
    }
  }
  return { targetLeaf, toAccount, items };
}

export function executeRestorePlan(plan) {
  let copied = 0;
  for (const item of plan.items) {
    if (item.action !== 'copy') continue;
    const target = path.join(plan.targetLeaf.dir, item.session.name);
    // Node's 'utf8' write is BOM-less, matching what the app itself produces.
    fs.writeFileSync(target, JSON.stringify(patchForRestore(item.session.data, { sameAccount: item.sameAccount })), 'utf8');
    copied++;
  }
  return copied;
}

export function backupRegistry(root) {
  const dest = `${root}.backup-${timestamp()}`;
  fs.cpSync(root, dest, { recursive: true });
  return dest;
}

export function writeEntry(leafDir, entry) {
  const file = path.join(leafDir, `${entry.sessionId}.json`);
  if (fs.existsSync(file)) throw new Error(`refusing to overwrite ${file}`);
  fs.writeFileSync(file, JSON.stringify(entry), 'utf8');
  return file;
}
