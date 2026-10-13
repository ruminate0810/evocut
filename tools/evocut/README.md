# EvoCut tooling

Start with the repository [README](../../README.md). `scripts/cli.mjs` is the
portable entry point; it selects the checkout-local release home unless
`EVOCUT_HOME` is explicitly set. It does not replace a machine's global launcher.

- `evocut.mjs`: exact project pins, upstream argument forwarding, local commands.
- `launch.mjs`: stable snapshot delegation and editable maintenance entry.
- `branding.mjs`: guarded, reversible display patches and full browser-graph cache busting.
- `release-manager.mjs`: stage, verify, validate, promote, rollback, optional skill bindings.
- `media-library.mjs`: offline search, Chinese synonyms, tags, catalog and explicit imports.
- `voice-profile.mjs`: confirmed voices, pronunciation and reference integrity.
- `semantic-edit.mjs`: linked cut/move/undo and remake planning.
- `render-receipt.mjs`: source binding for explicit new full-composition MP4 output.
- `skills-src`: maintained video skill source; never edit an active release snapshot.

Generic QA lives in `../video_qa`, independent of publishing or finance systems.
See [LOCAL-WORKFLOW.md](LOCAL-WORKFLOW.md), [MEDIA-LIBRARY.md](MEDIA-LIBRARY.md),
[SEMANTIC-EDIT.md](SEMANTIC-EDIT.md) and [UPSTREAM.md](UPSTREAM.md).

Ordinary commands never auto-install/upgrade an engine or refresh skills. The
real package remains `hyperframes`; internal APIs, version pins, `.hyperframes`
state, runtime attributes and attribution remain upstream-compatible.
