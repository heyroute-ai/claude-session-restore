import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanTranscripts, extractMeta, makeAdoptedEntry } from '../src/transcripts.js';

function makeProjects() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-proj-'));
  const proj = path.join(root, 'C--work-demo');
  fs.mkdirSync(proj, { recursive: true });
  const lines = [
    JSON.stringify({
      type: 'user',
      cwd: 'C:\\work\\demo',
      timestamp: '2026-07-01T10:00:00.000Z',
      message: { role: 'user', content: 'Fix   the login bug\nplease' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-07-01T10:01:00.000Z',
      message: { role: 'assistant', model: 'claude-fable-5', content: [{ type: 'text', text: 'On it.' }] },
    }),
    'this line is not json and must be skipped',
    JSON.stringify({
      type: 'user',
      timestamp: '2026-07-01T10:05:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
    }),
    JSON.stringify({ type: 'summary', summary: 'Login bug fix session' }),
  ];
  fs.writeFileSync(path.join(proj, 'abc-123.jsonl'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(proj, 'not-a-transcript.txt'), 'ignore me');
  return { root, proj };
}

test('scanTranscripts indexes jsonl files by cli session id', () => {
  const { root, proj } = makeProjects();
  const map = scanTranscripts(root);
  assert.equal(map.size, 1);
  assert.equal(map.get('abc-123').projectDir, proj);
});

test('scanTranscripts tolerates a missing root', () => {
  assert.equal(scanTranscripts(path.join(os.tmpdir(), 'ccsr-nope')).size, 0);
});

test('extractMeta prefers the summary title and collects stats', async () => {
  const { root } = makeProjects();
  const meta = await extractMeta(path.join(root, 'C--work-demo', 'abc-123.jsonl'));
  assert.equal(meta.title, 'Login bug fix session');
  assert.equal(meta.cwd, 'C:\\work\\demo');
  assert.equal(meta.model, 'claude-fable-5');
  assert.equal(meta.completedTurns, 2);
  assert.equal(meta.createdAt, Date.parse('2026-07-01T10:00:00.000Z'));
  assert.equal(meta.lastActivityAt, Date.parse('2026-07-01T10:05:00.000Z'));
});

test('extractMeta falls back to the first user message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsr-meta-'));
  const file = path.join(dir, 'x.jsonl');
  fs.writeFileSync(
    file,
    JSON.stringify({ type: 'user', cwd: '/w', timestamp: '2026-07-02T00:00:00Z', message: { content: 'Ship the   release notes' } }) + '\n'
  );
  const meta = await extractMeta(file);
  assert.equal(meta.title, 'Ship the release notes');
});

test('makeAdoptedEntry mirrors the app schema', async () => {
  const { root } = makeProjects();
  const meta = await extractMeta(path.join(root, 'C--work-demo', 'abc-123.jsonl'));
  const entry = makeAdoptedEntry('abc-123', meta);
  assert.match(entry.sessionId, /^local_[0-9a-f-]{36}$/);
  assert.equal(entry.cliSessionId, 'abc-123');
  assert.equal(entry.cwd, entry.originCwd);
  assert.equal(entry.isArchived, false);
  assert.deepEqual(entry.bridgeSessionIds, []);
  assert.equal(entry.permissionMode, 'default');
  assert.equal(entry.titleSource, 'auto');
});
