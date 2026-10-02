# Echo

Echo is a Manifest V3 Chrome extension that saves Google Meet live captions as
local transcripts. It has no backend, API, OAuth, AI, audio recording,
telemetry, or cloud synchronization.

## Features

### Recording

- Start recording automatically when joining a Meet call, or start it manually.
- Capture regular Meet captions, including speaker names and timestamps.
- Stop to finalize a transcript; starting again in the same call creates a separate history entry.
- Leave Meet captions enabled when stopping; speech between recordings is not saved.
- Recover unfinished transcripts after a tab close, navigation, browser restart,
  or missed heartbeat.

### Meet overlay

- Show recording, stopped, waiting, and local-save-error states.
- Keep all controls visible in fixed positions; disable unavailable actions.
- Use one recording button: green to start, red to stop, alongside bookmarks, History and notifications.
- Drag the overlay or move it with the keyboard. Dragging near a corner snaps
  it to 20px from both edges; resizing preserves its distance from nearby edges.
- Keep the widget visible while waiting for a meeting or when detection fails.
  The notification button is always visible, with a count when messages are waiting.
  Click it to expand toward the available space above or below and read or dismiss messages; controls stay
  in place. Closing the panel preserves messages; each message has its own dismiss button.
  Messages remain until dismissed or resolved, and dismissed active
  problems stay closed until the condition changes or resolves and recurs.

### Bookmarks and personal notes

- Click the bookmark icon while recording to mark the current moment immediately.
- Saving a bookmark does not open a text field. Click Add Note to write one.
  The confirmation hides after five seconds unless focused; an opened note stays visible.
  Note text saves automatically in Meet; Done closes it after saving.
- Opening notifications hides the note panel; reopening it preserves the note.
  Use the top-right close button to dismiss it. The bookmark icon fills briefly after saving.
- Escape or Ctrl/Cmd+Enter closes a saved Meet note.
- Add one bookmark to a speaker section without opening the note editor; repeated marks reuse it.
- Transcript bookmarks have an Add Note button. Notes can be edited; the bookmark’s
  delete button removes both the marker and its note. Save note and Cancel apply to
  the text editor.
- Keep highlighted notes beside their replies and show bookmark/note counts in call history.
- Label personal text as `AUTHOR NOTE` in copied transcripts, TXT downloads,
  selected speaker sections and automatic backups. Empty markers export as `BOOKMARK`.

### Transcripts

- Browse all saved calls from the extension toolbar or the overlay's History button.
- Search titles, speaker names, transcript text, and personal notes.
- Rename, copy, download as UTF-8 TXT, or delete transcripts.
- Merge multiple transcripts into a new conversation.
- Mark new recordings from the same Meet call with a subtle indicator and merge them with one click after recording stops.
- Suggest possible matches for older recordings using Meet links, nearby times, and shared participants or tab identity; review and choose the entries before merging. Original backup files are kept.
- Keep transcripts indefinitely; Echo does not automatically delete them.

### Meet chat announcement

- Optionally send one notice through Meet's own chat when the first recording
  starts in a call.
- Edit the notice text in Settings; the custom message is saved on this device.
- Do not replace an existing chat draft or use a messaging API.
- Ask you to announce the transcript manually when chat is unavailable.
- Support both the original Meet chat and the embedded Google Chat composer.
  The embedded composer requires site access to `chat.google.com`; its helper
  runs only in embedded spaces and accepts announcement requests from Meet.

### Automatic backups

- Save completed and recovered transcripts as readable TXT files.
- Choose a parent folder; Echo creates `Echo Backups/YYYY-MM/` inside it.
- Back up existing conversations when a folder is selected.
- Use **Back up now** to recreate missing files and update changed files.
- Show backup status per call and retry permission-blocked or failed writes.
- Delete a TXT backup separately when deleting a transcript, if requested.
- Preserve original backup files when merging unless you choose to delete them.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the Echo project directory.
4. Reload any Meet tabs that were already open.

After changing source files, click the extension's **Reload** button and reload
the Meet tab.

Check the installed version in `chrome://extensions`. Reload the extension and
the Meet tab after an update. Release changes are listed in `CHANGELOG.md`.

Enable **Allow in incognito** on Echo's extension details page to use it there.
The toolbar icon and Meet **History** open Echo in the same window. Conversations
and settings are shared with regular windows, and incognito recordings remain
in your local history after all incognito windows close. Echo sends incognito
history operations to its regular worker, which owns the existing durable
IndexedDB database; no history migration is needed. Backup folder selection
and permission prompts open regular Echo Settings, while granted backups work
for recordings from either window type.

If no widget appears at all, check that Echo is enabled in the Chrome profile
used for the meeting and allowed on `meet.google.com`. Echo cannot display an
error if Chrome has not injected its scripts, including when an organization
blocks the extension. Embedded Meet frames outside a normal Meet tab have not
been validated; open the meeting in its own `meet.google.com` tab.

