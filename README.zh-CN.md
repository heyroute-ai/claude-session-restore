# claude-session-restore

找回 Claude 桌面 App 换账号后"消失"的 Claude Code 会话;也能把纯 CLI 会话注册进桌面 App。纯本地操作、零依赖、写入前自动备份。

[English](README.md)

## 问题

在 Claude 桌面 App 里切换登录账号(比如一个账号额度用完了),Code 标签页的会话列表会整个清空——看起来对话全丢了。

其实一条都没丢。Claude Code 的对话正文一直存在 `~/.claude/projects/` 下,与账号无关;丢的只是桌面 App 自己的**会话注册表**,它按账号目录隔离:

```
%APPDATA%\Claude\claude-code-sessions\
├── <旧账号uuid>/<workspace>/local_*.json   ← 条目还在,只是 App 不再读这个目录
└── <新账号uuid>/<workspace>/local_*.json   ← App 现在只读这里
```

每个 `local_*.json` 是一个指针文件(标题、时间戳、`cliSessionId` 指向真正的 transcript)。把指针拷进新账号目录,会话就原样回到 App 列表里。

对应官方 issue:[#48511](https://github.com/anthropics/claude-code/issues/48511)、[#50891](https://github.com/anthropics/claude-code/issues/50891)、[#50067](https://github.com/anthropics/claude-code/issues/50067)。

## 最省事的用法:丢给 agent

把这句贴进 Claude Code(或任何能在这台机器上跑命令的 coding agent):

> 请使用 https://github.com/heyroute-ai/claude-session-restore 帮我恢复 Claude 桌面端换账号后丢失的 Code 历史会话。

agent 会按 [AGENTS.md](AGENTS.md) 的标准流程执行:先只读查看现状 → 给你看 dry-run 恢复计划 → 自动备份后执行 → 提醒你重启桌面 App。

## 手动快速开始

```bash
npx claude-session-restore list              # 只读,看现状
npx claude-session-restore restore --dry-run # 预览,不写入
npx claude-session-restore restore           # 恢复(自动备份)
```

npm 首版发布前可直接从 GitHub 运行:`npx github:heyroute-ai/claude-session-restore list`

恢复后**完全退出并重开**桌面 App 即可看到会话。

## 命令

- `list` — 列出所有账号目录及会话(标记活跃账号、归档 `A`、transcript 缺失 `M`)
- `restore` — 把失活账号的会话条目恢复到活跃账号(默认跳过已存在与已归档;`--include-archived`、`--force`、`--sessions`、`--project` 可调)
- `adopt <id|file>` — 实验性:把纯 CLI 会话注册进桌面 App
- `backup` / `doctor` — 注册表快照 / 一致性体检

## 恢复时做了什么

1. 以"最近被 App 写入"识别活跃账号(可 `--to` 覆盖);
2. 整个注册表先备份到 `claude-code-sessions.backup-<时间戳>`;
3. 拷贝所选 `local_*.json`,只改一个字段:清空 `bridgeSessionIds`(它引用旧账号的服务端会话);
4. 不动源目录、不覆盖已存在条目、不碰 transcript。

回滚 = 删除拷入的文件或还原备份目录。

## 提示

- 恢复前建议先退出 App;目标账号需先在 App 里开过一次会话(目录才存在)。
- 注册表格式未有官方文档,以 2026-07 桌面版 2.1.x 观察到的结构为准,App 升级后可能变化。
- **预防**:额度用完时在会话里直接 `/login` 原地换号,对话不中断,根本不会触发这个问题。

## 声明

社区工具,**与 Anthropic 无关联、未经其背书**;仅在本机读写你自己的本地文件,无任何网络请求。风险自担,自动备份就是为此存在的。

[MIT](LICENSE) © HeyRoute contributors
