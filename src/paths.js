import os from 'node:os';
import path from 'node:path';

// Directory that holds Electron user-data dirs. The desktop app's default
// install is <userDataRoot>/Claude; `--user-data-dir` profiles live elsewhere
// under the same root (see profiles.js).
export function userDataRoot({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') return env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return env.XDG_CONFIG_HOME || path.join(home, '.config');
}

// Where the Claude desktop app keeps its per-account session registry.
// Layout: <registry>/<account-uuid>/<workspace-uuid>/local_<id>.json
export function registryRoot(opts = {}) {
  return path.join(userDataRoot(opts), 'Claude', 'claude-code-sessions');
}

// Where Claude Code (CLI and app alike) stores conversation transcripts.
// Layout: <projects>/<project-slug>/<cli-session-uuid>.jsonl
// Shared by every profile — transcripts live outside the user-data dir.
export function projectsRoot({ env = process.env, home = os.homedir() } = {}) {
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return path.join(claudeDir, 'projects');
}

export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
