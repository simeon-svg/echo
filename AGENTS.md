# Extension releases

For changes to extension behavior, UI, or permissions, bump `manifest.json`'s
version once per release and add an entry to `CHANGELOG.md`. Use patch for fixes,
minor for new features, and major for breaking changes. Continue using an already
bumped version when completing the same unreleased change.

The manifest is the source of truth for the extension version. Before delivering a release, verify that the changelog's
latest version matches the manifest and run `node --test tests/*.test.cjs`.
