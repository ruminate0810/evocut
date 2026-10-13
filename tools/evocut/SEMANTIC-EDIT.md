# Semantic linked editing — first supported subset

`evocut edit` is a conservative editing adapter, not another timeline database.
`index.html` is the content source of truth. Plans are disposable, hash-bound
proposals; a fresh plan is derived from the current HTML and optional measured
transcript cues. No ASR, provider API, model download, render, or paid generation
is invoked.

## Commands

```bash
evocut edit plan --project ./my-video --operation cut --cue sentence-03 --out cut-plan.json
evocut edit apply cut-plan.json               # dry run; no content change
evocut edit apply cut-plan.json --apply       # commit the exact reviewed plan
evocut edit undo /absolute/project/.hyperframes/evocut/semantic-edits/RECEIPT.json
evocut edit undo /absolute/project/.hyperframes/evocut/semantic-edits/RECEIPT.json --apply

evocut edit plan --project ./my-video --operation move --section explanation --by 2 --out move-plan.json
evocut edit plan --project ./my-video --operation cut --range 12:14 --out cut-plan.json
evocut edit remake --project ./my-video --cue shot-03 --prompt "More lively performance; preserve this identity" --out remake-request.json
```

`--out` creates a new file exclusively; it does not overwrite an existing file.
Without it, JSON is printed. `main(argv)` is exported for the launcher and returns
an integer exit status: `0` for a ready plan/success/dry run, `2` for pending or
refused work. `--engine-version X.Y.Z` is accepted on `plan`. The installed engine
is resolved through the shared EvoCut launcher, respecting project pins; no
installation or pin change occurs. The native schema is currently tested only
on **0.8.81**. A different selected version is explicitly refused until its adapter
has been verified. This is not a claim that older/newer engines lack editing.

## Explicit cross-track association

All affected non-BGM clips must declare a role and a link group. This prevents
filename similarity, coincidental timing, or a repeated sentence from being
mistaken for a true association.

```html
<main id="root" data-composition-id="demo" data-duration="12" data-fps="30">
  <video id="picture-03" class="clip" src="assets/shot.mp4"
    data-start="4" data-duration="2" data-track-index="0"
    data-evocut-role="video" data-evocut-link="group-03"
    data-evocut-cue="sentence-03" data-evocut-section="explanation"></video>
  <audio id="voice-03" class="clip" src="assets/voice.wav"
    data-start="4" data-duration="2" data-track-index="1"
    data-evocut-role="voice" data-evocut-link="group-03"
    data-evocut-cue="sentence-03" data-evocut-section="explanation"></audio>
  <div id="caption-03" class="clip" data-start="4" data-duration="2" data-track-index="2"
    data-evocut-role="subtitle" data-evocut-link="group-03"
    data-evocut-cue="sentence-03" data-evocut-section="explanation">The sentence</div>
  <audio id="music" class="clip" src="assets/music.wav"
    data-start="0" data-duration="12" data-track-index="4"
    data-evocut-role="bgm" data-evocut-link="bed"></audio>
</main>
```

Roles: `video`, `voice`, `subtitle`, `sfx`, `graphic`, `bgm`.
Use distinct stable simple HTML IDs. Root duration and FPS, and every clip's
numeric start/duration must be explicit. Selections and movement use exact frame
boundaries; the adapter never silently snaps a sentence boundary.

- `cut`: remove the specified global interval across all explicitly marked
  affected tracks, shift everything later by the same amount, and shorten the
  root duration. Partial spans use **native split** so media source offsets are
  retained correctly. The root is not left padded with deleted time.
- `move`: move a complete explicit link group (or section of complete groups) by
  the same delta on every track. Destination overlap, partial groups, and moves
  beyond the existing root bounds are pending rather than automatically extended.
- BGM: at most one explicitly marked audio bed spanning exactly the root.
  Cuts keep its source offset/start intact and shorten its tail: there is **no
  middle splice**. Moves leave it untouched. No fade is invented; a new tail may
  require an audio edit and human review.

## Measured transcript cues

`--semantic /path/to/semantic-timeline.json --cue ID` accepts the existing
`tools/video_qa/semantic_timeline.py` cue shape (`status: aligned`,
`start`, `end`, `phrase`). To reuse it safely, bind it to the composition against
which those final-clock timestamps were verified:

