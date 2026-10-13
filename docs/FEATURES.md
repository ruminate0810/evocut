# Preserved enhancement inventory

Export baseline: the local EvoCut `evocut-20261007-reference-quality-v2` release,
HyperFrames 0.8.81, plus maintained source documentation. Original source file
SHA-256 values and explicit optional-media omissions are recorded in
`source-inventory.json`. This is provenance, not a claim that every recipe was
visually reviewed in this repository.

| Improvement | Implementation |
| --- | --- |
| Offline per-feature readiness and explicit dependency preparation | scripts/host.mjs, requirements-*.txt |
| Custom Agent skill roots, conflict opt-in, backup/restore and integration instructions | scripts/host.mjs |
| Checkout-local Python selection and child-command shims, without global PATH changes | scripts/cli.mjs, scripts/setup.mjs |
| Logo/wordmark/favicons, root help and Studio display names | branding.mjs + assets/evocut |
| Whole browser import graph renaming to prevent old-logo remount/cache bugs | branding.mjs |
| Hash-guarded modifications, backups and safe restoration | branding.mjs, verify.mjs |
| Exact project engine pins and argument resolution (51 version schemas) | evocut.mjs, engine-options.json |
| Disable silent engine install/update and in-place skill refresh; default telemetry off | evocut.mjs |
| Immutable engine/tool/skill snapshots, complete hashes, validation, rollback | release-manager.mjs |
| Backed-up shared skill links and conflict-aware restoration | release-manager.mjs |
| Chinese search, deduplication, source/license metadata, optimistic concurrency | media-library.mjs |
| Static asset audition catalog and explicit selected-asset imports | media-library.mjs |
| Fixed voice profile IDs, pronunciation, reference hash checks | voice-profile.mjs |
| Semantic linked cut/move, BGM-bed handling, source-offset correctness | semantic-edit.mjs |
| Undo/CAS protection and local shot-remake request plans | semantic-edit.mjs |
| New-MP4/source binding and QA invalidation after edits | render-receipt.mjs |
| Decode, audio, black frames, evidence and source-bound QA | tools/video_qa |
| Audio mixing plans, Mandarin narration lint, ASR coverage, frame sampling | tools/video_qa |
| Agent editing/media/animation/caption workflows, template source | skills-src |
| Reference comparison, action/material/typography continuity, final-file review lessons | evocut/references/reference-quality.md |

Unqualified `.mjs` filenames above live under `tools/evocut`; bootstrap files
use explicit `scripts/` paths. The video QA dependency
closure was extracted from a business-specific directory; no account publishing
or financial analysis scripts were imported. Generic imported diagnostics do not
inherit the original business defaults.

## Deliberate exclusions

- Personal runtime snapshots, render outputs, account data and migration receipts.
- One-time global-machine migration scripts, which are not portable setup tools.
- Stock media/font binaries and private case-study evidence.
- Generated or cloned voices, provider credentials and paid-generation adapters.

## Known limits

Semantic editing is conservative and version-scoped. Remake is planning only.
Asset search is keyword-based, not acoustic understanding. A technical QA pass
does not prove speaker identity, perfect lip sync, good acting or faithful style.
The initial repository targets macOS/Linux; it does not promise Windows support.
