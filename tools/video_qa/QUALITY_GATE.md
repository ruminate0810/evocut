# Typed offline quality gate (first version)

`quality_gate.py` is a local evidence aggregator, not a universal video-review AI.
It does not synthesize speech, run ASR, download models, call providers, render a
project, modify media, create approval markers, or publish. The Node EvoCut
dispatcher may call this Python CLI unchanged.

## Types and modes

| Type | Audio requirement | ASR requirement | Final human review |
| --- | --- | --- | --- |
| `narrated` | Exactly one actual audio stream | Bound executed-ASR report + current script | Visual + listening |
| `dialogue` | Exactly one actual audio stream | Same; per-speaker identity is not certified | Visual + listening |
| `music` | Exactly one actual audio stream | None | Visual + listening |
| `silent` | No audio stream | None | Visual |

The type is an explicit editorial declaration, not automatically inferred from
the soundtrack. A music video containing spoken words must use a spoken type.
The first-version `silent` contract is deliberately strict: an encoded silent
audio stream is not treated as absent audio.

Default `--check` hashes files and reads prior evidence without subprocesses or
filesystem writes. It needs `--technical-report` pointing to a previous original
`--run` report to certify technical checks. Missing evidence stays `pending`;
stale/malformed evidence is `fail`. Explicit `--check` rejects output flags.
Omitting `--check` while explicitly supplying output flags exports a read-only
inspection's result to **new** files; no existing file is overwritten.

`--run` explicitly executes only local FFprobe/FFmpeg and pure local validators:
stream/duration validation, full decode, near-black candidates, actual LUFS and
true peak, PCM verification of supplied QA audio, and optional reference/asset
audits. It does not manufacture missing ASR or human evidence. A black interval
of at least 0.08 seconds is conservatively blocking, including intentional black
fades; this version has no automatic waiver. No target LUFS is imposed; the
default true-peak ceiling is -1 dBTP. Silence/non-finite loudness fails audible
types. It does not claim a speech intelligibility, noise, clipping-sample-count,
or perceptual quality detector.

```bash
python3 tools/video_qa/quality_gate.py \
  --video /absolute/final.mp4 --type music --run \
  --json-output /absolute/qa/run-001.json \
  --html-output /absolute/qa/run-001.html

python3 tools/video_qa/quality_gate.py \
  --video /absolute/final.mp4 --type music --check \
  --technical-report /absolute/qa/run-001.json
```

Stdout is always a JSON report. `--json-output` and `--html-output` are optional,
explicit writes. Output paths must be new, distinct, and not input paths.
The HTML is static, escaped, self-contained, and has no network resources.

Exit codes: **0** technical pass plus all required existing human reviews pass;
**3** technical pass but human review pending; **2** failed or missing technical
evidence, failed human review, or invalid CLI inputs. Even exit 0 sets
`approved:false` and `approval_written:false`: `release_eligible` is information,
not a release operation.

## Spoken evidence

Reuse the existing `qa_evidence.py prepare / run-asr / review` workflow and pass
`--script` plus `--evidence-manifest`. This gate validates manifest schema,
video/script/audio/artifact hashes, ASR report SHA, ASR input provenance, finite
coverage (default >=0.90), and in `--run` compares the actual final and extracted
audio PCM. It never invokes the arbitrary ASR command from that workflow.

```bash
python3 tools/video_qa/quality_gate.py \
  --video /absolute/final.mp4 --type narrated --script /absolute/spoken.txt \
  --evidence-manifest /absolute/qa/manifest.json --run \
  --json-output /absolute/qa/gate-001.json
```

Changing any source, report, artifact, script, threshold, or type invalidates the
cached technical report. Evidence metadata files are also hashed, so adding
attestations inside an old evidence manifest requires a fresh local `--run`.
All report paths are absolute file records. A record has `path`, `sha256`, and
optionally `size_bytes`; `qa_evidence.record(Path(...))` provides this format.

## Optional source reports

Raw `ok:true` is never sufficient. Use `--audio-report`, `--asset-report`, and/or
`--semantic-report` with a separate explicit `--report-manifest`:

```json
{
  "schema": "evocut.qa-report-bindings/v1",
  "video": {"path": "/absolute/final.mp4", "sha256": "ACTUAL_SHA256"},
  "script": {"path": "/absolute/spoken.txt", "sha256": "ACTUAL_SHA256"},
  "reports": {
    "audio": {"path": "/absolute/audio-audit.json", "sha256": "ACTUAL_SHA256"},
    "asset": {"path": "/absolute/asset-audit.json", "sha256": "ACTUAL_SHA256"},
    "semantic": {"path": "/absolute/semantic.json", "sha256": "ACTUAL_SHA256"}
  }
}
```

Only supplied reports need entries; script is required when `--script` is used.
This manifest is an explicit provenance declaration by the workflow/operator,
not something the gate automatically invents. File hashes prove freshness, not
the identity or honesty of a JSON author. The gate does not sign attestations.

