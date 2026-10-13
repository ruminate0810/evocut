# Agent quick start

EvoCut is a local CLI with skills, not a hosted API or MCP server. Your agent needs file access and local command execution. Complete [setup](PORTABLE-SETUP.md) first.

## 1. Get the launcher

From the EvoCut checkout:

```sh
node scripts/cli.mjs agent instructions
```

Pass the returned fields to your agent. Do not guess their paths.

| Field | How to use |
| --- | --- |
| `launcher.executable` | Absolute Node executable |
| `launcher.args` | CLI entry arguments; append the requested command |
| `launcher.env` | Preserve these variables in the child process |
| `skillEntry` | Read this file and its relative references |

Use the launcher's absolute paths from the video project directory. Never invoke a guessed global installation. Getting these instructions does not mean installation is complete.

## 2. Call from any directory

This POSIX shell example uses the default checkout-local runtime. Replace both paths with real absolute paths. If `agent instructions` returned a custom `EVOCUT_HOME`, preserve it too.

```sh
EVOCUT_ROOT="/absolute/path/to/evocut"
PROJECT="/absolute/path/to/video-project"

node "$EVOCUT_ROOT/scripts/cli.mjs" timeline "$PROJECT" --json
node "$EVOCUT_ROOT/scripts/cli.mjs" check "$PROJECT" --json
node "$EVOCUT_ROOT/scripts/cli.mjs" preview "$PROJECT"
```

Stop the preview with `Ctrl+C`. After the user reviews it, export to an explicit absolute path:

```sh
node "$EVOCUT_ROOT/scripts/cli.mjs" render "$PROJECT" -o "$PROJECT/final.mp4"
```

For structured command tools, use `launcher.executable`, `launcher.args`, and `launcher.env` directly. Append each command argument separately, keeping paths with spaces as single arguments.

## 3. Optional skill installation

Only for an agent that supports SKILL.md folders and symlinks. Use that agent's actual skills directory; EvoCut does not guess it.

```sh
node scripts/cli.mjs agent install --skills-dir /absolute/agent/skills
# Review the plan before applying.
node scripts/cli.mjs agent install --skills-dir /absolute/agent/skills --apply
```

Existing conflicts are refused. Do not add `--replace` blindly. Save the returned receipt for restoration:

```sh
node scripts/cli.mjs agent restore --receipt /absolute/receipt.json --apply
```

## 4. Automation notes

- `env doctor --json`: `0` = prerequisites found; `2` = missing; `1` = command/config error. It is offline but does not prove rendering or inference works.
- `check --json`: inspect its result and exit code before opening a preview. Passing checks is not permission to export.
- `preview` and `render`: long-running commands, not ordinary JSON query endpoints. Keep logs and report the actual output path.
- `qa`: technical pass is not human approval; exit `3` can mean pending required review. [QA contract](../tools/video_qa/QUALITY_GATE.md).
- Optional preparation is backend-specific: `asr` prepares the QA faster-whisper path, not every transcription tool; `beats` prepares the Python music-to-video analyzer, not the Chrome-based Studio command. See [portable setup](PORTABLE-SETUP.md).

Keep the preview review step. Do not silently download models, switch voices, call paid services, or upgrade existing projects.

Use English for generated narration, captions, on-screen text, prompts, and reports.
