# Portable setup

Already installed? Go straight to [Agent quick start](AGENT-QUICKSTART.md).

EvoCut v0.1.1 provides checkout-local setup commands. Core editing does not require Codex. Setup does not automatically modify agent skill directories.

Your desktop agent must access persistent project files, execute local commands, load skills and their references, and present media for review. A chat-only application or MCP client without command execution needs an additional adapter; this version is not an MCP server.

Run these commands from the EvoCut checkout. Access to the private repository is a prerequisite.

## 1. Check without installing

```sh
node scripts/cli.mjs env doctor --feature render --json
node scripts/cli.mjs env doctor --feature qa --json
node scripts/cli.mjs env doctor --feature asr --json
```

`env doctor` is offline and read-only. It does not call paid APIs, download models, apply fixes, or print credential values. It reports checks and remedies as JSON:

- `0`: the selected prerequisite checks passed.
- `2`: prerequisites are missing.
- `1`: a command or configuration error occurred.

This differs from the engine's existing `doctor`, which may check online versions. A ready result confirms only versions, files, executable responses, or module discoverability—not rendering, inference, recipe compatibility, or final video quality.

Browser discovery covers configured or known cache locations. ASR requires an explicitly selected local model; it never selects another model automatically.

## 2. Prepare only the features you need

| Feature | Prepares | You still provide |
| --- | --- | --- |
| `core` | Pinned engine, release validation, checkout-local runtime | Node.js 22+, Python 3.11+ |
| `render` | Core plus the renderer browser | FFmpeg, ffprobe, system browser libraries |
| `qa` | NumPy, SciPy, Pillow | FFmpeg, ffprobe |
| `asr` | QA faster-whisper path: CTranslate2, NumPy, OpenCC | Complete local model, FFmpeg |
| `beats` | Python music-to-video analyzer: librosa, NumPy, soundfile | FFmpeg, ffprobe |

ASR and beats are backend-specific. The media transcription skill's Parakeet/whisper.cpp paths need separate preparation. Studio's `evocut beats` uses Chrome, not the Python analyzer.

Review each plan before applying it:

```sh
node scripts/cli.mjs env prepare --feature render
node scripts/cli.mjs env prepare --feature render --apply --allow-downloads

node scripts/cli.mjs env prepare --feature qa
node scripts/cli.mjs env prepare --feature qa --apply --allow-downloads
```

Without `--apply`, preparation writes nothing. Applying also requires `--allow-downloads` for package/browser downloads. These plans do not download model weights, invoke paid generation, run sudo, or install system FFmpeg.

Install host tools through your package manager and make them available to the agent process—not only your interactive terminal.

Python preparation defaults to a checkout-local `.venv`. Pip requires a virtual environment and refuses system-Python installation. An explicitly selected Python must also be in a virtual environment. Python 3.11+ is required because existing QA uses `hashlib.file_digest`.

Progress goes to stderr; final JSON goes to stdout. Failures retain completed installation work without switching providers or downgrading automatically. `prepared: true` does not mean every prerequisite is ready: ASR packages without a configured model still return `2`.

Python requirements use bounded version ranges, not complete cross-platform hash locks. Installation is not guaranteed to be byte-for-byte reproducible.

## 3. Select Python, browser, and model paths

```sh
# Preview first; add --apply after checking the path.
node scripts/cli.mjs env init --python /absolute/venv/bin/python
node scripts/cli.mjs env init --python /absolute/venv/bin/python --apply
node scripts/cli.mjs env init --asr-model /absolute/models/faster-whisper-small --apply
```

Supported fields: `--python`, `--browser`, `--asr-model`. Settings live in `host.json` under the selected `EVOCUT_HOME`, defaulting to `.evocut-home/host.json` in this checkout. They are not committed to Git. Regenerate them on a computer with different paths.

Credentials are not accepted. Precedence is explicit environment variables → host configuration → checkout virtual environment/default discovery.

The wrapper passes the selected Python to QA and legacy audio adapters and adds its directory to child-process PATH. Calls through `scripts/cli.mjs` receive these settings; directly invoked legacy scripts may not.

An ASR model must contain `model.bin`, `config.json`, `tokenizer.json`, and `vocabulary.txt`. File presence does not prove compatibility or successful inference.

## 4. Connect your desktop agent

Get this computer's exact entry points:

```sh
node scripts/cli.mjs agent instructions
```

Configure the returned `launcher` in your agent and run it from the video project directory. Preserve its environment settings. No `npm link` or global command is required. Keep the installation in persistent storage, not a temporary chat sandbox.

Core setup creates dedicated command links under the runtime home's `bin`. The wrapper prioritizes these only for its child processes, avoiding an older global installation. It does not modify shell startup files or system PATH; unknown conflicting command files are not overwritten.

For an agent that supports SKILL.md directories, specify its actual skill directory:

```sh
node scripts/cli.mjs agent install --skills-dir /absolute/agent/skills
node scripts/cli.mjs agent install --skills-dir /absolute/agent/skills --apply
```

Only the supplied directory is affected. Conflicts are refused unless you review the plan and explicitly use `--replace`. Existing entries are backed up before replacement. Keep the returned receipt for restoration:

```sh
node scripts/cli.mjs agent restore --receipt /absolute/receipt.json --apply
```

Installation links to the verified release skill tree, retaining relative references and compatibility aliases. If your agent cannot use symlinks, point it to the full tree using `agent instructions`; applications that cannot read external files need a dedicated import adapter.

This is not certification for every desktop agent. Windows provides diagnostics and plans only; automatic preparation and skill installation are explicitly refused. Do not substitute the legacy `release bind-skills` command: it targets multiple directories.

## 5. Verify the actual workflow

Follow the README to check, preview, export, and run QA, then inspect the actual video.

- Core editing needs no Codex. Optional image adapters that explicitly call Codex still require it or a separately integrated replacement.
- Commercial APIs, cloned voices, fonts, sound effects, and existing media need separate configuration or migration.
- Advanced legacy helpers may have additional dependencies; render readiness does not certify all 29 skill families.
- This version does not include a background worker, generation-service credential manager, MCP server, public npm package, or installer distribution.
- macOS is the tested platform. Linux and Windows are not verified merely because setup documentation exists.

Setup commands belong to the checkout administration layer, separate from immutable production snapshots. Updating Git updates this layer; it does not replace the active engine, global installation, or existing projects.
