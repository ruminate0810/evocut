# Security

Do not put credentials, voice reference recordings, or customer footage in this
repository. Provider credentials belong in environment variables or an OS secret
store; voice-profile files intentionally reject credential fields.

`npm run audit:source` is a heuristic source gate, not proof that all secrets or
copyright issues have been found. Inspect the staged diff before every push.
Runtime data, environments and renders are ignored by default. Git ignore rules
do not remove secrets already committed; revoke exposed credentials immediately.

Report vulnerabilities privately to the repository owner through GitHub private
vulnerability reporting when available. Do not publish exploit details or secrets
in public issues. This project does not automatically send reports anywhere.
