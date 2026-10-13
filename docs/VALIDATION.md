# Validation record

## Portable setup v0.1.1 — 2026-10-13

- Full regression suite: 120 Node tests and 115 Python tests passed on macOS.
- 18 new bootstrap tests cover read-only diagnostics, credential exclusion,
  interpreter selection, dry-run behavior, download consent, custom Agent roots,
  conflict refusal, backup/restore, path aliases and local child-command shims.
- A separate empty release home was initialized and validated using the already
  installed pinned engine. This was not a cold network or another-OS install.
- The complete release skill tree (41 entries including compatibility aliases
  and shared references) was bound to an isolated Agent directory, then restored.
- Real render/QA prerequisite checks succeeded. ASR correctly reported a missing
  explicit model selection; beats correctly reported missing optional packages.
- No optional Python packages or model weights were downloaded in this turn;
  feature install plans and guards were tested, not every optional installer.
- The existing global launcher and production release pointer were unchanged.
- Windows apply paths fail explicitly; Linux/Windows end-to-end execution and
  compatibility with an unnamed desktop Agent remain unverified.

## Initial distribution — 2026-10-13

Performed on macOS arm64 with Node 24 and HyperFrames 0.8.81:

- 102 Node tests passed, including native linked edit/apply/undo using the
  checkout's engine and temporary fixture projects (not a global installation).
- 115 Python regression tests passed.
- 29 skill entrypoints passed the skill metadata validator.
- A fresh, pinned npm engine install was branded, snapshotted, validated and
  promoted in an isolated checkout release home.
- Rebuilt engine files match the original stable runtime, excluding dependencies
  and the modification notice containing its local installation path.
- The static 640×360, 2-second sample passed lint/runtime/layout/contrast checks,
  rendered to MP4, decoded, and passed source-bound silent-video technical QA.
- One exported frame was visually inspected. This was not a review of all video
  templates; the smoke clip has no speech or music. The QA report correctly
  retains pending human approval and writes no approval marker.
- Source hygiene scan passed: no detected credential patterns, personal home
  paths, business-workflow imports or restricted binary-media extensions in scope.

These are test results, not a guarantee of copyright clearance or defect-free
operation. Optional media recipes were not all rendered. ASR engines/models,
paid generation APIs and external publishing were not exercised.

Raw logs, runtime installs, snapshots and MP4 outputs are local ignored files,
not distributed repository artifacts. A CI template repeats unit tests and
isolated setup, but is not active: the initial GitHub authorization did not
include workflow-write permission. See `docs/ci/github-actions.yml` for activation
instructions. Linux CI execution has not yet been verified.
