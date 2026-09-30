# Architecture review — September 30, 2026

Reviewed the complete runtime, manifest, extension pages, CSS, diagnostics,
README, and existing tests at `19b99b1`, then implemented the changes described
below for version 1.5.8.

## Assessment

The existing architecture is appropriate for a small, local-only Manifest V3
extension. Plain JavaScript, isolated Meet content scripts, extension-owned
IndexedDB, and a single background coordinator keep deployment and ownership
clear. A framework, build pipeline, dependency-injection container, or a rewrite
would add maintenance cost without addressing the problems found here.

| Module | Responsibility and review result |
| --- | --- |
| `content/meet-adapter.js` | Owns Meet selectors and ambiguity checks. Keep this seam because Google's DOM can change independently. Resolve account names only when a caption actually refers to the local speaker. |
| `content/captions.js` | Reconstructs caption rows without storage or UI dependencies. Its interface supports direct behavioral tests; retain the pause boundary protection. |
| `content/meet.js` | Coordinates recording, snapshots, settings, and chat notices. Keep lifecycle transitions serialized; coalesce background caption saves when storage is slow. |
| `content/overlay.js` | Owns a closed-shadow-root widget and its placement/notification behavior. No need to move these implementation details into recording code. |
| `content/chat.js` | Sends a single opt-in notice and protects user drafts. Retain its independent state and tests. |
| `background/service-worker.js` | Coordinates authorized messages, durable writes, recovery, and backups. Preserve ordering so late saves cannot undo Stop, rename, or deletion. |
| `storage/storage.js` | Owns schema upgrades, indexed queries, connection lifetime, and atomic batch mutations. Callers should not construct IndexedDB transactions themselves. |
| `storage/calls.js` | Groups durable recording segments into conversations. Keep separate records rather than rewriting recordings into one large merged object. |
| `storage/backup.js` | Owns TXT files, permissions, retry state, cleanup, and alerts. Preserve the distinction between permission waiting and write failure. |
| `pages/` | Renders local data and initiates actions through the worker. Preserve user gestures for permission requests; report preparation errors and freeze the selected IDs before showing a bulk-action dialog. |

The declared permissions all have current uses: settings (`storage`), recovery
(`alarms`), backup alerts (`notifications`), and retained local transcripts
(`unlimitedStorage`). No new permission, external service, or runtime dependency
was added. Rendering transcript data with `textContent` avoids interpreting
captions as HTML.

## Problems corrected

- Regular saves, recovery, tab finalization, individual transcript reads, and
  backup-folder status unnecessarily loaded the entire transcript history.
  Call, tab, and status indexes now restrict these operations to relevant records.
- Merge, rename, and multi-segment deletion could commit only part of a user
  action. They now use one IndexedDB transaction for all transcript mutations.
- Legacy records without `callId` needed migration before indexed lookup.
  The upgrade fills the missing identity without altering existing grouping or
  backup metadata. Blocked upgrades report an actionable error; cached
  connections close on version changes.
- Malformed session snapshots could be stored and then break listing/export.
  Validate their structure before writing and derive the Meet URL from the sender.
- Missing IDs in a bulk selection were silently ignored. Reject the operation
  before any backup or transcript changes.
- Rename did not advance `updatedAt`, which is also the backup version. Rename
  and merge now advance it.
- Recovery relied on an alarm created only at installation. Check and restore it
  each time the worker starts, preserving an existing alarm's schedule. A
  recovery check uses its observation time so queue delays behind slow backups
  do not falsely classify a fresh session as interrupted.
- Slow storage accumulated full transcript snapshots and redundant heartbeats.
  Keep one caption save in flight and schedule the latest changes afterward;
  control actions still preserve ordering and Stop retains the final text.
- Some deletion/merge preparation errors escaped UI error handling. Show them
  through notifications. A retained-backup warning now uses the existing Echo
  dialog before navigating away.
- Select all rebuilt every speaker section. Update existing checkboxes instead.
  Skip full-text construction for an empty listing search and reuse caption rows
  within each scan.
- Remove the unused action-menu implementation, its listeners/icons/CSS, the
  write-only captions-attempt counter, superseded CSS declarations, and the
  obsolete English-only investigation script. Historical DOM findings and
  fixtures remain in `docs/` and `tests/fixtures/`.

## Validation

- Run `node --test tests/*.test.cjs` for all automated behavioral checks.
- Run `tests/storage-browser.html` through the local server documented in README
  for real-browser IndexedDB checks. It substitutes a dedicated test database
  name into the actual storage module; extension data is not used.
- Browser checks cover blocked upgrade/retry, v2 migration, existing call IDs,
  backup-state retention, indexes, batch writes/deletes, synchronous and
  asynchronous rollback, and releasing connections during version changes.
- Verify manifest/changelog agreement, JavaScript syntax, and `git diff --check`.

## Limits and tradeoffs

This review does not establish that every path is maximally optimized. Listing
and searching still load full transcript text because copy/export/search use it;
very large archives may justify pagination and a search index after measurement.
Backups share the ordered worker queue to keep rename/delete/file cleanup
consistent, so a large backfill can delay other requests. Snapshot coalescing
limits the memory buildup but does not make filesystem writes instantaneous.
IndexedDB transactions cannot atomically commit filesystem changes; existing
backup retry/cleanup state handles those failures separately.

The automated Meet fixtures cannot guarantee compatibility with future Google
DOM changes, background-tab timer throttling, every locale, or every Workspace
meeting variant. This change was not validated in a live multi-participant Meet
call or against the user's actual backup folder. DOM detection and caption
reconstruction remain heuristic, as documented in README.

Chrome's alarm persistence behavior and recommended worker-start check are
specified in the [official alarms documentation](https://developer.chrome.com/docs/extensions/reference/api/alarms).
