<div align="center">

<img src="assets/evocut/icon.svg" alt="EvoCut logo" width="72">

# EvoCut

**Video editing tools your AI agent can use.**

Edit clips, preview changes, export MP4, and check the result.

[Examples](#examples) · [Quick start](#quick-start) · [Use with an agent](#use-with-an-agent) · [简体中文](README.zh-CN.md)

`v0.1.1 · Early access` · `macOS tested` · `CLI + Agent skills`

</div>

## What it does

- **Edit:** cut and move supported linked footage, captions and audio, with conflict checks and undo.
- **Organize:** search local assets and keep voice profiles and pronunciation rules.
- **Deliver:** preview a project, export an MP4, and check the exported file.

Bring a desktop agent that can read files and run commands. EvoCut supplies the editing tools and skills—not a video-generation model. No Codex installation is required for core editing. [Capabilities and limits →](docs/FEATURES.md)

## Examples

<a href="docs/EXAMPLES.md"><img src="assets/evocut/examples/hello.png" alt="Actual frame from the 2-second hello export" width="480"></a>

| Try it | What you get |
| --- | --- |
| [Export a title card](docs/EXAMPLES.md#1-片头导出--export-a-title-card) | The included 2-second project → an MP4. Actual frame above. |
| [Cut cards and captions together](docs/EXAMPLES.md#2-画面与字幕一起剪--cut-a-card-and-its-caption-together) | A 6-second text example → 4 seconds, with verified undo. |
| [Check the exported file](docs/EXAMPLES.md#3-导出后检查--check-the-actual-mp4) | Source-bound technical checks → a JSON report. |

Each example includes commands and a prompt to give your agent. These are reproducible technical demos, not customer productions or generated-footage showcases.

## Quick start

Install **Node.js 22+ with npm, Python 3.11+, and FFmpeg/ffprobe** first. The commands below target macOS; Linux is not yet end-to-end verified and Windows automatic setup is not supported. Repository access is required while this repo remains private.

```sh
git clone https://github.com/ruminate0810/evocut.git
cd evocut

# Review the plan, then allow the engine/browser download.
node scripts/cli.mjs env prepare --feature render
node scripts/cli.mjs env prepare --feature render --apply --allow-downloads
node scripts/cli.mjs env doctor --feature render --json
```

Setup uses this checkout and the browser cache. It does not replace global commands, installed agent skills or existing videos. **No npm package is published: do not use `npx evocut`.** For Python packages or another computer, see [portable setup](docs/PORTABLE-SETUP.md).

### Try the included example

```sh
node scripts/cli.mjs check examples/hello --json
node scripts/cli.mjs preview examples/hello
```

Review the preview, then stop it with `Ctrl+C`. Export in the same terminal:

```sh
node scripts/cli.mjs render examples/hello -o renders/hello.mp4
```

Output: **`renders/hello.mp4`**, a 2-second silent test clip—not a generated-video showcase. First use may fetch fonts; this is not a fully offline install.

## Use with an agent

Get the **absolute launcher, environment and skill path** for this computer:

```sh
node scripts/cli.mjs agent instructions
```

Paste its output into your agent, followed by:

```text
Use this EvoCut launcher and preserve its environment settings.
Read skillEntry and its referenced instructions first.
Inspect my video project, explain your edit plan, then make the requested edits.
Show the checked preview before exporting. Do not upgrade my existing projects
or call paid generation services without my approval.
```

For skill-folder installation and invocation from another project, see [Agent quick start →](docs/AGENT-QUICKSTART.md). Agents without local command execution need a separate adapter; this package is not an MCP server.

## Everyday commands

Run from the EvoCut checkout; replace `<project>` with your video project path.

| Task | Command |
| --- | --- |
| Check this computer | `node scripts/cli.mjs env doctor --feature render --json` |
| Inspect the timeline | `node scripts/cli.mjs timeline <project> --json` |
| Check a project | `node scripts/cli.mjs check <project> --json` |
| Open the editor | `node scripts/cli.mjs preview <project>` |
| Export after review | `node scripts/cli.mjs render <project> -o renders/final.mp4` |

## Documentation

[Install & migrate](docs/PORTABLE-SETUP.md) · [Agent integration](docs/AGENT-QUICKSTART.md) · [Linked edits & undo](tools/evocut/SEMANTIC-EDIT.md) · [Assets & voices](tools/evocut/MEDIA-LIBRARY.md) · [Video QA](tools/video_qa/QUALITY_GATE.md) · [Develop & contribute](CONTRIBUTING.md)

**Status:** 120 Node and 115 Python tests passed on macOS in the recorded 2026-10-13 validation. This does not certify every skill or platform; CI is not active. [Validation record](docs/VALIDATION.md).

**Boundaries:** licensed assets, voices and generation services are not bundled. Remake produces a plan, not new footage. Technical checks are not creative approval. [Full limits](docs/FEATURES.md).

---

[Apache-2.0](LICENSE), with [third-party notices](THIRD_PARTY_NOTICES.md) and [NOTICE](NOTICE). [Security](SECURITY.md). Licensing does not change repository visibility.
