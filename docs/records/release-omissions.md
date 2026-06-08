# Release Omissions

Record release misses here so the process improves instead of relying on memory.

## 2026-06-08 - 0.1.42 CHANGELOG Omitted

### Symptom

After `1688-cli@0.1.42` was published and pushed, the GitHub file list still
showed `CHANGELOG.md` last changed by `chore(release): 0.1.41`. The npm
package included the old changelog because the 0.1.42 release commit only
bumped `package.json`.

### Cause

The release playbook said to check `CHANGELOG.md`, but there was no executable
gate in `agent-verify` or `prepublishOnly` to fail when the package version was
missing from `CHANGELOG.md`.

### Fix

- Backfilled `CHANGELOG.md` with a `0.1.42` section for released work.
- Added an `Unreleased` section for post-tag README/npm-metadata documentation
  changes that should ship in the next npm version.
- Added `pnpm release-check`, backed by `scripts/check_release.mjs`.
- Added `release-check` to `pnpm agent-verify` and `prepublishOnly`.
- Expanded `docs/playbooks/update-cli-release.md` with changelog, npm, tag, and
  post-publish verification steps.

### Prevention

Before the next publish, move `Unreleased` items into the new version section,
run `pnpm agent-verify`, run `npm pack --dry-run`, and push the release tag
explicitly with `git push origin vX.Y.Z`.
