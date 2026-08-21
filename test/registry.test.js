import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scanRegistry,
  scanProfiles,
  pickCurrentAccount,
  activeLeaf,
  matchAccount,
  patchForRestore,
  buildRestorePlan,
  executeRestorePlan,
  backupRegistry,
} from '../src/registry.js';
import { registryRoot, userDataRoot } from '../src/paths.js';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-reg-'));
  const oldLeaf = path.join(root, 'account-old', 'leaf-1');
  const newLeaf = path.join(root, 'account-new', 'leaf-2');
  fs.mkdirSync(oldLeaf, { recursive: true });
  fs.mkdirSync(newLeaf, { recursive: true });
  const entry = (over) => ({
    sessionId: `local_${over.id}`,
    cliSessionId: over.cli,
    cwd: over.cwd || '/work/proj',
    title: over.title || 'untitled',
    lastActivityAt: over.at,
    isArchived: Boolean(over.archived),
    bridgeSessionIds: over.bridges || [],
  });
  fs.writeFileSync(
    path.join(oldLeaf, 'local_aaa.json'),
    JSON.stringify(entry({ id: 'aaa', cli: 'cli-aaa', at: 1000, title: 'alpha work', bridges: ['session_x'] }))
  );
  fs.writeFileSync(
    path.join(oldLeaf, 'local_bbb.json'),
    JSON.stringify(entry({ id: 'bbb', cli: 'cli-bbb', at: 900, title: 'beta work', archived: true }))
  );
  fs.writeFileSync(path.join(oldLeaf, 'local_ccc.json'), '{not json');
  fs.writeFileSync(
    path.join(newLeaf, 'local_ddd.json'),
    JSON.stringify(entry({ id: 'ddd', cli: 'cli-ddd', at: 2000, title: 'current session' }))
  );
  return { root, oldLeaf, newLeaf };
}

test('scanRegistry finds accounts, leaves and sessions', () => {
  const { root } = makeFixture();
  const reg = scanRegistry(root);
  assert.equal(reg.accounts.length, 2);
  const current = pickCurrentAccount(reg.accounts);
  assert.equal(current.id, 'account-new');
  const stale = reg.accounts.find((a) => a.id === 'account-old');
  assert.equal(stale.leaves[0].sessions.length, 3);
  assert.ok(stale.leaves[0].sessions.find((s) => s.name === 'local_ccc.json').data.__parseError);
});

test('scanRegistry tolerates a missing root', () => {
  const reg = scanRegistry(path.join(os.tmpdir(), 'ccsr-does-not-exist'));
  assert.deepEqual(reg.accounts, []);
});

test('matchAccount resolves prefixes and rejects ambiguity', () => {
  const { root } = makeFixture();
  const reg = scanRegistry(root);
  assert.equal(matchAccount(reg.accounts, 'account-old').id, 'account-old');
  assert.throws(() => matchAccount(reg.accounts, 'account-'), /ambiguous/);
  assert.throws(() => matchAccount(reg.accounts, 'zzz'), /no account/);
});

test('patchForRestore clears bridgeSessionIds and nothing else', () => {
  const data = { sessionId: 'local_x', title: 't', bridgeSessionIds: ['session_a'], permissionMode: 'default' };
  const patched = patchForRestore(data);
  assert.deepEqual(patched.bridgeSessionIds, []);
  assert.equal(patched.permissionMode, 'default');
  assert.deepEqual(data.bridgeSessionIds, ['session_a'], 'input must not be mutated');
});

test('restore plan: default skips archived and existing, copies the rest', () => {
  const { root } = makeFixture();
  const reg = scanRegistry(root);
  const to = pickCurrentAccount(reg.accounts);
  const from = reg.accounts.filter((a) => a !== to);
  const plan = buildRestorePlan({ registry: reg, fromAccounts: from, toAccount: to });
  const byAction = {};
  for (const item of plan.items) (byAction[item.action] ||= []).push(item);
  assert.equal(byAction.copy.length, 1);
  assert.equal(byAction.copy[0].session.name, 'local_aaa.json');
  assert.equal(byAction['skip-archived'].length, 1);
  assert.equal(byAction['skip-invalid'].length, 1);
});

