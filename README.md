# Echo

Echo is a Manifest V3 Chrome extension that saves Google Meet live captions as
local transcripts. It has no backend, API, OAuth, AI, audio recording,
telemetry, or cloud synchronization.

## Features

### Recording

- Start recording automatically when joining a Meet call, or start it manually.
- Capture regular Meet captions, including speaker names and timestamps.
- Pause and resume recording without turning off Meet captions. Paused speech is not saved.
- Stop a transcript and start a separate transcript in the same call.
- Recover unfinished transcripts after a tab close, navigation, browser restart,
  or missed heartbeat.

### Meet overlay

- Show recording, paused, stopped, waiting, and local-save-error states.
- Keep all controls visible in fixed positions; disable unavailable actions.
- Provide Pause, Resume, Stop, Start New Transcript, and History controls.
- Drag the overlay or move it with the keyboard. Dragging near a corner snaps
  it to 20px from both edges; resizing preserves its distance from nearby edges.
- Keep the widget visible while waiting for a meeting or when detection fails.
  The notification button is always visible, with a count when messages are waiting.
  Click it to expand toward the available space above or below and read or dismiss messages; controls stay
  in place. Closing the panel preserves messages; each message has its own dismiss button.
  Messages remain until dismissed or resolved, and dismissed active
  problems stay closed until the condition changes or resolves and recurs.

### Transcripts

- Browse all saved calls from the extension toolbar or the overlay's History button.
- Search titles, speaker names, and transcript text.
- Rename, copy, download as UTF-8 TXT, or delete transcripts.
- Merge multiple transcripts into a new conversation.
- Keep transcripts indefinitely; Echo does not automatically delete them.

### Meet chat announcement

- Optionally send one notice through Meet's own chat when the first recording
  starts in a call.
- Edit the notice text in Settings; the custom message is saved on this device.
- Do not replace an existing chat draft or use a messaging API.
- Ask you to announce the transcript manually when chat is unavailable.

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

All settings are saved automatically on this device. Recording mode changes apply
when joining the next call. In manual mode, captions are enabled only after you
press Play.

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

The main areas are:

- `content/meet.js` — Meet integration, recording lifecycle, and session creation.
- `content/meet-adapter.js` — Meet DOM detection and controls, independent of UI labels.
- `content/captions.js` — caption reconstruction and pause boundaries.
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
