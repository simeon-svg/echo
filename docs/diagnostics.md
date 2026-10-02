# Local diagnostic reports

Available in Echo 1.6.0 from the Meet widget's bell → **Download diagnostics**.
Download before reloading the failing tab, then attach the JSON file to a bug
report with expected behavior, actual behavior, and reproduction steps. The
extension does not send reports to a server or contact a developer automatically.

## Reading a report

- `schemaVersion` describes the report format. `extensionVersion` is captured
  when the content script starts, so it remains available after its runtime
  connection is invalidated. `unavailable` means the version could not be read.
- `generatedAt` and `startedAt` are UTC timestamps for report generation and
  diagnostic initialization.
- `environment` includes only coarse platform, Chromium version, browser
  language, top-level/embedded frame, and document visibility. No complete user
  agent, URL, account, or operating-system username is exported.
- `state` shows recording mode, active-call detection, caption availability,
  busy/pending-save state, block and visible-row counts, problem flags, and the
  boolean recording/announcement settings. A setting is `null` if loading it
  failed or has not finished. `lastSaveAt` is the most recent acknowledged save
  in this tab; `saveFailures` counts failed snapshot writes.
- `controls` samples the adapter at download time. Each control has `candidates`
  and `found`: zero is missing, one is unambiguous, and more than one means Echo
  refused to choose. Caption regions and chat inputs use the same candidate
  selection rules as normal recording/chat behavior. A missing chat input alone
  is normal when the chat panel is closed.
- `detectionFailed` indicates that the diagnostic control inspection itself
  threw. The earlier recording state is still exported in that case.
- `events` retains at most 100 recent recording-state changes and errors from
  startup, scanning, saving, control actions, history, or chat. Repeated adjacent
  errors with the same classification and source location are counted together.
  Errors include an allowed error name, a stable code, and up to five extension
  source-file/line/column locations when available. No raw message or stack is
  included. Known codes distinguish a disconnected extension, a finalized or
  deleted session, and a blocked database upgrade; other failures use
  `operation-failed`. Missing frames are normal for errors returned by the worker
  or warnings converted to error events.

## Privacy and scope

The report is assembled from explicitly allowed primitive fields. It does not
serialize session objects, captions, names, titles, meeting links, chat drafts or
custom announcements, notification text, DOM HTML, directory handles, backup
paths, or arbitrary exception contents. Counts and technical timestamps remain
in the report. Nothing is stored in IndexedDB or extension settings; downloading
only creates a local JSON file.

A report covers the current Meet tab from diagnostic initialization onward. It
cannot observe another tab's history, earlier page loads, browser policies that
prevented script injection, or errors that happened before the widget could be
created. If the widget is absent, collect the installed version, profile/site
access information, meeting mode, and a screenshot separately. Google Meet DOM
changes still need reproduction against the affected meeting variant.

## Verification

`node --test tests/*.test.cjs` includes privacy checks with sentinel transcript,
name, URL, DOM, announcement and exception values; bounded-history and repeated
error checks; ambiguous-control checks without clicks; and download after
startup failure. A local browser preview also verified the real widget layout
and downloaded JSON under a simulated invalidated extension context. No live
multi-participant meeting or real transcript data was used for that preview.
