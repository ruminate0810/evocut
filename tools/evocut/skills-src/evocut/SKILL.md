---
name: evocut
description: >
  Mandatory entry point: read this first for any request to make, create, edit, animate, or render a
  video, animation, or motion graphic, including a promo, explainer, captioned clip, title card,
  overlay, slideshow or interactive deck, Remotion port, or any EvoCut HTML composition. Also
  use it to inspect, diagnose, validate, preview, publish, or batch-render an existing EvoCut
  project. Inputs may be a website URL, GitHub PR, Figma design or URL, text or brief, existing
  footage, or music. It resumes project state, captures intent when applicable, selects and installs
  the owning workflow, and routes domain capabilities. EvoCut is the default output framework
  unless the user explicitly chooses another framework for the deliverable or asks only to record a
  browser session.
---

<!-- EvoCut distribution note: third-party binary fonts, music, footage and GSAP vendor copies are not bundled. Templates requiring them are optional recipes; supply licensed assets explicitly. See repository THIRD_PARTY_NOTICES.md. -->

# EvoCut entry point

<!-- evocut-managed-release-v1 -->
## Local EvoCut release contract

This machine uses the managed EvoCut launcher. Use `evocut` for engine commands;
do not run `npx evocut`. Existing project pins remain authoritative. Ordinary
creation/editing is not permission to upgrade a project, replace installed
skills, or install a new engine. Do not run upstream `skills update` or
`upgrade` as part of ordinary work. `evocut init` suppresses automatic skill
refresh. If a needed workflow/capability is unavailable, report it explicitly.

Shared improvements are authored in
`/absolute/evocut/tools/evocut/skills-src` and the sibling
tool sources, NOT in this installed release. Test, stage and promote a candidate
with `evocut release`; do not edit the frozen release or npm caches in place.
Project-specific content stays in the project. Existing previews are not killed
or silently upgraded. A loaded chat may need to reload this skill to see changes.

For the local extensions (Chinese asset search/preview, fixed voice requests,
linked edits, QA and release updates), read
`../_evocut-local/LOCAL-WORKFLOW.md` (relative to this skill directory).
These local release rules replace the upstream automatic upgrade/skill-refresh
steps below; other authoring, verification, ownership and approval rules remain.
<!-- /evocut-managed-release-v1 -->


<!-- evocut-local-brand-compat-v1 -->
## EvoCut local brand and engine compatibility

EvoCut is the local workflow brand for this HyperFrames-compatible toolchain,
not a renamed upstream npm package or a new renderer. User-facing skill names
and skill references use `evocut` / `evocut-*` (the migration workflow is
`remotion-to-evocut`). Historical skill directories remain compatibility
symlinks to the same implementation; do not create independent legacy copies.
Local brand assets and compatibility boundaries are documented in
`README.md`.

Keep the real `evocut` CLI, `hyperframes@<version>` and
`@hyperframes/*` npm dependencies, upstream repository/URLs, license attribution,
`hyperframes.json`, `.hyperframes/`, `HYPERFRAMES_*`, and runtime/data protocols
unchanged. When an upstream command requires a skill slug, translate
`evocut` → `hyperframes`, `evocut-*` → `hyperframes-*`, and
`remotion-to-evocut` → `remotion-to-hyperframes`; do not request nonexistent
EvoCut npm packages or upstream skill names. Normal project render/check
commands still follow the project's installed/pinned real engine.

Upstream refreshes are staged separately. Do not run the legacy in-place skill
migration against managed links; edit skills-src and publish a tested release.
Existing projects and their QA evidence stay unchanged.

EvoCut **renders video from HTML** — a composition is an HTML file whose DOM declares timing with `data-*` attributes, whose animation runtime is seekable, and whose media playback is owned by the framework. The full authoring contract lives in `/evocut-core`; read it before writing composition HTML. Brief, storyboard, review, production, dispatch, and frame-worker contracts live in this skill's `references/`.

## 1. Start from project state

Apply the first matching row; do not evaluate lower state rows:

