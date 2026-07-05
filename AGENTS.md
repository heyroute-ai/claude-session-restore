# AGENTS.md — runbook for coding agents

You are here because a user asked you to recover Claude Code **desktop app** sessions that vanished after switching accounts (or to surface CLI-only sessions in the app). This file is the standard procedure. Follow it with the tool — do **not** hand-edit registry files.

## 0. Always call the tool, never reimplement

This tool exists so you run **one command**, not so you reverse-engineer the registry format. Do **not** read, scan, or copy `local_*.json` yourself; do **not** write your own script; do **not** guess which directory is the active account. The CLI already does active-account detection, the account-specific `bridgeSessionIds` reset, BOM-less encoding, and automatic backup. If `npx` fails, fix the environment (see Troubleshooting) — **never** fall back to manual file surgery. Hand-copying costs more tokens, skips the backup, and gets the edge cases wrong.

## Requirements

- Node.js >= 18 (`node --version`).
- Shell access on the user's machine. Everything is local; no network calls beyond fetching this tool.
- Tool invocation: `npx -y claude-session-restore@latest <command>` (published to npm, provenance-signed). Fallback if npm is unreachable: `npx github:heyroute-ai/claude-session-restore <command>`.

## Standard flow: restore after an account switch

Default to **one non-interactive command** — no dry-run, no plan to show, no confirmation. `--yes` skips the TTY prompt; archived and already-present entries are skipped automatically; the registry is backed up first. Only add the interactive/flag steps below if the user explicitly asks to preview or to include specific/archived sessions.

1. **Restore (one shot).**
   ```
   npx -y claude-session-restore@latest restore --yes
   ```
   The tool snapshots the whole registry first and prints the backup path — **relay that path to the user**. Then report what it copied.
   - `Nothing to restore` / only one account directory → nothing was lost by an account switch; you may run `doctor` to double-check, then stop.
   - `Registry not found` → the Claude desktop app isn't installed / has never run here. Stop and tell the user.
   - `Error: account … has no session directory yet` → the user must open the desktop app once under the new account, then retry.

2. **Hand back.** Tell the user to **fully quit** the Claude desktop app (system tray too) and reopen it; the sessions appear in the Code tab. If your own session runs inside that app, say this *last* — restarting kills you.

### Only when the user explicitly asks to preview or narrow the set

- Preview: `restore --dry-run` (shows counts/titles, writes nothing).
- Include archived: `--include-archived` (opt-in; otherwise archived stays untouched).
- Specific conversations: `--sessions <id-or-title-fragment,…>` or `--project <path-fragment>`.
- Wrong target account (rare): pin with `--to <account-uuid-prefix>`.
- Confirm afterwards: `list` shows the restored titles under the account marked `active`.

## Rules

- Never pass `--force` unless the user explicitly asked to overwrite existing entries.
- Never restore archived sessions without telling the user (`--include-archived` is opt-in).
- Do not edit `local_*.json` by hand; the tool already handles the account-specific field (`bridgeSessionIds`), BOM-less encoding, and backups.
- `Error: account … has no session directory yet` → the user must open the desktop app once under the new account (any new session), then retry.
- Rollback, if ever needed: restore the printed backup directory, or delete the copied `local_*.json` files from the active account's directory.

## Variant: surface CLI-only sessions in the app

```
npx -y claude-session-restore@latest doctor          # lists unreferenced transcripts
npx -y claude-session-restore@latest adopt <cli-session-id> --yes
```
`adopt` is experimental (synthesized registry entry) — say so when reporting. Same restart step applies.

## Troubleshooting

- **Windows PowerShell: "running scripts is disabled"** on `npx` → use `npx.cmd …`, or run from Git Bash, or `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`.
- Ambiguous `--from/--to` prefix → the error lists candidates; use a longer prefix.
- Full background: [README.md](README.md) (中文, default) / [README.en.md](README.en.md) (English). Paths per OS are listed in both.
