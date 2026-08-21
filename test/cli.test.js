import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.js';
import { userDataRoot } from '../src/paths.js';

const bin = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

// A machine running the desktop app twice: the default install plus a second
// --user-data-dir, both signed into the same account. `acc-foreign` is newer
// than everything else, so an mtime-based guess would target the wrong dir.
function fixtureProfiles() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-profiles-'));
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
  };
  const root = userDataRoot({ platform: process.platform, env, home });
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-claude-'));
  fs.mkdirSync(path.join(claudeDir, 'projects'), { recursive: true });

  const build = (dir, activeAccountId, sessions) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ lastKnownAccountUuid: activeAccountId }));
    fs.mkdirSync(path.join(dir, 'claude-code-sessions', activeAccountId, 'leaf-1'), { recursive: true });
    for (const s of sessions) {
      const leaf = path.join(dir, 'claude-code-sessions', s.account, 'leaf-1');
      fs.mkdirSync(leaf, { recursive: true });
      fs.writeFileSync(
        path.join(leaf, `local_${s.id}.json`),
        JSON.stringify({
          sessionId: `local_${s.id}`,
          cliSessionId: `cli-${s.id}`,
          cwd: '/w',
          title: s.id,
          lastActivityAt: s.at,
          isArchived: false,
          bridgeSessionIds: ['session_keep'],
        })
      );
    }
    return path.join(dir, 'claude-code-sessions');
  };

  const defaultRoot = build(path.join(root, 'Claude'), 'acc-shared', [
    { account: 'acc-shared', id: 'carried', at: 5000 },
    { account: 'acc-foreign', id: 'foreign', at: 9000 },
  ]);
  const betaRoot = build(path.join(root, 'Claude-Profiles', 'beta'), 'acc-shared', []);
  const betaLeaf = path.join(betaRoot, 'acc-shared', 'leaf-1');
  const run = (args) => execFileSync(process.execPath, [bin, ...args, '--claude-dir', claudeDir], { encoding: 'utf8', env });
  return { run, defaultRoot, betaRoot, betaLeaf };
}

test('cli profiles lists every user-data dir it found', () => {
  const { run } = fixtureProfiles();
  const out = run(['profiles']);
  assert.ok(out.includes('default'), out);
  assert.ok(out.includes('beta'), out);
});

test('cli restore --to-profile carries the same account across profiles, not other accounts', () => {
  const { run, betaLeaf } = fixtureProfiles();
  const out = run(['restore', '--to-profile', 'beta', '--yes']);
  assert.ok(out.includes('1 to copy'), out);
  assert.ok(out.includes('from profile'), 'cross-profile plans show their source');

  assert.ok(fs.existsSync(path.join(betaLeaf, 'local_carried.json')), 'the account own sessions come over');
  assert.ok(!fs.existsSync(path.join(betaLeaf, 'local_foreign.json')), 'a different account must not be swept in');
  const carried = JSON.parse(fs.readFileSync(path.join(betaLeaf, 'local_carried.json'), 'utf8'));
  assert.deepEqual(carried.bridgeSessionIds, ['session_keep'], 'same account keeps its bridges');
});

test('cli restore --all-accounts opts into the wider sweep', () => {
  const { run, betaLeaf } = fixtureProfiles();
  const out = run(['restore', '--to-profile', 'beta', '--all-accounts', '--yes']);
  assert.ok(out.includes('2 to copy'), out);
  const foreign = JSON.parse(fs.readFileSync(path.join(betaLeaf, 'local_foreign.json'), 'utf8'));
  assert.deepEqual(foreign.bridgeSessionIds, [], 'crossing accounts still clears bridges');
});

test('cli restore backs up the target profile, not the default one', () => {
  const { run, defaultRoot, betaRoot } = fixtureProfiles();
  const out = run(['restore', '--to-profile', 'beta', '--yes']);
  const backup = out.split('\n').find((l) => l.includes('Backup of the previous registry state'));
  assert.ok(backup.includes(`${betaRoot}.backup-`), backup);
  assert.ok(!backup.includes(`${defaultRoot}.backup-`), 'must not snapshot an unrelated profile');
  assert.ok(!fs.existsSync(`${defaultRoot}.backup-`), 'default profile is left alone');
});

test('parseArgs handles value flags, boolean flags and positionals', () => {
  const parsed = parseArgs(['restore', '--from', 'abc', '--dry-run', '--sessions=one,two', '-y', 'extra']);
  assert.equal(parsed.command, 'restore');
  assert.deepEqual(parsed.positionals, ['extra']);
  assert.equal(parsed.flags.from, 'abc');
  assert.equal(parsed.flags['dry-run'], true);
  assert.equal(parsed.flags.sessions, 'one,two');
  assert.equal(parsed.flags.yes, true);
});

test('parseArgs does not eat a following flag as a value', () => {
  const parsed = parseArgs(['restore', '--from', '--dry-run']);
  assert.equal(parsed.flags.from, true);
  assert.equal(parsed.flags['dry-run'], true);
});

function fixtureRegistry() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-e2e-'));
  const leaf = path.join(root, 'acc-1', 'leaf-1');
  fs.mkdirSync(leaf, { recursive: true });
  fs.writeFileSync(
    path.join(leaf, 'local_e2e.json'),
    JSON.stringify({ sessionId: 'local_e2e', cliSessionId: 'cli-e2e', cwd: '/w', title: 'end to end', lastActivityAt: 1751600000000, isArchived: false, bridgeSessionIds: [] })
  );
  return root;
}

test('cli list runs end-to-end against a fixture registry', () => {
  const root = fixtureRegistry();
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-claude-'));
  fs.mkdirSync(path.join(claudeDir, 'projects'), { recursive: true });
  const out = execFileSync(process.execPath, [bin, 'list', '--registry', root, '--claude-dir', claudeDir], { encoding: 'utf8' });
  assert.ok(out.includes('acc-1'));
  assert.ok(out.includes('end to end'));
});

test('cli restore --dry-run reports the plan without writing', () => {
  const root = fixtureRegistry();
  const leaf2 = path.join(root, 'acc-2', 'leaf-2');
  fs.mkdirSync(leaf2, { recursive: true });
  fs.writeFileSync(
    path.join(leaf2, 'local_now.json'),
    JSON.stringify({ sessionId: 'local_now', cliSessionId: 'cli-now', cwd: '/w', title: 'active', lastActivityAt: 1751700000000, isArchived: false, bridgeSessionIds: [] })
  );
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-claude-'));
  fs.mkdirSync(path.join(claudeDir, 'projects'), { recursive: true });
  const out = execFileSync(process.execPath, [bin, 'restore', '--dry-run', '--registry', root, '--claude-dir', claudeDir], { encoding: 'utf8' });
  assert.ok(out.includes('1 to copy'));
  assert.ok(out.includes('Dry run'));
  assert.ok(!fs.existsSync(path.join(leaf2, 'local_e2e.json')), 'dry run must not write');
});

test('cli --version prints the package version', () => {
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  const out = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(out.trim(), pkg.version);
});
