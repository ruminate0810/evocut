# EvoCut asset admission audit

`audit_asset_plan.py` is a local, read-only media/manifest gate. It does not call
generation APIs, ASR, face recognition, publishing, or video re-encoding. Only its
JSON report is written; an output path matching source media or the input manifest
is rejected.

## Commands (repository root)

```bash
# Validate declarations only: no source file access or ffprobe. Example paths and
# hashes are placeholders, not assertions that a source asset exists.
python3 tools/video_qa/audit_asset_plan.py \
  tools/video_qa/examples/asset-plan.example.json \
  --schema-only \
  --output outputs/hyperframes-upgrade-20260923/asset-admission/schema-example-report.json

# Real admission, after recording actual local paths / SHA-256 / coded dimensions:
python3 tools/video_qa/audit_asset_plan.py /absolute/path/asset-plan.json \
  --output /absolute/path/asset-audit.json

python3 -m unittest tools.video_qa.test_audit_asset_plan -v
```

Relative asset paths resolve from the manifest directory. Each asset records a
unique ID, local file path, SHA-256, source width/height, crop x/y/width/height,
target width/height, explicit `fit` (`cover`, `contain`, `stretch`), and `in`/`out`
seconds. A real probe verifies SHA, coded dimensions and range against ffprobe.
Crop coordinates are coded pixels; non-square pixels or rotation metadata get an
explicit review warning rather than an implicit autorotation assumption.

The report includes cropped effective pixels, retained visible source pixels,
X/Y scale, aspect mismatch, and maximum upscale. The default `max_upscale` is
1.25: strictly greater values warn. Set `thresholds.max_upscale` in the manifest
for another threshold. Nonuniform `stretch` beyond `aspect_tolerance` (default
0.005) fails. `cover` may remove part of a crop; `contain` may leave margins. Neither
is called distortion merely because source and target aspect ratios differ.

Technical pass is **not** full decode proof or an artistic/media-rights certificate.
ffprobe verifies container/stream structure, not every frame. This audit does not
claim that a declared crop is how a separate composition actually renders it.

## Explicit human review

Asset fields: identity, voice_consistency, performance, anatomy,
action_continuity, eyeline, lip_sync, story_logic. Missing fields default to
`pending`. The tool never substitutes automatic pixel checks for these judgments.

Non-pending declarations require `reviewed_by`, `evidence`, and an asset-bound
`reviewed_sha256`. `not_applicable` additionally needs a reason, for example a
landscape clip with no character. Passing a field means **human-declared**, not
automatically verified. A changed source invalidates its old review hash.

## Charts

Every chart needs finite numeric data with labels, a nonempty unit, an ISO
`as_of` date, and `source.title` plus a source URL/path. An illustrative chart can
instead name `source.kind: editorial`; use an explicit illustrative scale as its
unit. It must provide a `display_label` whose text says “示意”/“illustrative”/“not
actual”, with `visible: true` and a render selector. That declaration alone does
not prove the actual video shows the label.

`source_verified`, `meaning_matches_narration`, and `label_visible_in_render`
are separate human review fields, default pending. URLs are recorded but never
fetched or presented as fact-checked by this tool.

Each chart report emits `canonical_sha256`, computed from its ID, illustrative
flag, numeric data, unit, as_of date, source, and display_label using sorted-key
canonical JSON. A non-pending chart review must include `reviewed_sha256` matching
that fingerprint. Changing values, units, dates, source or visible label invalidates
old reviews rather than carrying their conclusions onto new data. Review fields
themselves are excluded from the hash to avoid a circular binding.

## Status contract

- `technical_status`: `schema_pass` / `pass` / `fail`.
- `readiness`: `pending_media_verification`, `pending_human_review`,
  `pending_warning_review`, `blocked`, or `ready_for_edit`.
- `release_approved` is always false; no publication gate or release file changes.
- Exit 2 means schema/media technical failure. Warnings/pending reviews exit 0
  so low-risk technical checks can run, while readiness remains plainly pending.

The test suite creates a one-second synthetic pattern in a temporary directory,
checks real ffprobe behavior and source hash preservation, then removes only that
temporary fixture. No historical project is touched.
