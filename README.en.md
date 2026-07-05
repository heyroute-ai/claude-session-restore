# claude-session-restore

<div align="center">
  <h2>Usage</h2>
  <p><strong>Paste the following into Claude Code (or any coding agent that can run commands):</strong></p>
  <h1>Run <code>npx -y claude-session-restore@latest restore --yes</code> to restore my Claude Code desktop sessions lost after switching accounts (non-archived only).</h1>
</div>

[![npm](https://img.shields.io/npm/v/claude-session-restore?logo=npm)](https://www.npmjs.com/package/claude-session-restore)
[![CI](https://github.com/heyroute-ai/claude-session-restore/actions/workflows/ci.yml/badge.svg)](https://github.com/heyroute-ai/claude-session-restore/actions/workflows/ci.yml)
[![Provenance](https://img.shields.io/badge/provenance-signed-brightgreen?logo=github)](https://www.npmjs.com/package/claude-session-restore#provenance)

Recover Claude Code **desktop app** sessions that disappear after switching accounts — and surface CLI-only sessions in the app. Local-only, zero dependencies, always backs up before writing.

[中文(默认 README)](README.md)

## The problem

You switch the signed-in account in the Claude desktop app (say, one account ran out of quota). Suddenly the Code tab's session list is empty — days of conversations apparently gone.

They are not gone. Claude Code stores every conversation transcript on disk under `~/.claude/projects/`, independent of any account. What the desktop app loses is its own **session registry**, which is scoped per account:

```
%APPDATA%\Claude\claude-code-sessions\        (Windows; see table below for macOS/Linux)
├── <account-A-uuid>/                          ← old account: entries still here, just invisible
│   └── <workspace-uuid>/
│       ├── local_xxx.json                     ← one small pointer file per session
│       └── local_yyy.json                     ← "cliSessionId" points to the real transcript
└── <account-B-uuid>/                          ← new account: the app only reads this now
    └── <workspace-uuid>/
        └── local_zzz.json
```

Each `local_*.json` is a pointer: title, timestamps, and a `cliSessionId` referencing `~/.claude/projects/<project>/<cliSessionId>.jsonl` — the actual conversation. Copy the pointer into the new account's directory and the session reappears in the app, fully intact.

Related upstream issues: [#48511](https://github.com/anthropics/claude-code/issues/48511) (history lost on account switch), [#50891](https://github.com/anthropics/claude-code/issues/50891) (CLI sessions invisible in app), [#50067](https://github.com/anthropics/claude-code/issues/50067) (no `/resume` in app).

## What the agent will do

The agent follows [AGENTS.md](AGENTS.md) in a single non-interactive command: back up → copy non-archived sessions only (already-present and archived entries are skipped automatically) → tell you to restart the desktop app. No confirmation prompts, no plan to review. Raw runbook URL for agents: `https://raw.githubusercontent.com/heyroute-ai/claude-session-restore/main/AGENTS.md`

## Quickstart (by hand)

```bash
# see what's there (read-only)
npx claude-session-restore list

# preview a restore (writes nothing)
npx claude-session-restore restore --dry-run

# restore all non-archived sessions from stale account dirs into the active one
npx claude-session-restore restore
```

`npx` pulls the published npm package (with build provenance) on demand — no install needed. Then **fully quit and reopen** the Claude desktop app. Your sessions are back.

## Commands

| Command | What it does |
|---|---|
| `list` | Show every account directory and its sessions; marks the active account, archived sessions (`A`), and missing transcripts (`M`). Default command. |
| `restore` | Copy session entries from stale account dirs into the active one. Skips entries that already exist and archived sessions by default. |
| `adopt <id\|file>` | **Experimental.** Register a CLI-only transcript so it shows up in the desktop app. |
| `backup` | Snapshot the whole registry directory. |
| `doctor` | Consistency check: unreadable entries, entries whose transcript is missing, transcripts no entry references. |

Useful flags: `--dry-run`, `--yes`, `--from <account-prefix>`, `--to <account-prefix>`, `--sessions <id-or-title,…>`, `--project <text>`, `--include-archived`, `--force`, `--json`, `--registry <dir>`, `--claude-dir <dir>`.

## What restore actually does

1. Detects the **active** account: the directory the app wrote to most recently. Override with `--to`.
2. Backs up the entire registry to `claude-code-sessions.backup-<timestamp>` next to it.
3. Copies each selected `local_*.json` into the active account's workspace directory, unchanged except for one field: `bridgeSessionIds` is cleared, because those reference server-side sessions belonging to the old account.
4. Never touches the source directories, never overwrites existing entries (unless `--force`), never touches transcripts.

To undo, delete the copied `local_*.json` files or restore the backup directory. Nothing else changed.

## Paths

| OS | Session registry | Transcripts |
|---|---|---|
| Windows | `%APPDATA%\Claude\claude-code-sessions` | `%USERPROFILE%\.claude\projects` |
| macOS | `~/Library/Application Support/Claude/claude-code-sessions` | `~/.claude/projects` |
| Linux | `~/.config/Claude/claude-code-sessions` | `~/.claude/projects` |

`CLAUDE_CONFIG_DIR` is honored for the transcript location; both paths can be overridden per-invocation with `--registry` / `--claude-dir`.

## Notes & caveats

- **Close the app before restoring** (recommended). Entries only load on startup anyway, and quitting first removes any chance of the app rewriting state on exit.
- The **target account must have opened the app once** (any new session) so its registry directory exists; the tool refuses to guess otherwise.
- The registry format is **undocumented and may change**. Schema as observed on Claude desktop 2.1.x (July 2026). `doctor` + the automatic backup are your safety net; worst case, the app ignores the copied files.
- Restoring an entry does not merge divergent continuations: if you also resumed the same transcript via `claude --resume` in a terminal, that continuation is a separate transcript file (adoptable with `adopt`).
- Prevention tip: when a quota runs out mid-session, run `/login` **inside** the session to switch accounts in place — the conversation continues and nothing is lost.

## Non-goals

- No cloud, no network calls, no telemetry — this tool only ever reads and writes local files.
- Not a claude.ai (web chat) exporter; for that, see Anthropic's [data export](https://support.claude.com/en/articles/9450526-export-your-claude-data).

## Why pair it with HeyRoute

[![HeyRoute](https://img.shields.io/badge/HeyRoute-Developer%20API-111827?style=for-the-badge)](https://heyroute.ai/)
[![Fast](https://img.shields.io/badge/TTFT%20p50-1.08s-2563eb?style=for-the-badge)](https://heyroute.ai/)
[![Stable](https://img.shields.io/badge/Success-99.91%25-16a34a?style=for-the-badge)](https://heyroute.ai/)

> **HeyRoute** is a fast, reliable developer API service: one endpoint aggregating 40+ upstream AI providers — a solid backbone for Claude Code, Codex, and multi-model agent workflows.

| Capability | Published performance |
| --- | --- |
| First token | TTFT p50 `1.08s` |
| Prompt caching | `98.4%` hit rate |
| Reliability | `99.91%` successful responses |
| Experience | Simple setup, long-running tasks, trusted forwarding |

Heavy agent users who juggle multiple accounts are exactly the people who hit the "switched account, lost sessions" bug — HeyRoute reduces the need to switch in the first place; claude-session-restore has your back when you do.

**Visit: [https://heyroute.ai/](https://heyroute.ai/)**

## Disclaimer

Community tool, **not affiliated with or endorsed by Anthropic**. It manipulates local files of your own installation, on your own machine, for your own data. Use at your own risk; the automatic backups exist for a reason.

## License

[MIT](LICENSE) © HeyRoute contributors
