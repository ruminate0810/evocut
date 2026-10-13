# Development & engine updates

Use the checkout-local launcher; do not overwrite a running release or another
project's engine pin. Start with the [contribution guide](../CONTRIBUTING.md).

```sh
npm test
npm run audit:source
# Deliberately prepare a separate compatible engine candidate, then:
npm run evocut -- brand --root /absolute/candidate/engine --apply
npm run evocut -- release stage --engine-root /absolute/candidate/engine \
  --skills-source "$PWD/tools/evocut/skills-src" --id my-candidate --apply
npm run evocut -- release validate my-candidate
npm run evocut -- release promote my-candidate --apply
```

Unsupported engine AST shapes are rejected. Engine upgrades require testing and
may require changes to the patcher and argument schemas. Never patch an active
snapshot in place. See [managed releases](../tools/evocut/LOCAL-WORKFLOW.md).

## Enable CI explicitly

The [GitHub Actions template](ci/github-actions.yml) runs tests and isolated
setup, without paid model calls or publishing. It is **not active** under
`docs/ci`. The initial upload credentials lacked workflow-write permission.

To activate it, copy the template to `.github/workflows/test.yml`, then commit
and push with credentials authorized to write workflows. Confirm the first run
under the repository's Actions tab; do not represent local test results as CI
results. Linux CI execution has not yet been verified.
