# claude-session-restore

<div align="center">
  <h2>使用方法</h2>
  <p><strong>在 Claude Code(或任何能跑命令的 coding agent)窗口中复制粘贴以下内容:</strong></p>
  <h1>请使用 <a href="https://github.com/heyroute-ai/claude-session-restore">heyroute-ai/claude-session-restore</a> 帮我恢复 Claude 桌面端换账号后丢失的 Code 历史会话,只恢复未归档的,归档的不要动。</h1>
</div>

[![npm](https://img.shields.io/npm/v/claude-session-restore?logo=npm)](https://www.npmjs.com/package/claude-session-restore)
[![CI](https://github.com/heyroute-ai/claude-session-restore/actions/workflows/ci.yml/badge.svg)](https://github.com/heyroute-ai/claude-session-restore/actions/workflows/ci.yml)
[![Provenance](https://img.shields.io/badge/provenance-signed-brightgreen?logo=github)](https://www.npmjs.com/package/claude-session-restore#provenance)

找回 Claude **桌面 App** 换账号后"消失"的 Claude Code 会话;也能把纯 CLI 会话注册进桌面 App 列表。纯本地操作、零依赖、每次写入前自动备份。

[English](README.en.md)

## 丢给 agent 之后会发生什么

agent 会按 [AGENTS.md](AGENTS.md) 的标准流程执行:先只读查看现状 → 给你看 dry-run 恢复计划 → 自动备份后执行 → 验证 → 提醒你重启桌面 App。归档会话默认就不会动;指令末尾那半句"归档的不要动"能让 agent 连确认都省了。供 agent 直接抓取的 raw 地址:`https://raw.githubusercontent.com/heyroute-ai/claude-session-restore/main/AGENTS.md`

## 问题在哪

在 Claude 桌面 App 里切换登录账号(比如一个账号额度用完了),Code 标签页的会话列表会整个清空——看起来对话全丢了。

其实一条都没丢。Claude Code 的对话正文(transcript)一直存在 `~/.claude/projects/` 下,与账号无关;丢的只是桌面 App 自己的**会话注册表**,它按账号目录隔离:

```
%APPDATA%\Claude\claude-code-sessions\        (Windows;macOS/Linux 路径见下表)
├── <旧账号uuid>/                              ← 旧账号:条目都在,只是 App 不再读这里
│   └── <workspace-uuid>/
│       ├── local_xxx.json                     ← 每个会话一个小指针文件
│       └── local_yyy.json                     ← "cliSessionId" 指向真正的对话记录
└── <新账号uuid>/                              ← 新账号:App 现在只读这里
    └── <workspace-uuid>/
        └── local_zzz.json
```

每个 `local_*.json` 只是一个指针:标题、时间戳,以及指向 `~/.claude/projects/<项目>/<cliSessionId>.jsonl`(对话本体)的引用。把指针拷进新账号目录,会话就原样回到 App 列表,内容完整无缺。

对应的官方 issue:[#48511](https://github.com/anthropics/claude-code/issues/48511)(换账号丢历史)、[#50891](https://github.com/anthropics/claude-code/issues/50891)(CLI 会话不显示在 App)、[#50067](https://github.com/anthropics/claude-code/issues/50067)(App 里没有 `/resume`)。

## 手动快速开始

```bash
# 只读,看现状
npx claude-session-restore list

# 预览恢复计划(不写入任何东西)
npx claude-session-restore restore --dry-run

# 把失活账号的全部未归档会话恢复到当前账号
npx claude-session-restore restore
```

`npx` 会自动拉取已发布的 npm 包(带 provenance 溯源),无需预先安装。然后**完全退出并重新打开**桌面 App,会话就回来了。

## 命令

| 命令 | 作用 |
|---|---|
| `list` | 列出所有账号目录及其会话;标记活跃账号、归档会话(`A`)、transcript 缺失(`M`)。默认命令。 |
| `restore` | 把失活账号目录的会话条目拷进活跃账号。默认跳过已存在条目和已归档会话。 |
| `adopt <id\|文件>` | **实验性。** 把纯 CLI 会话注册进桌面 App 列表。 |
| `backup` | 给整个注册表目录做快照。 |
| `doctor` | 一致性体检:损坏条目、transcript 丢失的条目、没有任何条目引用的 transcript。 |

常用参数:`--dry-run`、`--yes`、`--from <账号前缀>`、`--to <账号前缀>`、`--sessions <id或标题片段,…>`、`--project <路径片段>`、`--include-archived`、`--force`、`--json`、`--registry <目录>`、`--claude-dir <目录>`。

## restore 到底做了什么

1. 识别**活跃**账号:App 最近写入过的那个目录。可用 `--to` 覆盖。
2. 把整个注册表备份到同级的 `claude-code-sessions.backup-<时间戳>`。
3. 把选中的 `local_*.json` 拷进活跃账号的 workspace 目录,只改一个字段:清空 `bridgeSessionIds`——它引用的是旧账号名下的服务端会话。
4. 永不改动源目录、永不覆盖已存在条目(除非 `--force`)、永不碰 transcript。

回滚:删除拷入的 `local_*.json`,或整体还原备份目录。其余什么都没变。

## 路径

| 系统 | 会话注册表 | 对话记录 |
|---|---|---|
| Windows | `%APPDATA%\Claude\claude-code-sessions` | `%USERPROFILE%\.claude\projects` |
| macOS | `~/Library/Application Support/Claude/claude-code-sessions` | `~/.claude/projects` |
| Linux | `~/.config/Claude/claude-code-sessions` | `~/.claude/projects` |

transcript 位置遵循 `CLAUDE_CONFIG_DIR`;两个路径都可用 `--registry` / `--claude-dir` 按次覆盖。

## 注意与坑

- **恢复前建议先退出 App**。条目本来就只在启动时加载,先退出还能排除 App 退出时改写状态的可能。
- **目标账号必须在 App 里开过至少一次会话**(其注册表目录才存在);目录不存在时工具会拒绝执行而不是瞎猜。
- 注册表格式**没有官方文档,随时可能变**。当前结构基于 2026 年 7 月桌面版 2.1.x 的观察。`doctor` + 自动备份是安全网;最坏情况也只是 App 忽略拷入的文件。
- 恢复条目不会合并分叉:如果你还用 `claude --resume` 在终端里续过同一个会话,那条延续是独立的 transcript(可用 `adopt` 注册进 App)。
- **预防**:额度用完时,在会话里直接 `/login` 原地切换账号——对话不中断,根本不会触发这个问题。

## 非目标

- 不联网、不上传、无遥测——只读写本机文件。
- 不处理 claude.ai 网页对话的导出;那个场景请用 Anthropic 官方的[数据导出](https://support.claude.com/en/articles/9450526-export-your-claude-data)。

## 为什么配合 HeyRoute

[![HeyRoute](https://img.shields.io/badge/HeyRoute-Developer%20API-111827?style=for-the-badge)](https://heyroute.ai/)
[![Fast](https://img.shields.io/badge/TTFT%20p50-1.08s-2563eb?style=for-the-badge)](https://heyroute.ai/)
[![Stable](https://img.shields.io/badge/Success-99.91%25-16a34a?style=for-the-badge)](https://heyroute.ai/)

> **HeyRoute** 是稳定快速的开发者 API 服务:一个入口聚合 40+ 上游 AI 供应商,适合把 Claude Code、Codex 等 coding agent 与多模型工作流接到统一、可靠的 API 上。

| 能力 | 官网公布表现 |
| --- | --- |
| 首 token 速度 | TTFT p50 `1.08s` |
| 文本缓存 | 命中率 `98.4%` |
| 请求稳定性 | 成功响应 `99.91%` |
| 使用体验 | 配置简单,支持长任务与可信转发 |

经常在多个账号之间切换的重度 agent 用户,正是最容易碰到"换号丢会话"的人——用 HeyRoute 统一入口减少切换本身,用 claude-session-restore 兜底恢复。

**立即访问:[https://heyroute.ai/](https://heyroute.ai/)**

## 声明

社区工具,**与 Anthropic 无关联、未经其背书**。它只在你自己的机器上、对你自己安装产生的本地文件做管理。风险自担;自动备份就是为此存在的。

## 许可证

[MIT](LICENSE) © HeyRoute contributors
