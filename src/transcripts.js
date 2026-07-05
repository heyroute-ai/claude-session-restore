import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

// Map of cli-session-uuid -> transcript info, across every project slug.
export function scanTranscripts(projectsRoot) {
  const map = new Map();
  if (!fs.existsSync(projectsRoot)) return map;
  for (const proj of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const projDir = path.join(projectsRoot, proj.name);
    for (const f of fs.readdirSync(projDir, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const file = path.join(projDir, f.name);
      const st = fs.statSync(file);
      map.set(f.name.slice(0, -'.jsonl'.length), { file, projectDir: projDir, mtimeMs: st.mtimeMs, size: st.size });
    }
  }
  return map;
}

function messageText(message) {
  const c = message && message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    const block = c.find((b) => b && b.type === 'text' && typeof b.text === 'string');
    return block ? block.text : undefined;
  }
  return undefined;
}

function tidy(text, max = 60) {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat || flat.startsWith('<')) return undefined; // skip command/tag payloads
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export async function extractMeta(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let cwd;
  let firstUserText;
  let lastSummary;
  let model;
  let minTs = Infinity;
  let maxTs = 0;
  let userTurns = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd;
    if (obj.timestamp) {
      const t = Date.parse(obj.timestamp);
      if (!Number.isNaN(t)) {
        if (t < minTs) minTs = t;
        if (t > maxTs) maxTs = t;
      }
    }
    if (obj.type === 'summary' && typeof obj.summary === 'string') lastSummary = obj.summary;
    if (obj.type === 'user' && obj.message) {
      userTurns++;
      if (!firstUserText) firstUserText = messageText(obj.message);
    }
    if (obj.type === 'assistant' && obj.message && typeof obj.message.model === 'string') model = obj.message.model;
  }
  const title = tidy(lastSummary) || tidy(firstUserText) || path.basename(file, '.jsonl');
  return {
    cwd,
    title,
    model,
    createdAt: Number.isFinite(minTs) ? minTs : Date.now(),
    lastActivityAt: maxTs || Date.now(),
    completedTurns: userTurns,
  };
}

// Synthesize a registry entry for a transcript the app has never seen
// (e.g. a session created by the CLI). Field set mirrors what the desktop
// app writes for its own sessions.
export function makeAdoptedEntry(cliSessionId, meta) {
  return {
    sessionId: `local_${randomUUID()}`,
    cliSessionId,
    cwd: meta.cwd,
    originCwd: meta.cwd,
    lastFocusedAt: meta.lastActivityAt,
    createdAt: meta.createdAt,
    lastActivityAt: meta.lastActivityAt,
    ...(meta.model ? { model: meta.model } : {}),
    isArchived: false,
    title: meta.title,
    titleSource: 'auto',
    permissionMode: 'default',
    remoteMcpServersConfig: [],
    completedTurns: meta.completedTurns,
    bridgeSessionIds: [],
    classifierSummaryEnabled: true,
    spawnSeed: {},
  };
}
