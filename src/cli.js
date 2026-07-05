import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { registryRoot, projectsRoot } from './paths.js';
import {
  scanRegistry,
  pickCurrentAccount,
  activeLeaf,
  matchAccount,
  buildRestorePlan,
  executeRestorePlan,
  backupRegistry,
  writeEntry,
} from './registry.js';
import { scanTranscripts, extractMeta, makeAdoptedEntry } from './transcripts.js';

const VALUE_FLAGS = new Set(['from', 'to', 'registry', 'claude-dir', 'sessions', 'project']);

export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (VALUE_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg === '-y') {
      flags.yes = true;
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0], positionals: positionals.slice(1), flags };
}

function fmtTime(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const short = (id, n = 8) => (typeof id === 'string' ? id.slice(0, n) : '?');

function printTable(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, col) => Math.max(...all.map((r) => String(r[col] ?? '').length)));
  for (const row of all) {
    console.log('  ' + row.map((cell, col) => String(cell ?? '').padEnd(widths[col])).join('  '));
  }
}

function appRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FI "IMAGENAME eq Claude.exe" /NH', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return out.toLowerCase().includes('claude.exe');
    }
    const cmd = process.platform === 'darwin' ? 'pgrep -x Claude' : 'pgrep -if "claude(-desktop)?$"';
    return execSync(`${cmd} || true`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0;
  } catch {
    return false;
  }
}

