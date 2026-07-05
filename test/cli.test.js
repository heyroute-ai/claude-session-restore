import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.js';

const bin = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

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