```json
{
  "duration": 12,
  "composition": { "sha256": "SHA256_OF_CURRENT_INDEX_HTML_BYTES" },
  "cues": [{ "id": "sentence-03", "phrase": "The sentence", "status": "aligned", "start": 4, "end": 6 }]
}
```

The adapter does **not** add this binding or attest that clocks match on its own.
If audio/transcript fingerprints are present, their current files must still
match too. `--text` only works with a measured, hash-bound timeline; multiple
matching phrases are refused and must be resolved by an explicit cue ID.
`sections` may be supplied similarly as aligned/resolved unique spans.

## Safety and native reuse

1. Read-only structural scan and hash-bound input selection.
2. Generate native `timeline apply` operations.
3. Run native `timeline apply --plan`, then actual `timeline apply`, in an isolated
   temporary project. No media tree is recursively copied and no real project is
   changed. Native offsets, clone IDs, and mutation receipts are exercised.
4. Adjust the root duration in the isolated result. Require a deterministic
   after-content hash. A pending plan cannot apply.
5. With explicit `--apply`, recheck all hashes, regenerate the exact same plan,
   and acquire a project-local adapter lock. An already-open native history turn
   blocks this edit; it is not closed or hijacked.
6. Begin a native history turn, invalidate QA, then commit exactly **one** live
   content file (`index.html`) with a last hash check and atomic rename.
7. End native history. Keep the native history entry ID and isolated native
   receipt in `.hyperframes/evocut/semantic-edits/<uuid>.json`.
8. Undo checks the current content hash and calls native `history undo` with its
   original entry ID. It also uses native newer-entry conflict protection. Undo
   does not overwrite a later human/session change.

The adapter lock coordinates this adapter, not every external editor. Native
history/conflict checks and last-moment hashes reduce races; like the upstream
file writer, the filesystem hash-check/rename boundary is not a universal OS
compare-and-swap lock. Do not run simultaneous writers on one project. If another
writer is captured in the same history entry, or history completion fails, the
receipt is `recovery-required`; automatic undo is withheld, the evidence retained,
and the CLI reports that state instead of claiming success or blindly rolling
back someone else's work. Stale locks are never silently deleted.

The first adapter deliberately marks nested/template compositions, arbitrary
scripts/tweens, CSS animations/transitions, external CSS, SMIL/embedded timelines,
relative timing, speed changes, automation and audio FX/group retiming as pending.
An empty GSAP paused timeline plus `window.__timelines` registration is accepted.
These restrictions describe this adapter, not limitations of the native engine.

## QA invalidation contract

Apply and undo both write:
`.hyperframes/evocut/qa-invalidated.json`

```json
{
  "schema": "evocut.qa-invalidation/v1",
  "status": "invalidated",
  "reason": "semantic-edit",
  "transaction": "UUID",
  "indexSha256": "SHA256_OF_CURRENT_INDEX_HTML_BYTES",
  "at": "ISO-8601",
  "invalidates": ["semantic-timeline", "QA-samples", "audio-sync", "check", "render", "human-review"]
}
```

The marker is written before the content commit too (reason
`semantic-edit-commit-started`) so a process crash cannot leave old approval
silently valid. Existing QA files are retained as history, not rewritten to pass.
Any release gate must verify a fresh render is bound to the current composition
hash; an old MP4 and old successful audit are insufficient. No automatic visual,
audio, semantic, or human pass is claimed by this tool.

## Local remake boundary

`remake` emits selected visual shot IDs, source hashes, precise ranges, prompt,
constraints, and a deterministic request fingerprint. It has **zero paid
requests** and does not choose or call a vendor. Replacement is deliberately
**not implemented in this batch**, even for a file with the same nominal length:
probe dimensions/duration/voice and review the actual generated result first.
The request says `pending-generation-and-human-approval`, not “generated.”

## Verification

```bash
node --test tools/evocut/semantic-edit.test.mjs
```

Tests use temporary synthetic compositions, with actual installed native
`timeline apply` and `history undo`. They do not render media, contact suppliers,
or edit real videos. Coverage includes cross-track cut/move, root duration,
continuous BGM, native split offsets, repeated text ambiguity, stale plan,
tampered plan, stale undo, unsupported layouts/automation, empty registration,
QA invalidation, and remake fingerprints. A technical test pass is not creative
or playback acceptance for an edited production video.
