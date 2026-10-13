# EvoCut

<img src="assets/evocut/wordmark-dark.svg" alt="EvoCut" width="240">

**Agent-operable video editing with reproducible releases, conservative linked edits, and evidence-bound quality checks.**

EvoCut extends the [HyperFrames](https://github.com/heygen-com/hyperframes) HTML video engine. It is not a new foundation model or an independent renderer, and is not endorsed by HeyGen. The upstream package, protocols and attribution remain intact.

This repository is prepared for open-source distribution under Apache-2.0, with third-party exceptions documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Repository visibility is a separate owner decision. `private: true` in package.json prevents accidental **npm** publication; it does not change the source license.

## Quick start

Requirements: Node.js 22+, npm, Python 3.10+, FFmpeg/ffprobe. Rendering additionally needs a supported Chromium browser and the upstream renderer's platform dependencies. macOS and Linux are the initial targets; Windows has not been validated.

```sh
git clone https://github.com/ruminate0810/evocut.git
cd evocut
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
export EVOCUT_PYTHON="$PWD/.venv/bin/python"
npm test
npm run setup -- --install-engine
npm run evocut -- about
npm run evocut -- release status
npm run evocut -- --help
```

While the repository is private, cloning requires repository access. The explicit setup step downloads **HyperFrames 0.8.81** using the committed dependency lock, modifies only the checkout's `.runtime`, validates a release, and activates it in `.evocut-home`. It does not overwrite global commands, installed skills, or older videos. Set `EVOCUT_HOME` explicitly to select a different release home. Ordinary editing commands never download or upgrade an engine.

Optional: `npm link` exposes `evocut` on your PATH. Do not use it to replace an existing installation without reviewing that installation first. No npm package is published by this project yet; do not use `npx evocut`.

## Example

```sh
npm run evocut -- check examples/hello --json
npm run evocut -- preview examples/hello
npm run evocut -- render examples/hello -o renders/hello.mp4
npm run evocut -- qa --project examples/hello --video renders/hello.mp4 \
  --type silent --run --json-output renders/qa.json
```

QA exit `3` means technical checks passed but required human review remains pending. It is not an encoding failure, nor a claim that the video looks good. Browser installation, if needed, is an explicit upstream setup action; it is not included in `npm test`.

## What EvoCut adds

| Capability | Included behavior | Boundary |
| --- | --- | --- |
| Managed releases | Stage, hash verification, test, promote, rollback | No silent upgrades of live engines or old project pins |
| EvoCut branding | Guarded AST edits, consistent logo, cache-safe browser module graph | Preserves upstream names in APIs and runtime schemas |
| Project-aware CLI | Exact engine-pin resolution; pass-through CLI arguments | Missing engines fail instead of downloading silently |
| Linked editing | Cut/move/undo linked footage, captions, voice, SFX and graphics | Flat marked clips on 0.8.81; complex cases return pending |
| Shot remake | Source-bound remake request plans | Does not generate or replace footage automatically |
| Media library | Chinese/English keyword search, SHA dedup, tags, preview and explicit import | No bundled stock-media library or license guarantee |
| Voice profiles | Confirmed voice IDs, pronunciation and reference hashes | No default voice, credentials or paid synthesis |
| Render receipts | Bind an unchanged composition to a new successful MP4 | Index binding, not the full external dependency graph |
| Video QA | Decode, black frames, audio, supplied ASR, source and evidence checks | Technical checks do not certify acting or listening quality |
| Agent skills | 29 video-related skill families, templates and quality guidance | Optional recipes need their own licensed media/tools |

See [feature coverage](docs/FEATURES.md), [release workflow](tools/evocut/LOCAL-WORKFLOW.md), [linked editing](tools/evocut/SEMANTIC-EDIT.md), [media and voices](tools/evocut/MEDIA-LIBRARY.md), and [QA](tools/video_qa/QUALITY_GATE.md).

## Scope

Included: the editing/tooling improvements and general video-making guidance. Excluded: finance analysis, social publishing, account login automation, provider credentials, private voice IDs, personal videos, chat logs, machine caches, and third-party stock-media binaries.

Some upstream HTML recipes reference optional fonts/music/images. They are source examples, not complete media packs. Provide licensed assets before rendering those recipes; never assume an absent asset is bundled. The `examples/hello` smoke composition needs no user media, GSAP or paid API. The upstream compiler may fetch its default fonts; rendering is not guaranteed to be network-free on a cold machine.

## Development and upstream updates

The GitHub Actions configuration is provided as
[`docs/ci/github-actions.yml`](docs/ci/github-actions.yml). CI is not enabled yet:
the initial upload credentials lacked workflow-write permission. To enable it,
copy the template to `.github/workflows/test.yml` and commit/push using an account
or token authorized to write workflows. Local tests do not require that scope.

```sh
npm test
npm run audit:source
# Deliberately prepare a separate compatible upstream candidate, then:
npm run evocut -- brand --root /absolute/candidate/hyperframes --apply
npm run evocut -- release stage --engine-root /absolute/candidate/hyperframes \
  --skills-source "$PWD/tools/evocut/skills-src" --id my-candidate --apply
npm run evocut -- release validate my-candidate
npm run evocut -- release promote my-candidate --apply
```

Do not patch a running release. Unsupported upstream AST shapes are rejected. Increasing the upstream version requires testing and may require updating the patcher and argument schemas. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