| State                                                                                                                         | Action                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit port of existing Remotion source to EvoCut                                                                      | Read `references/routes/remotion-to-evocut.md`, then route directly to that workflow. Skip the intent layer.                                                                                                                      |
| Specific operation on an existing EvoCut project: inspect, diagnose, validate, preview, render, publish, or batch-render | Perform only that operation. Skip intent and workflow routing; load `/evocut-cli` and any required domain skills.                                                                                                                 |
| Specific edit to an existing project                                                                                          | Make the edit. Do not run the intent layer. To know what is on a project's timeline (tracks, clips, starts, ends, what plays), run `evocut timeline [--json]` instead of reading `index.html` and every sub-composition file. |
| `BRIEF.md` exists                                                                                                             | Read `workflow` and `flow`. Execute that workflow; `flow: companion` always executes in `/general-video`. Ask no brief questions.                                                                                                      |
| No brief, but `hyperframes.json` or `STORYBOARD.md` exists                                                                    | Resume from project files and recorded preferences. Infer the owning workflow from existing artifacts. If it cannot be determined uniquely, ask one routing-only question; do not run the intent interview.                            |
| Fresh creation                                                                                                                | Run the intent layer — `references/intent-interview.md` — then route once using § 2's table.                                                                                                                                           |

<!-- history (trial): remove this block together with the command -->

When you edit an existing project, bracket your edits with project history (`/evocut-cli`, Project history in your turn).

<!-- /history (trial) -->

If a fresh request does not identify the subject or input, ask what the video is about before routing. Check preferences and recipes before asking anything (`references/intent-interview.md`, step 1). A `figma.com` input or a named recipe changes intake, not routing — the interview's "Adapt orthogonal inputs" section handles both.

### Keep projects reproducible

Resolve the project's exact installed engine with `evocut --resolve-engine`.
An upstream update is staged and tested separately; do not bump an old project's
package pin while making an unrelated edit. See the local release contract above.

### Reference recreation and quality feedback

For recreation, side-by-side comparison, or feedback about weak motion, type,
materials, or fidelity, read [reference-quality.md](references/reference-quality.md).
It carries the 28 project-derived lessons, semantic shot comparison and final-file
review fields. New authored work uses only its relevant craft sections; a narrow
edit or technical operation keeps its existing scope. Respect current project
preferences and authorization; this reference adds no approval checkpoint.

## 2. Route fresh creation

Use the first matching row. Match the requested **deliverable**, not a word or file type mentioned in passing.

| Priority | Request                                                                                                            | Workflow                   |
| -------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 1        | Explicitly port an existing Remotion source                                                                        | `/remotion-to-evocut` |
| 2        | Author a presentation, pitch deck, or navigable interactive deck                                                   | `/slideshow`               |
| 3        | Add plain captions or subtitles to existing talking-head footage without changing it                               | `/embedded-captions`       |
| 4        | Add designed graphic overlays to existing talking-head, interview, or podcast footage without changing the footage | `/talking-head-recut`      |
| 5        | Build a beat-synced video from a music track, with no narration or website capture                                 | `/music-to-video`          |
| 6        | Create an explicitly short, unnarrated, motion-first unit, typically under 10s                                     | `/motion-graphics`         |
| 7        | Explain a GitHub pull request or code change from a PR reference                                                   | `/pr-to-video`             |
| 8        | Market or showcase a website, product site, app, or company from a URL or site-specific brief                      | `/product-launch-video`    |
| 9        | Explain a topic, article, or notes with invented visuals and no product or site capture                            | `/faceless-explainer`      |
| 10       | Any other custom video or composition                                                                              | `/general-video`           |

Before finalizing the route, read `references/routes/<workflow>.md` — one small file per route: the canonical input/output/trigger contract (available before lazy-installed workflow skills are present) plus that route's interview entry. If the candidate does not satisfy its contract, continue routing instead of forcing the match. Read only the matched route's file.

### Resolve common ambiguities

- A short animated title, logo sting, stat hit, chart hit, map hit, or standalone lower-third is `/motion-graphics` when it is unnarrated and motion is the message. A static title card, narrated sequence, longer montage, or custom loop is `/general-video`.
- An explicitly short motion graphic may use a URL, tweet, article, or screenshot as source material. A generic "make a video from this site" request is `/product-launch-video`.
- Existing footage with captions routes to `/embedded-captions`; footage with designed information cards routes to `/talking-head-recut`. Retiming, reordering, recoloring, reframing, or remixing footage is a custom edit and falls through to `/general-video`.
- A music file selects `/music-to-video` only when its beat grid drives the piece. Music used as a bed does not override the subject-matched route.
- "I want a storyboard" changes the review process, not the workflow. With no other routing signal, use `/general-video`. A confirmed sketched `storyboard.html` may itself be the requested deliverable; the review loop defines that stop point.
- Specialized narrative workflows support up to about 3 minutes and are strongest around 30–90s. Route a clearly longer piece to `/general-video`. Length never overrides an explicit port, deck, caption, overlay, or music-driven deliverable.

