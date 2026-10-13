---
name: evocut-animation
description: "All animation knowledge for EvoCut — atomic motion rules, multi-phase scene blueprints, scene transitions, broader motion-design techniques, AND the seven runtime adapters (GSAP default, plus Lottie, Three.js, Anime.js, CSS keyframes, Web Animations API, TypeGPU). Use for any motion or animation task: pick 2-4 rules and compose, or load a blueprint, or look up runtime-specific API (e.g. GSAP eases / Lottie player / Three.js mixer). Also covers auditing an existing composition's choreography (animation map) and 24 named text-animation effects. EvoCut-native: single paused timeline, seek-safe, deterministic."
---

<!-- EvoCut distribution note: third-party binary fonts, music, footage and GSAP vendor copies are not bundled. Templates requiring them are optional recipes; supply licensed assets explicitly. See repository THIRD_PARTY_NOTICES.md. -->

# EvoCut Animation

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


All motion knowledge in one skill: **rules** (atomic recipes), **blueprints** (multi-phase scene templates), **transitions** (scene-to-scene), **techniques** (broader motion-design patterns), and **adapters** (per-runtime APIs).

For the composition contract (data attributes, sub-compositions, determinism) see `evocut-core`.

For reference recreation, material-driven animation or feedback that motion feels
weak, use [EvoCut reference-quality](../evocut/references/reference-quality.md),
especially 6–18 (cadence, local action, constraints, acting, object identity and
depth) and 19–22 (shared state, masks and deterministic seeking). Match the
observed mechanism before choosing a generic tween. Example redraw frequencies
and sample intervals apply to their examples, not all animations.

## Default: compose atomic rules

Pick 2-4 rules from `rules-index.md`, glue them together with a single paused GSAP timeline, done. This is faster and produces less code than starting from a blueprint.

## Load a blueprint when

- The scene matches an existing pre-designed multi-phase template (brand-reveal, social-proof, etc.) and reusing its phase pipeline saves real authoring time
- You want runnable ground-truth code for a complex 4-5 phase choreography

Blueprints live in `blueprints-index.md`. Each entry points to `blueprints/<id>.md` (recipe). Do not read it speculatively; load it when you've already decided you need scene-level orchestration.

## Routing

| Want to…                                                                       | Read                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------- |
| Pick an atomic motion pattern by trigger / tag                                 | `rules-index.md`                                    |
| Read one rule's full HTML / CSS / GSAP recipe                                  | `rules/<name>.md`                                   |
| Pick a multi-phase scene template                                              | `blueprints-index.md`                               |
| Read one blueprint's full recipe                                               | `blueprints/<id>.md`                                |
| Author a scene transition (CSS-driven, between two clips)                      | `transitions/overview.md`, `transitions/catalog.md` |
| Look up a broader motion-design technique                                      | `techniques.md`                                     |
| Motion blur — shutter smear on an element, and when not to use it              | `references/motion-blur.md`                         |
| Analyze an existing composition's animation map                                | `scripts/animation-map.mjs`                         |
| GSAP API — timeline / tweens / position parameters                             | `adapters/gsap.md`                                  |
| GSAP — drop-in effect recipes                                                  | `rules/gsap-effects.md`                             |
| GSAP — transforms / perf                                                       | `adapters/gsap-transforms-and-perf.md`              |
| GSAP — eases / stagger                                                         | `adapters/gsap-easing-and-stagger.md`               |
| GSAP — timeline / labels                                                       | `adapters/gsap-timeline-and-labels.md`              |
| Lottie / dotLottie (After Effects exports, `window.__hfLottie`)                | `adapters/lottie.md`                                |
| Three.js / WebGL (3D scenes, `AnimationMixer`, `hf-seek`)                      | `adapters/three.md`                                 |
| Anime.js (`window.__hfAnime`)                                                  | `adapters/animejs.md`                               |
| CSS keyframes (`animation-delay` / `play-state` / `fill-mode`)                 | `adapters/css-animations.md`                        |
| Web Animations API (`element.animate()`, `currentTime` seek)                   | `adapters/waapi.md`                                 |
| TypeGPU / WebGPU (`navigator.gpu`, WGSL, compute pipelines)                    | `adapters/typegpu.md`                               |
| HTML-as-texture + WebGL/GLSL post-fx (capture live DOM via `drawElementImage`) | `adapters/html-in-canvas-patterns.md`               |
| Named text-animation effects (24 IDs via external `animate-text` skill)        | `adapters/animate-text.md`                          |

## Picking a runtime

- **GSAP** is the default for 95% of motion work — covers timeline orchestration, transforms, easing, stagger. All atomic rules in this skill are GSAP-based.
- **Lottie** when an asset has its own pre-baked timeline (typically After Effects exports).
- **Three.js** for 3D scenes, camera motion, shader-driven visuals.
- **Anime.js** for lightweight tweening when GSAP is overkill.
- **CSS** for simple repeated motifs, decoration, shimmer — no JavaScript animation cost.
- **WAAPI** for native browser keyframes without a GSAP dependency.
- **TypeGPU / WebGPU** for GPU-rendered canvases (particles, liquid glass, custom shaders).

Multiple runtimes can coexist in one composition. Each registers its instances on the runtime-specific global so EvoCut can seek all of them in one pass.

## Critical Constraints

**Prerequisite: `evocut-core` → Non-Negotiable Rules and
`references/determinism-rules.md`.** Core owns seekability, time sources, finite
timelines, clip lifecycle and registration. Follow the project's pinned engine and
its documented setup path. Where async font/asset setup is supported, finish
building before registering the timeline; do not register an empty timeline and
populate it later. Do not infer a blanket async ban or property allowlist from this
skill; read the owning contract.

Animation-craft additions on top of core's contract:

- **Pre-calculated layout constants** — never derive positions from `getBoundingClientRect()` at tween time. Tween-time DOM measurements desync because the renderer samples in parallel; compute coordinates once at composition setup and reuse.
- **Prefer transform aliases for spatial motion** (`x`, `y`, `scale`, `rotation`)
  and opacity where suitable. Other properties follow core, the runtime and the
  pinned engine's lint rules; this is a performance preference, not an invented
  universal allowlist. Verify layout and masks after seeking.

## Scripts

```bash
node skills/evocut-animation/scripts/animation-map.mjs <composition-dir> \
  --out <composition-dir>/.hyperframes/anim-map
```

Reads every GSAP timeline registered on `window.__timelines`, enumerates tweens, samples bboxes, computes flags, outputs `animation-map.json`. Use it to audit choreography (dead zones, stagger consistency, lifecycle warnings) after authoring.

`animation-map.mjs` resolves helper packages from the current project first, then can bootstrap the bundled EvoCut package version. Set `HYPERFRAMES_SKILL_PKG_VERSION=<version>` only when running the skill outside the bundled CLI/skill install and you need to pin that bootstrap version explicitly.

## See Also

- `evocut-core` — composition structure, data attributes, sub-compositions, deterministic render contract
- `evocut-creative` — palettes, typography, narration, beat planning (non-animation creative direction)
- `evocut-cli` — `evocut lint / check / snapshot / preview / render`
