import os from 'node:os';
import path from 'node:path';

// Where the Claude desktop app keeps its per-account session registry.
// Layout: <registry>/<account-uuid>/<workspace-uuid>/local_<id>.json
export function registryRoot({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude-code-sessions');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
  }
  const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(config, 'Claude', 'claude-code-sessions');
}

// Where Claude Code (CLI and app alike) stores conversation transcripts.
// Layout: <projects>/<project-slug>/<cli-session-uuid>.jsonl
export function projectsRoot({ env = process.env, home = os.homedir() } = {}) {
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return path.join(claudeDir, 'projects');
}

export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