test('restore plan honors includeArchived, filters and collisions', () => {
  const { root, newLeaf } = makeFixture();
  fs.copyFileSync(path.join(root, 'account-old', 'leaf-1', 'local_aaa.json'), path.join(newLeaf, 'local_aaa.json'));
  const reg = scanRegistry(root);
  const to = pickCurrentAccount(reg.accounts);
  const from = reg.accounts.filter((a) => a !== to);
  const plan = buildRestorePlan({ registry: reg, fromAccounts: from, toAccount: to, includeArchived: true });
  const actions = Object.fromEntries(plan.items.map((i) => [i.session.name, i.action]));
  assert.equal(actions['local_aaa.json'], 'skip-exists');
  assert.equal(actions['local_bbb.json'], 'copy');

  const filtered = buildRestorePlan({ registry: reg, fromAccounts: from, toAccount: to, sessionFilters: ['beta'], includeArchived: true });
  assert.deepEqual(filtered.items.map((i) => i.session.name), ['local_bbb.json']);
});

test('executeRestorePlan writes BOM-less JSON with bridges cleared', () => {
  const { root, newLeaf } = makeFixture();
  const reg = scanRegistry(root);
  const to = pickCurrentAccount(reg.accounts);
  const from = reg.accounts.filter((a) => a !== to);
  const plan = buildRestorePlan({ registry: reg, fromAccounts: from, toAccount: to });
  const copied = executeRestorePlan(plan);
  assert.equal(copied, 1);
  const target = path.join(newLeaf, 'local_aaa.json');
  const buf = fs.readFileSync(target);
  assert.notEqual(buf[0], 0xef, 'must not start with a UTF-8 BOM');
  const parsed = JSON.parse(buf.toString('utf8'));
  assert.deepEqual(parsed.bridgeSessionIds, []);
  assert.equal(parsed.title, 'alpha work');
});

test('backupRegistry copies the whole tree', () => {
  const { root } = makeFixture();
  const dest = backupRegistry(root);
  assert.ok(fs.existsSync(path.join(dest, 'account-old', 'leaf-1', 'local_aaa.json')));
  assert.ok(dest.includes('.backup-'));
});

test('activeLeaf picks the most recently used workspace dir', () => {
  const { root } = makeFixture();
  const reg = scanRegistry(root);
  const acc = pickCurrentAccount(reg.accounts);
  assert.equal(activeLeaf(acc).id, 'leaf-2');
});

// --- multi-profile ---------------------------------------------------------

// Two user-data dirs holding the *same* account, which is what a machine looks
// like once the user runs a second app instance with --user-data-dir.
function makeTwoProfiles({ bridges = ['session_live'] } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-multi-'));
  const mk = (name, sessions) => {
    const dir = path.join(base, name);
    const root = path.join(dir, 'claude-code-sessions');
    for (const s of sessions) {
      const leaf = path.join(root, s.account, 'leaf-1');
      fs.mkdirSync(leaf, { recursive: true });
      fs.writeFileSync(
        path.join(leaf, `local_${s.id}.json`),
        JSON.stringify({
          sessionId: `local_${s.id}`,
          cliSessionId: `cli-${s.id}`,
          cwd: '/w',
          title: s.id,
          lastActivityAt: s.at,
          isArchived: Boolean(s.archived),
          bridgeSessionIds: s.bridges || [],
        })
      );
    }
    if (sessions.length === 0) fs.mkdirSync(path.join(root, 'acc-shared', 'leaf-1'), { recursive: true });
    return { name, dir, root, activeAccountId: 'acc-shared' };
  };
  // "stale" still holds the account's sessions; "live" is where it signed in next.
  const stale = mk('stale', [
    { account: 'acc-shared', id: 'carried', at: 5000, bridges },
    { account: 'acc-other', id: 'foreign', at: 6000, bridges: ['session_other'] },
  ]);
  const live = mk('live', []);
  return { base, stale, live };
}