- Audio: accepts `evocut.audio-audit/v1`; requires matching final video,
  reference and plan records, concrete check fields, and finite measured levels.
  `--run` reruns the existing reference-integrity audit with conservative default
  correlation/lag/gain thresholds. Inputs can also be supplied directly as
  `--reference-audio` and `--audio-plan` without an old report. Optional `--edl`
  uses the existing plan EDL-hash check.
- Assets: accepts the existing local-media audit output, not `schema_only`.
  Checks the current manifest, each media SHA, source-probe records, entry counts,
  and current schema/geometry. `--run` reruns the local asset audit. `--asset-manifest`
  can be supplied directly for a fresh local audit. Per-source human fields do
  not certify final frames; an extra `assets` review remains pending.
- Semantics: requires `--semantic-spec`, deterministically rebuilds cues/events/
  sample times from current source files, and requires the semantic audio and
  transcript to be the exact bound final-audio and executed-ASR report in the QA
  manifest. A loose supplied transcript/audio pair is rejected. Semantic meaning
  still requires human review; timed ASR matches alone do not establish it.

No automatic migration or modification of old campaign reports occurs.

## Project source and render binding

Pass `--project /absolute/project` to require source-to-render freshness. This
strict mode reads the current `index.html`, the optional
`.hyperframes/evocut/qa-invalidated.json`, and the render receipt at
`.hyperframes/evocut/render-receipt.json`. Use `--render-receipt /absolute/file.json`
to select a retained receipt explicitly; it is not allowed without `--project`.

```bash
python3 tools/video_qa/quality_gate.py \
  --project /absolute/project --video /absolute/project/final.mp4 \
  --type music --run --json-output /absolute/qa/project-run-001.json
```

The receipt must have `schema:evocut.render-receipt/v1`, an absolute matching
`project`, exact path/SHA256 records for `index` and `video`, a nonempty
`engineVersion`, timezone-qualified ISO `renderedAt`, and
`sourceUnchanged:true`. The renderer, not this gate, produces that declaration
after a successful explicit-output render with the same index bytes before and
after rendering. This gate does not render or fabricate receipts.

An invalidation marker must have `schema:evocut.qa-invalidation/v1`,
`status:invalidated`, a SHA256 `indexSha256`, nonempty `transaction`, and
timezone-qualified ISO `at`. When present, the receipt must additionally have
`renderedAt >= at`. A current matching receipt can satisfy an existing marker;
the marker is **not** removed and does not block valid later renders forever.
The marker's index hash describes that edit, while the receipt must match the
actual current index (including any subsequent manual edit).

Missing receipt means `source_binding.status:pending` and a technical **fail**
in project mode, even when there is no marker. Old receipts, changed index bytes,
another video path/hash, a different project, false `sourceUnchanged`, or
malformed records fail. Index, receipt, and any marker file are all included in
`inputs`/`input_digest`; modifying even metadata invalidates old cached technical
reports and human attestations. Their paths and absent optional marker state are
checked again after QA, detecting changes or newly created markers during a run.

Project binding certifies only the root `index.html` and supplied dependencies,
not unlisted assets, sub-compositions, scripts, fonts, or arbitrary runtime state.
It is local freshness evidence, not a signed guarantee that rendering was honest.
No marker, source, receipt, or media is written or removed. Without `--project`,
the compatible video-only workflow remains available and explicitly reports
`source_binding.status:not_bound`; it cannot claim current-project validation.

## Existing human attestations

Existing valid `qa_evidence.py` visual/listening reviews are read, never written.
In project mode those older video-only records do not grant a pass for the new
source binding: pass remains pending until a separate current `qa_input_digest`
attestation is supplied. Existing explicit failures remain failures. A fresh
render receipt alone never grants human-review pass.
For music/silent videos or extra asset/semantic aspects, an operator may supply
an already-created `--review-manifest` using `evocut.qa-human-review/v1`:

```json
{
  "schema": "evocut.qa-human-review/v1",
  "video": {"path": "/absolute/final.mp4", "sha256": "ACTUAL_SHA256"},
  "qa_input_digest": "EXACT input_digest FROM THE GATE REPORT",
  "reviews": {
    "visual": {"status": "pending"},
    "listening": {"status": "pending"}
  }
}
```

When a current script is supplied, include its file record too. `pass` or `fail`
requires `reviewer`, `notes`, `reviewed_at`, and `attested_performed:true` after
the operator actually performs that review. The gate cannot do that on the
operator's behalf. Required extra keys are `assets`/`semantics` when the
corresponding optional reports are used. Missing or pending aspects never make
`release_eligible:true`; an existing explicit fail is not overwritten by another
pass record. The separate review file is excluded from `qa_input_digest` to avoid
a circular signature, but its own file record is captured in the report.

## Tests

```bash
cd tools/video_qa
python3 -B -m unittest -v test_quality_gate.py
```

Tests synthesize tiny, temporary local FFmpeg fixtures only. Synthetic ASR/image/
review records are test data, never actual claimed human or model evidence. No
models, provider calls, source media, old projects, or approval markers are used.
