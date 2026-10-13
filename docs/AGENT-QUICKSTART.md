# Agent 快速接入 / Agent quick start

EvoCut is a local CLI with skills, not a hosted API or MCP server. Your agent needs file access and local command execution. Complete [setup](PORTABLE-SETUP.md) first.

EvoCut 是本地命令行工具与技能集合，不是在线 API 或 MCP Server。Agent 需要读写文件、执行本地命令。先完成[环境安装](PORTABLE-SETUP.md)。

## 1. 获取准确入口 / Get the launcher

从 EvoCut 仓库执行 / From the EvoCut checkout:

```sh
node scripts/cli.mjs agent instructions
```

将返回的配置交给 Agent，不要手写或猜测路径 / Pass the returned fields to your agent:

| Field | How to use / 用法 |
| --- | --- |
| `launcher.executable` | Absolute Node executable / Node 的绝对路径 |
| `launcher.args` | CLI entry arguments, followed by the requested command / 后面追加具体命令 |
| `launcher.env` | Preserve these variables in the child process / 原样传入子进程 |
| `skillEntry` | Read this file and its relative references / 先读该文件及引用 |

Use the launcher's absolute paths from the video project directory. Never invoke a guessed global installation. Do not treat `agent instructions` success as a completed installation.

在视频项目目录执行时，使用这里返回的绝对入口；不要猜测全局安装位置。获取入口成功不代表安装已完成。

## 2. 从任何目录调用 / Call from any directory

The POSIX shell example below uses the default checkout-local runtime. Replace both paths with real absolute paths. If `agent instructions` returned a custom `EVOCUT_HOME`, preserve it too.

以下 POSIX shell 示例使用默认的仓库运行目录。替换为真实绝对路径；如配置了自定义 `EVOCUT_HOME`，也要原样传入。

```sh
EVOCUT_ROOT="/absolute/path/to/evocut"
PROJECT="/absolute/path/to/video-project"

node "$EVOCUT_ROOT/scripts/cli.mjs" timeline "$PROJECT" --json
node "$EVOCUT_ROOT/scripts/cli.mjs" check "$PROJECT" --json
node "$EVOCUT_ROOT/scripts/cli.mjs" preview "$PROJECT"
```

Stop the preview with `Ctrl+C`. After the user reviews it, export to an explicit absolute path:

按 `Ctrl+C` 停止预览。用户确认后，导出到明确的绝对路径：

```sh
node "$EVOCUT_ROOT/scripts/cli.mjs" render "$PROJECT" -o "$PROJECT/final.mp4"
```

If your agent exposes a structured command tool, prefer `launcher.executable` + `launcher.args` + an argument array and `launcher.env` over building a shell string. Keep project paths with spaces as a single argument.

Agent 支持结构化命令时，优先使用返回的 executable、args 和 env，把命令及参数逐项追加；含空格的项目路径必须作为单独一个参数传递。

## 3. 可选：安装技能 / Optional skill installation

Only for an agent that supports SKILL.md folders and symlinks. Replace the destination with that agent's actual skills directory; EvoCut does not guess it.

仅适用于支持 SKILL.md 和符号链接的 Agent。将目标替换为该 Agent 的真实技能目录，工具不会自动猜测。

```sh
node scripts/cli.mjs agent install --skills-dir /absolute/agent/skills
# Review the plan before applying / 检查计划后再执行
node scripts/cli.mjs agent install --skills-dir /absolute/agent/skills --apply
```

Existing conflicts are refused. Do not add `--replace` blindly. Save the returned receipt; it supports restoration:

同名冲突会被拒绝，不要盲目添加 `--replace`。保留返回的回执，需要时恢复：

```sh
node scripts/cli.mjs agent restore --receipt /absolute/receipt.json --apply
```

## 4. 自动化要知道的区别 / Automation notes

- `env doctor --json`: `0` = prerequisites found; `2` = missing; `1` = command/config error. It is offline but does not prove that rendering or inference works.
- `check --json`: inspect its result and exit code before opening a preview. Do not automatically export just because checks pass.
- `preview` and `render`: long-running commands, not ordinary JSON query endpoints. Keep logs and report the actual output path.
- `qa`: technical pass is not human approval; exit `3` can mean pending required review. [QA contract](../tools/video_qa/QUALITY_GATE.md).
- Optional preparation is backend-specific: `asr` currently prepares the QA faster-whisper path, not every transcription tool; `beats` prepares the Python music-to-video analyzer, not the Chrome-based Studio `beats` command. See [portable setup](PORTABLE-SETUP.md).

安装检查通过不等于视频质量通过。保留预览确认步骤；不要静默下载模型、切换声音、调用付费服务或升级旧项目。