test('pickCurrentAccount trusts the declared account over the newest mtime', () => {
  const { root } = makeFixture();
  const reg = scanRegistry(root);
  assert.equal(pickCurrentAccount(reg.accounts).id, 'account-new', 'falls back to activity');
  assert.equal(pickCurrentAccount(reg.accounts, 'account-old').id, 'account-old', 'config.json wins');
  assert.equal(pickCurrentAccount(reg.accounts, 'account-gone').id, 'account-new', 'unknown id falls back');
});

test('scanProfiles resolves each profile independently and back-links accounts', () => {
  const { stale, live } = makeTwoProfiles();
  const [a, b] = scanProfiles([stale, live]);
  assert.equal(a.name, 'stale');
  assert.equal(a.current.id, 'acc-shared', 'declared account beats the newer acc-other');
  assert.equal(b.current.id, 'acc-shared');
  assert.equal(a.accounts.find((x) => x.id === 'acc-shared').profile, a, 'account knows its profile');
});

test('patchForRestore keeps bridgeSessionIds when the account is unchanged', () => {
  const data = { sessionId: 'local_x', bridgeSessionIds: ['session_a'] };
  assert.deepEqual(patchForRestore(data).bridgeSessionIds, [], 'cross-account still clears');
  assert.deepEqual(patchForRestore(data, { sameAccount: true }).bridgeSessionIds, ['session_a']);
  assert.deepEqual(data.bridgeSessionIds, ['session_a'], 'input must not be mutated');
});

test('restore across profiles carries the same account and flags foreign ones', () => {
  const { stale, live } = makeTwoProfiles();
  const [from, to] = scanProfiles([stale, live]);
  const plan = buildRestorePlan({ fromAccounts: from.accounts, toAccount: to.current });
  const items = Object.fromEntries(plan.items.map((i) => [i.session.name, i]));

  assert.equal(items['local_carried.json'].sameAccount, true);
  assert.equal(items['local_foreign.json'].sameAccount, false);
  assert.equal(items['local_carried.json'].sourceProfile.name, 'stale', 'plan records where it came from');

  assert.equal(executeRestorePlan(plan), 2);
  const leaf = path.join(to.root, 'acc-shared', 'leaf-1');
  const carried = JSON.parse(fs.readFileSync(path.join(leaf, 'local_carried.json'), 'utf8'));
  const foreign = JSON.parse(fs.readFileSync(path.join(leaf, 'local_foreign.json'), 'utf8'));
  assert.deepEqual(carried.bridgeSessionIds, ['session_live'], 'same account keeps its live bridges');
  assert.deepEqual(foreign.bridgeSessionIds, [], 'a different account must not carry bridges');
});

test('userDataRoot maps per platform', () => {
  const home = '/home/u';
  assert.equal(userDataRoot({ platform: 'win32', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, home }), 'C:\\Users\\u\\AppData\\Roaming');
  assert.equal(userDataRoot({ platform: 'darwin', env: {}, home }), path.join(home, 'Library', 'Application Support'));
  assert.equal(userDataRoot({ platform: 'linux', env: {}, home }), path.join(home, '.config'));
  assert.equal(userDataRoot({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, home }), '/xdg');
});

test('registryRoot maps per platform', () => {
  const home = '/home/u';
  assert.equal(
    registryRoot({ platform: 'win32', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, home }),
    path.join('C:\\Users\\u\\AppData\\Roaming', 'Claude', 'claude-code-sessions')
  );
  assert.equal(
    registryRoot({ platform: 'darwin', env: {}, home }),
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions')
  );
  assert.equal(
    registryRoot({ platform: 'linux', env: {}, home }),
    path.join(home, '.config', 'Claude', 'claude-code-sessions')
  );
});