## Use

1. Open **Settings** from the calls listing page.
2. Choose automatic or manual recording and whether to send the Meet chat notice.
3. Join a Google Meet call. Echo detects Meet controls using technical DOM markers
   rather than translated interface labels.
4. Use the Echo overlay to control recording, or open **History** to manage calls.

**Include an AI prompt with transcripts** adds an editable prompt before copied
transcripts and downloaded TXT files, including individual speaker sections and
selections. Enable it in Settings to show the prompt field, prefilled with an
English meeting-summary prompt. The option is off by default, and prompts are
never included in automatic backups.

All settings are saved automatically on this device. Recording mode changes apply
when joining the next call. In manual mode, captions are enabled only after you
press Play.

Set **Your name** in Settings to label your own replies in call pages and TXT
exports, including older replies saved as “You”. Leave it blank to use the name
captured from Meet or “You”. Older recordings saved under an actual name without
self identity cannot be safely relabeled. Changing this setting does not rewrite
backup files or change recording timestamps. Any backup created or rewritten
later (including after a title or note edit) uses the current name.

The first recording in a call can send this notice:

> Quick heads-up: I'm saving a text transcript of this call using Meet's live captions, just for my notes. It stays on my device; no audio or video is recorded.

The transcript itself is never sent. Enabling announcements after recording has
started does not send a delayed notice.

## Data and recovery

- Transcripts are stored in the extension's local IndexedDB database.
- The selected backup folder and backup status are stored in the same database.
- Data survives normal Chrome restarts.
- Removing the extension or clearing its profile data removes local transcripts.
- Downloaded and backup TXT files are independent copies and are not imported back
  into Echo.
- Backup TXT files are not encrypted. Anyone with access to the selected folder
  can read them.
- If Chrome asks for folder access again, choose **Allow on every visit**.
- Permission-blocked backup writes stay queued and are retried after access returns.

## Reporting a problem

Before reloading a failing Meet tab, open the bell in the Echo widget and click
**Download diagnostics**. Send the resulting `echo-diagnostics-….json` file with
a short description of what you expected, what happened, and the steps to repeat it.
Include a screenshot of the widget if useful.

The report includes the injected Echo version, Chromium version, platform and
language, recording state, detected control counts, save health, and up to 100
recent state/error events. It contains no transcript text, participant names,
meeting title/URL, custom announcement text, raw DOM, or raw error messages.
Diagnostics stay in the current tab's memory, reset on reload, and are downloaded
only when requested. Nothing is uploaded automatically. The download remains
available if settings loading or recording startup fails.

If the widget is entirely absent, Echo's scripts may not have been injected and
cannot produce a tab report. Include the installed version from
`chrome://extensions`, whether Echo is enabled in that Chrome profile, and whether
the meeting is in a separate tab or an embedded frame. See
[`docs/diagnostics.md`](docs/diagnostics.md) for report-field details.

## Limitations

- Meet integration uses observed DOM markers and untranslated icon names, with
  English labels as a fallback. Bulgarian DOM samples are covered by automated
  tests; additional languages and future Meet UI changes need live validation.
- Echo captures only the captions visible while recording. It cannot recover speech
  from before recording started or while captions were disabled.
- Participants are the speakers captured in the transcript, not the full attendee
  list. `You` and Bulgarian `Вие` are normalized to `You`, or to the Google Account
  name when Meet exposes the English account label. Other local-speaker labels
  are preserved as shown by Meet.
- Meeting titles come from the Meet page title. Unnamed new meetings use a
  `date at time` title; existing transcript titles are not changed.
- Caption rows are reconstructed heuristically. Boundary changes or unusual caption
  rewrites can omit a few words or split text unexpectedly.
- Local storage and backup files are not application-encrypted.

## Development

Echo uses plain JavaScript with no build step or external dependencies.

Run the test suite with:

```sh
node --test tests/*.test.cjs
```

To check IndexedDB migration and transaction rollback in a real browser, run
`python3 -m http.server 8769 --bind 127.0.0.1` from this directory and open
`http://127.0.0.1:8769/tests/storage-browser.html`. It uses a separate local test
database, preserves extension data, and reports each check on the page.

The architecture review and validation limits are recorded in
[`docs/architecture-review.md`](docs/architecture-review.md).

The main areas are:

- `content/meet.js` — Meet integration, recording lifecycle, and session creation.
- `content/meet-adapter.js` — Meet DOM detection and controls, independent of UI labels.
- `content/captions.js` — caption reconstruction and recording boundaries.
- `content/overlay.js` — recording overlay.
- `background/service-worker.js` — saving, recovery, and backup operations.
- `storage/` — IndexedDB storage and backup state.
- `pages/` — transcript listing, transcript details, and settings.

The extension's Meet integration depends on selectors such as:

```text
[role="region"][jscontroller="KPn5nb"]
  .nMcdL          caption row
    .NWpY1d      speaker name
    .ygicle      caption text
```
