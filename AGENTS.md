# AGENTS.md — runbook for coding agents

You are here because a user asked you to recover Claude Code **desktop app** sessions that vanished after switching accounts (or to surface CLI-only sessions in the app). This file is the standard procedure. Follow it with the tool — do **not** hand-edit registry files.

## Requirements

- Node.js >= 18 (`node --version`).
- Shell access on the user's machine. Everything is local; no network calls beyond fetching this tool.
- Tool invocation: `npx github:heyroute-ai/claude-session-restore <command>` (once published to npm: `npx claude-session-restore <command>`).

## Standard flow: restore after an account switch

1. **Inspect (read-only).**
   ```
   npx github:heyroute-ai/claude-session-restore list
   ```
   - Registry not found → the Claude desktop app isn't installed / has never run here. Stop and tell the user.
   - Only one account directory → nothing was lost by an account switch; see `doctor` instead.

2. **Preview.**
   ```
   npx github:heyroute-ai/claude-session-restore restore --dry-run
   ```
   Show the user the plan (counts and titles). Adjust before executing:
   - Everything `skip-exists` → already restored; go to step 5.
   - Sessions the user wants are `skip-archived` → confirm with the user, then add `--include-archived`.
   - User wants only specific conversations → `--sessions <id-or-title-fragment,…>` or `--project <path-fragment>`.
   - Wrong target account picked (rare) → pin it with `--to <account-uuid-prefix>`.

3. **Execute.** Same command without `--dry-run`, plus `--yes` (the prompt needs a TTY you may not have):
   ```
   npx github:heyroute-ai/claude-session-restore restore --yes [flags from step 2]
   ```
   The tool snapshots the whole registry first and prints the backup path — **relay that path to the user**.

4. **Verify.** Run `list` again: the restored titles must now appear under the account marked `active`.

5. **Hand back.** Tell the user to **fully quit** the Claude desktop app (system tray too) and reopen it; the sessions appear in the Code tab. If your own session runs inside that app, say this *last* — restarting kills you.

## Rules

- Never pass `--force` unless the user explicitly asked to overwrite existing entries.
- Never restore archived sessions without telling the user (`--include-archived` is opt-in).
- Do not edit `local_*.json` by hand; the tool already handles the account-specific field (`bridgeSessionIds`), BOM-less encoding, and backups.
- `Error: account … has no session directory yet` → the user must open the desktop app once under the new account (any new session), then retry.
- Rollback, if ever needed: restore the printed backup directory, or delete the copied `local_*.json` files from the active account's directory.

## Variant: surface CLI-only sessions in the app

```
npx github:heyroute-ai/claude-session-restore doctor          # lists unreferenced transcripts
npx github:heyroute-ai/claude-session-restore adopt <cli-session-id> --yes
```
`adopt` is experimental (synthesized registry entry) — say so when reporting. Same restart step applies.

## Troubleshooting

- **Windows PowerShell: "running scripts is disabled"** on `npx` → use `npx.cmd …`, or run from Git Bash, or `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`.
- Ambiguous `--from/--to` prefix → the error lists candidates; use a longer prefix.
- Full background: [README.md](README.md). Paths per OS are listed there.