async function confirm(question, flags) {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) {
    console.error('Not an interactive terminal; pass --yes to proceed.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

function loadContext(flags) {
  const root = flags.registry || registryRoot();
  const projects = flags['claude-dir'] ? path.join(flags['claude-dir'], 'projects') : projectsRoot();
  const registry = scanRegistry(root);
  return { root, projects, registry };
}

function resolveAccounts(registry, flags) {
  const current = pickCurrentAccount(registry.accounts);
  const to = flags.to ? matchAccount(registry.accounts, flags.to) : current;
  const from = flags.from
    ? [matchAccount(registry.accounts, flags.from)]
    : registry.accounts.filter((a) => to && a.id !== to.id);
  return { current, to, from };
}

function cmdList({ registry, projects }, flags) {
  if (registry.accounts.length === 0) {
    console.log(`No session registry found at ${registry.root}`);
    console.log('Is the Claude desktop app installed on this machine?');
    return 1;
  }
  const transcripts = scanTranscripts(projects);
  const current = pickCurrentAccount(registry.accounts);
  if (flags.json) {
    console.log(JSON.stringify({ root: registry.root, currentAccount: current?.id, accounts: registry.accounts }, null, 2));
    return 0;
  }
  console.log(`Registry: ${registry.root}\n`);
  for (const acc of registry.accounts) {
    const tag = acc === current ? 'active — the app writes here now' : 'stale — invisible after account switch';
    console.log(`Account ${acc.id}  (${tag}, last activity ${fmtTime(acc.lastActivityAt)})`);
    const rows = [];
    for (const leaf of acc.leaves) {
      for (const s of leaf.sessions.slice().sort((a, b) => (b.data.lastActivityAt || 0) - (a.data.lastActivityAt || 0))) {
        if (s.data.__parseError) {
          rows.push([short(s.name.slice('local_'.length)), '?', '!', fmtTime(s.mtimeMs), `unreadable: ${s.data.__parseError}`]);
          continue;
        }
        const hasTranscript = transcripts.has(s.data.cliSessionId);
        rows.push([
          short(s.data.sessionId?.replace(/^local_/, '')),
          short(s.data.cliSessionId),
          `${s.data.isArchived ? 'A' : ' '}${hasTranscript ? ' ' : 'M'}`,
          fmtTime(s.data.lastActivityAt),
          (s.data.title || '(untitled)').slice(0, 48),
        ]);
      }
    }
    printTable(['local id', 'cli id', '', 'last activity', 'title'], rows);
    console.log('');
  }
  console.log('Flags: A = archived, M = transcript file missing on disk');
  return 0;
}

async function cmdRestore(ctx, flags) {
  const { registry, root } = ctx;
  const { current, to, from } = resolveAccounts(registry, flags);
  if (!to) {
    console.error('No accounts found in the registry.');
    return 1;
  }
  if (from.length === 0) {
    console.log('Nothing to restore: only one account directory exists.');
    return 0;
  }
  const sessionFilters = flags.sessions ? String(flags.sessions).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const plan = buildRestorePlan({
    registry,
    fromAccounts: from,
    toAccount: to,
    includeArchived: Boolean(flags['include-archived']),
    force: Boolean(flags.force),
    sessionFilters,
    projectFilter: flags.project,
  });
  const copies = plan.items.filter((i) => i.action === 'copy');
  const skips = plan.items.filter((i) => i.action !== 'copy');

  console.log(`Restore into account ${to.id}${to === current ? ' (active)' : ''}`);
  console.log(`Target directory: ${plan.targetLeaf.dir}\n`);
  if (plan.items.length === 0) {
    console.log('No sessions matched.');
    return 0;
  }
  printTable(
    ['action', 'cli id', 'last activity', 'title'],
    plan.items.map((i) => [i.action, short(i.session.data.cliSessionId), fmtTime(i.session.data.lastActivityAt), (i.session.data.title || i.session.name).slice(0, 48)])
  );
  console.log(`\n${copies.length} to copy, ${skips.length} skipped (already present / archived / invalid)`);
  if (flags['dry-run']) {
    console.log('Dry run — nothing written.');
    return 0;
  }
  if (copies.length === 0) return 0;
  if (appRunning()) {
    console.log('\nWarning: the Claude desktop app appears to be running. Entries land after a full restart; quitting the app first avoids any chance of it overwriting them on exit.');
  }
  if (!(await confirm(`Copy ${copies.length} session entr${copies.length === 1 ? 'y' : 'ies'}?`, flags))) return 1;
  const backup = backupRegistry(root);
  const copied = executeRestorePlan(plan);
  console.log(`\nDone: ${copied} entr${copied === 1 ? 'y' : 'ies'} restored.`);
  console.log(`Backup of the previous registry state: ${backup}`);
  console.log('Fully quit and reopen the Claude desktop app to see them.');
  return 0;
}

function cmdBackup(ctx) {
  if (!fs.existsSync(ctx.root)) {
    console.error(`No registry at ${ctx.root}`);
    return 1;
  }
  console.log(`Backup written to: ${backupRegistry(ctx.root)}`);
  return 0;
}

function cmdDoctor(ctx) {
  const { registry, projects } = ctx;
  const transcripts = scanTranscripts(projects);
  let warnings = 0;
  const note = (msg) => {
    warnings++;
    console.log(`  WARN  ${msg}`);
  };
  console.log(`Registry:    ${registry.root} (${registry.accounts.length} account dir${registry.accounts.length === 1 ? '' : 's'})`);
  console.log(`Transcripts: ${projects} (${transcripts.size} session file${transcripts.size === 1 ? '' : 's'})\n`);
  if (registry.accounts.length === 0) note('no session registry found — has the desktop app ever run here?');

  const registered = new Set();
  for (const acc of registry.accounts) {
    for (const leaf of acc.leaves) {
      for (const s of leaf.sessions) {
        if (s.data.__parseError) {
          note(`${path.relative(registry.root, s.file)} is not valid JSON (${s.data.__parseError})`);
          continue;
        }
        registered.add(s.data.cliSessionId);
        if (!transcripts.has(s.data.cliSessionId)) {
          note(`${s.data.title || s.name}: transcript ${short(s.data.cliSessionId)}… not found under ${projects} (entry will open empty)`);
        }
      }
    }
  }
  const unregistered = [...transcripts.keys()].filter((id) => !registered.has(id));
  if (unregistered.length > 0) {
    console.log(`  INFO  ${unregistered.length} transcript(s) exist that no app entry references (CLI-only sessions).`);
    console.log('        Use "adopt <cli-session-id>" to surface one in the desktop app.');
  }
  console.log(warnings === 0 ? '\nAll good.' : `\n${warnings} warning(s).`);
  return 0;
}

async function cmdAdopt(ctx, flags, positionals) {
  const target = positionals[0];
  if (!target) {
    console.error('Usage: adopt <cli-session-id | path-to-transcript.jsonl>');
    return 1;
  }
  const { registry, root, projects } = ctx;
  const { current, to } = resolveAccounts(registry, flags);
  if (!to) {
    console.error('No accounts found in the registry.');
    return 1;
  }
  let file;
  let cliSessionId;
  if (target.endsWith('.jsonl')) {
    file = path.resolve(target);
    cliSessionId = path.basename(file, '.jsonl');
  } else {
    const transcripts = scanTranscripts(projects);
    const hits = [...transcripts.keys()].filter((id) => id.startsWith(target));
    if (hits.length === 0) {
      console.error(`No transcript under ${projects} matches "${target}".`);
      return 1;
    }
    if (hits.length > 1) {
      console.error(`"${target}" is ambiguous: ${hits.map((h) => short(h)).join(', ')}`);
      return 1;
    }
    cliSessionId = hits[0];
    file = transcripts.get(cliSessionId).file;
  }
  if (!fs.existsSync(file)) {
    console.error(`Transcript not found: ${file}`);
    return 1;
  }
  for (const acc of registry.accounts) {
    for (const leaf of acc.leaves) {
      const hit = leaf.sessions.find((s) => s.data.cliSessionId === cliSessionId);
      if (hit && acc.id === to.id) {
        console.log(`Already registered in the target account as "${hit.data.title}". Nothing to do.`);
        return 0;
      }
      if (hit) {
        console.log(`Note: already registered under stale account ${short(acc.id)}… — "restore" would keep its original metadata. Continuing will create a fresh entry.`);
      }
    }
  }
  const meta = await extractMeta(file);
  const entry = makeAdoptedEntry(cliSessionId, meta);
  const leaf = activeLeaf(to);
  if (!leaf) {
    console.error(`Account ${to.id} has no session directory yet — open the app once under this account first.`);
    return 1;
  }
  console.log('EXPERIMENTAL: adopt synthesizes a registry entry from observed schema; a future app update may ignore or rewrite it.\n');
  console.log(`  title:  ${entry.title}`);
  console.log(`  cwd:    ${entry.cwd}`);
  console.log(`  turns:  ${entry.completedTurns}, last activity ${fmtTime(entry.lastActivityAt)}`);
  console.log(`  into:   ${leaf.dir}${to === current ? '' : ` (account ${short(to.id)}…)`}\n`);
  if (flags['dry-run']) {
    console.log('Dry run — nothing written.');
    return 0;
  }
  if (!(await confirm('Write this entry?', flags))) return 1;
  const backup = backupRegistry(root);
  const written = writeEntry(leaf.dir, entry);
  console.log(`\nWritten: ${written}`);
  console.log(`Backup: ${backup}`);
  console.log('Fully quit and reopen the Claude desktop app to see it.');
  return 0;
}

function help() {
  console.log(`claude-session-restore — recover Claude Code desktop sessions lost after switching accounts

Usage: claude-session-restore <command> [options]

Commands:
  list               Show every account directory and its sessions (default)
  restore            Copy session entries from stale account dirs into the active one
  adopt <id|file>    EXPERIMENTAL: register a CLI transcript so it shows in the app
  backup             Snapshot the registry directory
  doctor             Check registry/transcript consistency
  help               Show this help

Options:
  --from <prefix>       Source account directory (default: every non-target account)
  --to <prefix>         Target account directory (default: most recently active)
  --sessions <a,b,c>    Only sessions matching these id/title fragments
  --project <text>      Only sessions whose cwd contains <text>
  --include-archived    Also restore archived sessions
  --force               Overwrite entries that already exist in the target
  --dry-run             Show the plan without writing
  --yes, -y             Skip the confirmation prompt
  --json                Machine-readable output (list)
  --registry <dir>      Override the registry location
  --claude-dir <dir>    Override ~/.claude (transcript location)

Nothing leaves your machine; every write is preceded by a full registry backup.`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, positionals, flags } = parseArgs(argv);
  if (flags.version) {
    const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    console.log(pkg.version);
    return 0;
  }
  if (flags.help || command === 'help') return help();
  const ctx = loadContext(flags);
  try {
    switch (command) {
      case undefined:
      case 'list':
        return cmdList(ctx, flags);
      case 'restore':
        return await cmdRestore(ctx, flags);
      case 'backup':
        return cmdBackup(ctx);
      case 'doctor':
        return cmdDoctor(ctx);
      case 'adopt':
        return await cmdAdopt(ctx, flags, positionals);
      default:
        console.error(`Unknown command: ${command}\n`);
        help();
        return 1;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return 1;
  }
}