## 3. Route once, then leave

For fresh creation the intent layer (`references/intent-interview.md`) runs the full conversation — memory, triage, pitch round, must-haves, run-shape, hand-off — and **ends by writing `BRIEF.md`. The brief is the only routing artifact the workflow reads**; nothing later re-opens this skill or the interview. Answer every later "what did the route require?" from `BRIEF.md`.

## 4. Enter the installed workflow

Read the selected workflow from this managed release. Do not refresh skill
folders in place. Missing workflows require a separate candidate update.

## 5. Load domain skills on demand

| Need                                                                                                                                        | Skill                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Composition structure, timing attributes, tracks, variables, determinism                                                                    | `/evocut-core`      |
| Motion rules, scene blueprints, transitions, runtime adapters                                                                               | `/evocut-animation` |
| Seek-safe GSAP, CSS, Anime.js, WAAPI, FLIP, paths, masks, SVG, 3D keyframes, or `hyperframes keyframes` diagnostics                         | `/evocut-keyframes` |
| Design specs, concept, palette, typography, narration, beat planning                                                                        | `/evocut-creative`  |
| Images, icons, logos, audio, captions, grades, LUTs, reusable media                                                                         | `/media-use`             |
| Voiceover carve, audio effect chains, automation envelopes, or one chain/fader across several tracks (submix bus)                           | `/evocut-audio`     |
| Init, lint, check, snapshots, compare, batch render, Studio, render, publish, or diagnostics                                                | `/evocut-cli`       |
| Registry blocks and components                                                                                                              | `/evocut-registry`  |
| A named look, effect, treatment, or transition — CRT scanlines, glitch, film grain, shimmer sweep, confetti burst — BEFORE hand-building it | `/evocut-registry`  |
| Figma assets, tokens, components, or storyboard frames as reconstructed motion                                                              | `/figma`                 |

Creator edit phrases are cross-domain requests. Load every skill named in the matching row:

| Creator request                                                                                                    | Required domains                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “cut this footage”, hard cut, trim, splice, reorder, or use a source range                                         | `/general-video` + `/evocut-core`; core owns `data-start`, `data-duration`, `data-media-start`, and track layout.                                                            |
| zoom in here, punch-in / punch-out, smooth multi-state zoom or reframe, Ken Burns, or camera move                  | `/general-video` + `/evocut-core` + `/evocut-keyframes`; animate the inner visual/crop wrapper, not the timed clip.                                                     |
| match cut or whip pan camera transition                                                                            | `/general-video` + `/evocut-animation` + `/evocut-keyframes` + `/evocut-registry`; search/install a transition primitive before hand-authoring.                    |
| fade, crossfade, track gain/volume, automation, duck/carve, audio effects, or one effect across several tracks     | `/general-video` + `/evocut-core` + `/evocut-audio`; core places clips, audio mixes placed tracks — including a submix bus over a group of them.                        |
| picture and sound edits that combine cuts with camera motion or mixing                                             | `/general-video` + `/evocut-core` + `/evocut-keyframes` when there is visual motion + `/evocut-audio` when sound is faded, mixed, ducked, automated, or processed. |
| lay out a project so it reads well in Studio: caption track, tracks per element kind, sub-compositions, safe zones | `/evocut-studio` + `/evocut-core`; studio owns the layout conventions, core owns each edit.                                                                             |
| source or generate media, or preprocess an unsupported mid-source freeze                                           | `/media-use`; sourcing/generation/preprocessing only, never placed-track mixing.                                                                                                  |

Constant `data-playback-rate` is render-safe for picture and pitch-preserved
sound. Speed ramps are a `rate` lane in `data-automation`.
For copyable edit contracts, load `/evocut-core` → `references/creator-editing-recipes.md`.

Broad feedback about how photographic media looks or behaves also routes to
`/media-use`, even when the user never says “color grading” or “effect”: fix
dark/flat/boring footage, stylize a clip, hide a face, or improve a media
reveal. Read `../media-use/references/media-treatments.md` before editing a
treatment; it governs how footage is treated, never whether media may be used.
Do not substitute a generic LUT, CSS filter/overlay, or opacity tween for an
existing canonical treatment primitive. Keep text/layout/motion-only edits in
their owning domain.
During a build with important photographic media, include one grounded
media-polish scan in the final quality pass; leaving suitable media unchanged is
a valid result.

Domain skills never take ownership of the end-to-end deliverable. Load only what the active workflow needs.
