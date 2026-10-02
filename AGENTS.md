# Extension releases

For every separately requested and completed update to extension behavior, UI,
or permissions, bump `manifest.json`'s version and add a matching entry to
`CHANGELOG.md`, including small improvements. Bump again for a subsequent update
in the same conversation, even when earlier updates remain uncommitted or
unpublished. Use patch for fixes and small UI refinements, minor for new features,
and major for breaking changes. Keep one version bump while implementing and
verifying a single requested update.

The manifest is the source of truth for the extension version. Before delivering
an update, verify that the changelog's latest version matches the manifest and run
`node --test tests/*.test.cjs`.
