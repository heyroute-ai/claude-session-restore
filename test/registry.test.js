import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scanRegistry,
  pickCurrentAccount,
  activeLeaf,
  matchAccount,
  patchForRestore,
  buildRestorePlan,
  executeRestorePlan,
  backupRegistry,
} from '../src/registry.js';
import { registryRoot } from '../src/paths.js';

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
