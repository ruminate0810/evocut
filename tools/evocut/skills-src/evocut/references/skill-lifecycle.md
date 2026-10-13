# Managed skill installation and freshness

Use this reference when diagnosing missing or changed local EvoCut skills.
Core and workflow skills are delivered together in a tested release snapshot;
workflow selection never installs or refreshes a skill implicitly.

## What `init` does

The managed `evocut init` scaffolds the requested project with upstream skill
refresh disabled. It does not rewrite installed skill entrypoints. Project pins
remain authoritative; a missing installed engine is a visible blocker.

## Read-only diagnosis

```bash
evocut release status
evocut release verify
evocut --resolve-engine
```

If the launcher or required workflow is unavailable, report the missing local
capability. Do not fall back to a package download or in-place skill installer.

## Intentional updates

Shared improvements are made in the owned source, staged under a new release ID,
validated, and explicitly promoted. Binding entrypoints requires a separate
`evocut release bind-skills --apply`, with backups and guarded restore. Follow the
local release contract in the entry skill; ordinary creation/editing is not
authorization for any of these update operations. Reload a skill after a release
switch. Existing previews and project pins are not silently changed.
