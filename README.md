# Echo

A small Manifest V3 extension that saves Google Meet's regular live captions in
this Chrome profile. Plain JavaScript, no build step or dependencies. No backend,
API, OAuth, AI, audio recording, telemetry, or cloud synchronization.

## Install

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Click **Load unpacked** and select this project directory:
   `/Users/simeongold/Sites/transcripter`.
3. Reload any already-open Meet tab. New Meet tabs work automatically.
4. Optionally pin **Echo** in Chrome's extensions menu.

After changing source files, click the extension's Reload button on
`chrome://extensions`, then reload Meet.

## Use

Open **Settings** from the calls listing page to choose automatic or manual
recording and whether to announce the first recording in Meet chat. Both options
default to on and are saved on this device using `chrome.storage.local`. Recording
mode changes apply when joining the next call. In manual mode, press Play in the
Echo panel to begin; captions are not enabled until then. Enabling announcements
after the first recording has started does not send a delayed notice.

Join a call with the Meet interface in English. By default, the extension detects **Leave
call**, enables captions, and begins once the caption control and region are
confirmed. It does not start on the pre-join screen. A small bottom-left overlay
shows the current status and **Pause**, **Resume**, **Stop**, and **History**.
The bar has a translucent background and circular icon buttons with tooltips.
Drag its text or grip to move it; focus the grip and use arrow keys for keyboard
positioning (Shift moves faster). Green means capture is active, amber means
paused, and gray means stopped or waiting. Red indicates a local save error.
After Stop, the play icon (**Start New Transcript**) creates a separate session.

When announcements are enabled, the first recording in a call sends this notice through Meet's own chat UI:

> Quick heads-up: I'm saving a text transcript of this call using Meet's live captions, just for my notes. It stays on my device; no audio or video is recorded.

Resume and additional transcripts within the same call do not repeat it. A new
join/reload can send a new notice. The transcript itself is never sent. If chat
is unavailable or already contains your draft, the overlay asks you to announce
it manually rather than replacing the draft. The chat panel stays open so you
can see the notice. No messaging API or additional permissions are used.

Pause excludes speech from storage and turns off Meet captions. Resume enables
them again; Start New Transcript briefly toggles them to obtain a fresh row.
Old rows visible at a boundary are excluded to avoid including earlier speech;
a few words around these boundaries can be omitted. If caption detection or saving fails,
the overlay reports unavailability rather than claiming to record successfully.

Click the extension toolbar icon or **History** in the overlay to open local
transcripts. Search titles, speaker names, and text. Open a transcript to rename
it, download UTF-8 TXT, copy it, or delete it. Stop active transcripts before
deleting. There is no expiration or automatic deletion.

## Local storage and recovery

Transcripts are stored in the extension origin's IndexedDB database
`meet-transcripts`, in the `sessions` store. They are not stored in Google Meet's
site storage or `chrome.storage.sync`. Chrome manages the underlying files in
the current profile. Data survives normal Chrome restarts, but removing the
extension or deleting its profile data removes transcripts; TXT downloads are
independent copies.

Caption changes are saved after at most approximately 350 ms while Chrome is
scheduling the tab normally. Recording and paused sessions send a heartbeat
every 15 seconds. Stop/Leave attempts an immediate final save; the background
worker also finalizes on tab closure/navigation. Browser startup and a recovery
alarm preserve unfinished sessions as **interrupted**, using the last saved
time. A missing heartbeat for two minutes is treated as an interruption.
The final unsaved words can be lost on a crash, and throttled/discarded tabs can
interrupt recording. Interrupted sessions remain readable and exportable.

## Limitations

- Google Meet DOM selectors and English control labels are intentionally relied
  upon. Other interface languages are not supported. Caption text itself is
  Unicode and is not restricted to English.
- The extension captures the text Google displays, including recognition errors.
  It cannot retrieve speech from before capture began or while captions were off.
- Speakers use Meet's displayed identity, including `You` for the local user.
  Participants are the speakers actually captured, not a full attendance list.
- Incremental rows are replaced, rolling overlaps merged, and meaningful pauses
  split into new blocks. These are heuristics; overlapping speakers and unusual
  caption rewrites may need tuning. Paused time counts toward session duration.
- Meeting title comes from the page title, with a dated Google Meet fallback.
- Local storage is not application-encrypted; it has the protection of your
  Chrome profile and operating-system account.
- A service-worker suspension alone does not lose data: it reopens IndexedDB on
  the next message. Extension reloads require reloading existing Meet tabs.

## Debug and modify

Start with `content/meet.js`: `SELECTORS`, `controls`, `rows`, and `scan`. The real
Meet DOM inspected on September 24, 2026 used:

```
[role="region"][aria-label="Captions"]
  .nMcdL          caption row
    .NWpY1d      speaker name
    .ygicle      caption text
```

`content/overlay.js` contains the draggable bar and local SVG icons.
`content/chat.js` contains the one-time notice and English chat selectors.
`content/captions.js` holds reconstruction and pause-boundary logic.
`background/service-worker.js` handles saving, finalization, and recovery;
`storage/storage.js` owns IndexedDB. `pages/` contains the two UI pages and TXT
formatting. `docs/meet-dom.md` records live observations.

`content/investigate.js` is an optional diagnostic build, **not loaded by the
normal manifest**. To investigate future DOM changes, temporarily replace the
manifest's content-script JS list with `["content/investigate.js"]` and reload
both extension and Meet. It exports recent candidate DOM changes locally and
does not save transcripts. Use a test call because its JSON includes visible text.

Inspect extension errors on `chrome://extensions` and the worker's **Inspect**
link. Transcript content is not routinely logged to the console.

Run the dependency-free checks:

```
node --test tests/*.test.cjs
```

Syntax checks and synthetic cases cannot replace live Meet testing. See
`docs/meet-dom.md` for what has actually been verified.
