# Contributing

Use Node 22+, Python 3.11+, and FFmpeg. Install optional Python test dependencies
in a virtual environment with `requirements-dev.txt`; set `EVOCUT_PYTHON`.
Run `npm test` before submitting changes. Integration tests use temporary files;
do not test mutation commands on another person's video or global installation.

Keep engine names, `data-*` contracts and original copyright notices intact.
Do not change a project's exact engine pin while making an unrelated edit.
Use a new release ID, validate, then promote deliberately. Never edit an active
snapshot. Preserve missing-evidence and human-review boundaries.

Optional recipes must identify nonbundled dependencies. New media needs explicit
redistribution rights and license files. Do not add personal preferences, keys,
session logs, generated outputs, provider accounts, or publishing workflows.

No model calls or external publishing in tests. Code changes should include
behavior tests. CLI writes should be explicit, conflict-aware and recoverable.
