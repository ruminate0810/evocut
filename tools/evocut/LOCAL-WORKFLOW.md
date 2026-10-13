# EvoCut shared workflow

This is the local extension contract. It does not replace the composition,
ownership, preview, content-safety or human-approval rules of the routed skill.

## Reference recreation and learned quality rules

The 28 lessons from the Opus/GPT comparison project are maintained in
`evocut/references/reference-quality.md` (relative to the skills root). Read its
execution flow for reference recreation or repeated fidelity feedback; for normal
creation and focused edits, load only the relevant typography, motion, material,
state or final-file review sections. The entrypoint and creative/animation/CLI
skills link to it. Case-specific redraw rates, frame sampling, fonts and encoder
workarounds are examples, never universal defaults. Current project preferences
and user authorization remain authoritative; the guide adds no approval gate.

The source is `tools/evocut/skills-src/evocut/references/reference-quality.md`.
These are authoring and review instructions, not an engine upgrade, automatic
quality scoring, a guarantee of reference parity, or authorization to republish.

## One shared release, old projects preserved

Use `evocut`, not `npx evocut`. The underlying engine and its technical schemas
remain HyperFrames. Resolve the exact project engine before editing:

```bash
evocut --resolve-engine
evocut release status
evocut release verify
```

The default engine, shared tools and skills live in an independent versioned
snapshot under `EVOCUT_HOME/releases`. The repository CLI defaults to
`<checkout>/.evocut-home`; explicit `EVOCUT_HOME` takes precedence. `current` selects the stable release.
Existing exact project pins remain authoritative. Missing pins fail visibly;
they are never downloaded or upgraded automatically. The wrapper suppresses
upstream automatic engine checks/install and skill refresh. An already running
preview or a direct `npx hyperframes` process is outside that wrapper policy.

Shared source is `/absolute/evocut/tools/evocut` (skills
in `skills-src`), plus `tools/video_qa` for QA. Edit these sources, test,
stage a **new ID**, validate, then explicitly promote. Do not edit release
snapshots, global npm packages or old projects to deploy a shared enhancement.

```bash
node /absolute/evocut/tools/evocut/normalize-managed-skills.mjs
evocut release stage --engine-root /absolute/branded-installed-engine \
  --skills-source /absolute/evocut/tools/evocut/skills-src \
  --id candidate-unique-id --apply
evocut release validate candidate-unique-id
evocut release promote candidate-unique-id --apply
evocut release rollback previous-validated-id --apply
```

The normalization step refreshes snapshot-local copies of the shared workflow
docs; it does not touch installed skill entrypoints. No command above installs
an upstream version. When an upstream update is
requested, obtain it into an isolated candidate first, review the diff and
apply the guarded EvoCut branding before staging. Test a small isolated project
before promoting. Existing previews are not restarted. Loaded chats must reread
the installed skill to see a new release.

`release bind-skills` previews entrypoint changes; `--apply` backs up each prior
tree/link and records recovery paths before replacing it. `release restore-skills
RECEIPT --apply` restores only unchanged bindings and verified backups. Only
the known EvoCut/media/workflow names are bound; other skills stay untouched.

## Chinese media library and fixed voices

```bash
evocut assets search 收银机 --type sfx
evocut assets search 转场 --type sfx
evocut assets catalog --output /absolute/new-catalog.html
evocut voice list
```

Search reads existing manifests and Chinese/English synonym tags, unifies SHA
duplicates, and checks file availability. This is keyword search, not semantic
audio listening. Unknown mood or licensing stays unknown. The static catalog
has local audio/video preview controls. Search never imports or generates.
Use the exact SHA, returned revision and scoped import template to import into
the requested project. Tags live in a sidecar; original manifests stay intact.

For voice setup use `evocut voice --help` and [MEDIA-LIBRARY.md](MEDIA-LIBRARY.md).
Register the provider and **confirmed** voice ID, language, speed, pronunciation
replacements and optional reference SHA. Never infer a historical cloned voice
ID or silently substitute another voice. `prepare-neutral-request` validates
the profile and returns a provider-neutral request; it does not synthesize or
spend credits. A changed reference or mismatched voice must be resolved first.
Provider credentials must not be stored in a profile.

## Linked editing and local remake plans

Read [SEMANTIC-EDIT.md](SEMANTIC-EDIT.md) before using these commands.

```bash
evocut edit plan --project /absolute/project --operation cut \
  --range 12:14 --out /absolute/new-plan.json
evocut edit apply /absolute/new-plan.json
evocut edit apply /absolute/new-plan.json --apply
```

Planning and apply-preview are non-mutating. Actual apply requires `--apply`
and an unchanged source hash. The first version supports flat, explicitly
marked clips on engine 0.8.81, linked voice/subtitle/video/SFX/graphic tracks,
and a continuous BGM bed. Unsupported animation, nested timing, automation,
speed changes or ambiguous sentence matching returns pending, never a guess.
Undo refuses to overwrite newer edits. Do not add fake marks to bypass checks.

`evocut edit remake` creates a source-bound shot request only. It does not yet
call video generators, replace media automatically or spend credits. Generation
and reviewed replacement remain explicit subsequent work.

## Render binding and unified QA

For an approved normal full-composition MP4 export, use explicit `-o`:

```bash
evocut render /absolute/project -o /absolute/new-final.mp4
evocut qa --project /absolute/project --video /absolute/new-final.mp4 \
  --type music --run --json-output /absolute/new-qa.json \
  --html-output /absolute/new-qa.html
```

The wrapper records index.html SHA and final-video SHA only after a successful
single MP4 render with unchanged source. Batch/subcomposition/default-output
exports do not claim this binding. It is **not a complete dependency graph**:
external scripts/media require their own asset evidence. Linked edits invalidate
prior QA. Project-bound QA requires a matching fresh render receipt, even if
the old video itself still decodes.

Use `narrated`/`dialogue` for any speech, `music` for audio without speech, or
`silent` for no audio stream. Narrated/dialogue checks require an actual bound
ASR report and current script; the gate does not download or execute an ASR
model. See [QUALITY_GATE.md](../video_qa/QUALITY_GATE.md) for evidence
formats. `--check` uses existing evidence, while `--run` invokes local technical
checks (decode, black frames, streams, loudness and supplied audits).

Technical pass and human review are separate. The tool never writes approval,
publishes, claims to have listened, or converts missing evidence to success.
After technical QA, watch the final frames and listen to the final audio under
the routed skill, then record only review actually performed. Do not manufacture
human-review manifests to get exit 0. This CLI is a gate to use in workflows,
not an interceptor of every possible external renderer or publisher.
