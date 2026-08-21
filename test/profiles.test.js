import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverProfiles, matchProfile, readActiveAccountId } from '../src/profiles.js';
import { userDataRoot } from '../src/paths.js';

// Builds a user-data root that works on every platform: HOME covers darwin,
// XDG_CONFIG_HOME covers linux, APPDATA covers win32.
export function makeProfileTree() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-home-'));
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
  };
  const opts = { platform: process.platform, env, home };
  const root = userDataRoot(opts);

  const profile = (dir, accountId, sessions = []) => {
    fs.mkdirSync(dir, { recursive: true });
    if (accountId) {
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ lastKnownAccountUuid: accountId, other: 1 }));
    }
    for (const s of sessions) {
      const leaf = path.join(dir, 'claude-code-sessions', s.account, s.leaf || 'leaf-1');
      fs.mkdirSync(leaf, { recursive: true });
      fs.writeFileSync(
        path.join(leaf, `local_${s.id}.json`),
        JSON.stringify({
          sessionId: `local_${s.id}`,
          cliSessionId: `cli-${s.id}`,
          cwd: '/w',
          title: s.title || s.id,
          lastActivityAt: s.at,
          isArchived: Boolean(s.archived),
          bridgeSessionIds: s.bridges || [],
        })
      );
    }
    if (sessions.length === 0 && accountId) {
      fs.mkdirSync(path.join(dir, 'claude-code-sessions', accountId, 'leaf-1'), { recursive: true });
    }
    return dir;
  };

  return { home, env, opts, root, profile };
}

test('discoverProfiles finds the default install and nested --user-data-dir profiles', () => {
  const { opts, root, profile } = makeProfileTree();
  profile(path.join(root, 'Claude'), 'acc-a', [{ account: 'acc-a', id: 'one', at: 3000 }]);
  profile(path.join(root, 'Claude-Profiles', 'beta'), 'acc-b', [{ account: 'acc-b', id: 'two', at: 2000 }]);
  // Ignored: no registry directory at all, and a non-Claude sibling.
  fs.mkdirSync(path.join(root, 'Claude-Profiles', 'gamma'), { recursive: true });
  profile(path.join(root, 'Unrelated'), 'acc-c', [{ account: 'acc-c', id: 'three', at: 1000 }]);

  const found = discoverProfiles(opts);
  assert.deepEqual(found.map((p) => p.name).sort(), ['beta', 'default']);
  const byName = Object.fromEntries(found.map((p) => [p.name, p]));
  assert.equal(byName.default.activeAccountId, 'acc-a');
  assert.equal(byName.beta.activeAccountId, 'acc-b');
  assert.equal(byName.beta.root, path.join(root, 'Claude-Profiles', 'beta', 'claude-code-sessions'));
});

test('discoverProfiles also accepts a profile directory named explicitly', () => {
  const { opts, root, profile } = makeProfileTree();
  profile(path.join(root, 'Claude'), 'acc-a', [{ account: 'acc-a', id: 'one', at: 1 }]);
  const outside = profile(path.join(os.tmpdir(), `ccsr-outside-${process.pid}`), 'acc-z', [{ account: 'acc-z', id: 'z', at: 1 }]);

  const found = discoverProfiles({ ...opts, extraDirs: [outside] });
  assert.equal(found.length, 2);
  assert.ok(found.some((p) => p.dir === path.resolve(outside)));
});

test('discoverProfiles tolerates a machine with no Claude data at all', () => {
  const { opts } = makeProfileTree();
  assert.deepEqual(discoverProfiles(opts), []);
});

test('readActiveAccountId reads lastKnownAccountUuid and tolerates junk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-cfg-'));
  assert.equal(readActiveAccountId(dir), undefined, 'missing config.json');
  fs.writeFileSync(path.join(dir, 'config.json'), '{not json');
  assert.equal(readActiveAccountId(dir), undefined, 'unparseable config.json');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ theme: 'dark' }));
  assert.equal(readActiveAccountId(dir), undefined, 'field absent');
  fs.writeFileSync(path.join(dir, 'config.json'), '﻿' + JSON.stringify({ lastKnownAccountUuid: 'acc-a' }));
  assert.equal(readActiveAccountId(dir), 'acc-a', 'BOM-prefixed config.json');
});

test('matchProfile resolves exact names, substrings and rejects ambiguity', () => {
  const profiles = [{ name: 'default', dir: '/x/Claude' }, { name: 'beta', dir: '/x/Claude-Profiles/beta' }, { name: 'beta-2', dir: '/x/Claude-Profiles/beta-2' }];
  assert.equal(matchProfile(profiles, 'default').name, 'default');
  assert.equal(matchProfile(profiles, 'beta').name, 'beta', 'exact name wins over substring');
  assert.equal(matchProfile(profiles, 'beta-2').name, 'beta-2');
  assert.throws(() => matchProfile(profiles, 'bet'), /ambiguous/);
  assert.throws(() => matchProfile(profiles, 'nope'), /no profile matches/);
});
