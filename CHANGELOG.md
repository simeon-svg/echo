# Changelog

## 1.18.0 — 2026-10-02

- Add an optional, editable AI prompt in Settings with a default meeting-summary prompt.
- Prepend the current prompt to copied transcripts and downloaded TXT files, including speaker sections and selections, while keeping saved calls and automatic backups prompt-free.

## 1.17.2 — 2026-10-02

- Refresh open transcripts when the personal name changes, updating speaker headings, avatar initials, conversation map labels, and exports together.
- Defer name refresh while editing a title or note to preserve unfinished drafts.

## 1.17.1 — 2026-10-02

- Align the personal-name setting with the other settings: section title, description, field label, then input, using the shared typography and spacing.

## 1.17.0 — 2026-10-02

- Add an optional personal name in Settings, shown for your replies throughout saved calls, transcripts, and TXT exports, including legacy “You” replies.
- Track self identity separately from captured names so changing your personal name does not rename other participants.
- Keep existing backups unchanged when only the personal name changes; use the current name whenever a backup is created or rewritten.

## 1.16.8 — 2026-10-01

- Remove the red interrupted status indicator and confusing recovered tooltip from saved transcripts.
- Combine an interruption and its following unrecorded interval into one gap marker when recording resumes.
- Show one Conversation map marker per speaker turn, matching transcript grouping, and trim the map to the first and last words.

## 1.16.7 — 2026-10-01

- Stop showing a recovery notification when opening or rendering an already interrupted transcript, including empty recordings; keep interruption markers in the transcript.

## 1.16.6 — 2026-10-01

- End the Conversation map at the estimated end of the last caption instead of the recording stop time, removing trailing empty space while preserving pauses inside the conversation.
- Clip gap markers to the displayed timeline and omit gaps after the last words.

## 1.16.5 — 2026-10-01

- Size each speech marker by its estimated speaking duration divided by the full conversation duration on a shared timeline.
- Preserve silence between speech intervals and after the final reply; merge only touching intervals and remove minimum speech widths that exaggerated short replies.

## 1.16.4 — 2026-10-01

- Color the Gaps label with the reserved gap color and preserve gap marker colors on hover and focus.
- Extend Conversation map speech intervals to the next turn, gap, or recording end so the timeline uses its full width.

## 1.16.3 — 2026-10-01

- Collapse legacy duplicate bookmarks from one speaker turn into a single marker and combine their note text.
- Reuse the same bookmark when the turn is marked repeatedly during recording.
- Aggregate consecutive speech blocks from one speaker turn into one Conversation map segment.

## 1.16.2 — 2026-10-01

- Keep one bookmark per speaker turn and reuse it when the same turn is marked again.
- Combine comments from repeated live bookmarks into one note attached to that bookmark.
- Remove the duplicate reply-level bookmark control so each speaker turn has one bookmark action.

## 1.16.1 — 2026-10-01

- Offer only bookmark creation on replies and speaker sections; use Add Note on an existing bookmark to write its note.
- Keep note editing and one delete control on the bookmark, which removes both the marker and attached note.
- Move the Conversation map expansion chevron to the left and keep transcript actions at the far right.

## 1.16.0 — 2026-10-01

- Save bookmarks without automatically opening a note editor, including in the Meet widget; add personal notes through an explicit action.
- Separate bookmark removal from note editing/deletion; deleting a note keeps its bookmark, while deleting the bookmark removes both.
- Expose a note action on speaker-section hover and give copy/bookmark/note controls consistent backgrounds.
- Replace transcript navigation focus outlines with a brief soft highlight and style note Save/Cancel controls.

## 1.15.6 — 2026-10-01

- Remove redundant call times from Conversation map and increase its heading to the normal text size.
- Give the Notes label the same reserved yellow background and text color as bookmark markers.

## 1.15.5 — 2026-10-01

- Move transcript copy, download and delete actions into Conversation map and remove the separate actions/participants panel.
- Show speaker names and percentages on colored chips inside the map, keeping actions available in its compact sticky view.

## 1.15.4 — 2026-10-01

- Center bookmark icons vertically in both conversation-map tracks, replace font-dependent diamonds with SVG icons, and keep edge markers within the track.

## 1.15.3 — 2026-10-01

- Join the expanded sticky conversation map to its compact bar with continuous outer corners and no dividing border.

## 1.15.2 — 2026-10-01

- Show rounded whole percentages beside participant names and in the conversation map, without speaking durations.
- Keep speaker names on one compact row, truncate at 120px and remove internal vertical scrolling from the map.
- Use one centered chevron icon rotated in place for expansion and collapse controls.

## 1.15.1 — 2026-10-01

- Keep participant names as fully colored chips; show speaking estimates and percentages inside Conversation map.
- Place bookmarks on one timeline row and show the four most active speakers with a control for the remaining participants.
- Collapse the sticky map to one combined track; expand on hover or button activation and collapse again when scrolling down.

## 1.15.0 — 2026-10-01

- Mark missing captions, recording breaks and interruptions in transcripts, copies, TXT downloads and backups.
- Add a sticky conversation map with speaker tracks, gap markers and direct navigation to bookmarks and author notes.
- Show approximate caption-based speaking time and each participant's percentage of captured speech, excluding known gaps.

## 1.14.0 — 2026-10-01

- Open Echo from the toolbar and Meet History in the originating window, including incognito, using split incognito mode.
- Keep normal and incognito conversations in one durable history through the regular worker's existing IndexedDB and serialized writes; closing incognito does not discard recordings.
- Forward incognito lifecycle events, preserve terminal errors, and avoid replaying uncertain actions after worker interruption.
- Use the shared backup folder for incognito recordings and open regular Settings when folder selection or permission is required.

## 1.13.3 — 2026-10-01

- Send recording announcements in Meet's embedded Google Chat composer as well as the legacy Meet chat.
- Add a content script limited to embedded Chat spaces; verify the Meet parent and target frame before communicating, wait for the editor to load, and preserve drafts and one-attempt sending.

## 1.13.2 — 2026-10-01

- Recognize recording sessions finalized by recovery and stop stale saves and heartbeats.
- Show one actionable interruption notification and offer Start recording for a new transcript instead of retrying the closed recording.
- Preserve finalized transcripts and stop logging this handled recovery condition as a Chrome extension error; unexpected storage failures remain logged.

## 1.13.1 — 2026-10-01

- Stop adding a routine recording-start notification to the Meet widget; preserve errors and other actionable messages.

## 1.13.0 — 2026-10-01

- Use an 820px shell on Calls, Settings and transcript pages, including the settings form.
- Show notifications and Settings icons on every page, with All calls immediately to their left on internal pages.
- Route internal-page activity, download messages and deletion results into the notification panel; retain activity and read status across navigation within the tab.
- Show and validate merge suggestions on internal pages, and open the merged transcript when the currently viewed call is merged.

## 1.12.1 — 2026-10-01

- Make bookmark notes and notifications mutually exclusive, preserving notes when switching panels.
- Add a top-right close control to the bookmark panel and replace explanatory labels with a prominent Bookmark saved status.
- Briefly fill and color the bookmark icon for 1.5 seconds after successfully saving a marker.

## 1.12.0 — 2026-10-01

- Add a bookmark icon to the Meet widget with optional private notes, automatic saving, and a five-second dismissal only before focusing or typing.
- Show highlighted bookmarks and editable author notes beside replies, with counts in call history and note text included in search.
- Preserve bookmarks through recording updates, recovery and merges; label author notes explicitly in copy, TXT downloads, selected sections and automatic backups.

## 1.11.2 — 2026-10-01

- Match the empty transcript message to the centered, dashed-border empty state in the call listing.
- Add right padding to All calls links on Settings and transcript pages for balanced hover backgrounds.

## 1.11.1 — 2026-10-01

- Align Calls, Settings and transcript page headings at the same top-left position, reserving scrollbar space across pages.
- Move All calls to the right of the Settings heading, aligned with the settings form edge.
- Promote the transcript title and recording details to the page header; keep actions and participants below, truncate long titles and preserve header height while renaming.

## 1.11.0 — 2026-10-01

- Keep the bulk action toolbar visible, with disabled actions when no calls are selected.
- Add Select all across all pages of the current search results, with a mixed checkbox state for partial selection and one-click clearing from checked or mixed states.

## 1.10.0 — 2026-10-01

- Add a notification bell beside Settings with an unread badge and a right-side activity panel.
- Keep copy, download, delete, merge, backup and error messages in the call page notification history instead of temporary toasts.
- Show deduplicated, expandable merge suggestions with recording details, selections and merge actions; retain original backups and block merges while recording.

## 1.9.1 — 2026-10-01

- Keep call details left-aligned beside the title on the same row.
- Reserve space for the hidden bulk action toolbar so selecting calls does not shift the cards.
- Replace the Settings button with an accessible gear icon without a background or border.

## 1.9.0 — 2026-10-01

- Center the empty call history message in a card with a dashed border.
- Compact call cards with inline, truncated titles and details on narrow windows.
- Move Settings above search and style it as a button; make search prominent and centered above the call list.
- Paginate search results and call history in pages of 20, with numbered pages and previous/next arrows.

## 1.8.0 — 2026-10-01

- Keep transcripts as separate rows with subtle indicators for certain and possible same-call relationships.
- Suggest related historical recordings using matching Meet rooms, nearby recording times, and shared participants or tab identity.
- Review historical suggestions in a compact panel with titles, times, durations, and preselected checkboxes before merging chosen recordings.
- Retain one-click merge for certain matches, preserve original backups, and validate suggestions again before saving.

## 1.7.0 — 2026-10-01

- Track a shared meeting identity across separate recordings within one Meet call.
- Subtly group related recordings in the transcript listing and merge them with one click, retaining original backup files.
- Disable related merges while recording, validate the full group before merging, and avoid guessing relationships from reused Meet URLs or older recordings without meeting identity.

## 1.6.2 — 2026-10-01

- Show a right-pointing Play icon on the green Start recording button.

## 1.6.1 — 2026-10-01

- Move the recording status dot to the recording button’s top-right corner, matching the notification badge’s 16px size and position with color only.

## 1.6.0 — 2026-10-01

- Replace Pause/Resume and the separate Stop control with one green Start / red Stop recording button.
- Finalize the transcript on Stop and create a separate history entry on each subsequent Start in the same Meet call, excluding speech between recordings.

- Add a Download diagnostics button to the Meet widget's notification panel, available even after startup failure.
- Keep the diagnostics button compact, move its explanation into a hover tooltip, and remove the empty-notifications placeholder.
- Add bottom spacing inside the notification panel when it expands downward.
- Export a local JSON report with extension/browser versions, recording state, control candidate counts, save health, and a bounded timeline of sanitized errors and state changes.
- Exclude transcript text, participant names, meeting titles/URLs, custom chat messages, raw DOM, and raw exception messages; diagnostics stay in tab memory and are downloaded only on request.

## 1.5.8 — 2026-09-30

- Index transcripts by call, tab, and recording status instead of loading the entire history for saves, single-call reads, and recovery.
- Migrate older transcripts without changing their call identities or backup metadata; report blocked database upgrades and close outdated connections.
- Make multi-segment merge, rename, and deletion atomic; reject stale bulk selections and malformed transcript snapshots.
- Advance backup versions when titles or call grouping change, and restore missing recovery alarms on worker startup.
- Coalesce caption saves while storage is slow and avoid accumulating redundant heartbeat snapshots.
- Show errors from deletion and merge preparation; keep bulk actions tied to the confirmed selection and use Echo's dialog for retained-backup warnings.
- Avoid rebuilding speaker sections for Select all, skip unnecessary caption/account-name reads and empty-query text searches.
- Remove the obsolete investigation script, unused menu code, and superseded CSS rules.

## 1.5.7 — 2026-09-30

- Replace the extension icon with an abstract radial soundwave in vivid coral orange.
- Simplify the smallest toolbar icon to keep its rays distinct at 16px.
- Enlarge the symbol within the 16px and 32px browser icons by reducing transparent margins.
- Keep toolbar PNG dimensions equal to their declared sizes so browser scaling does not shrink the symbol.

## 1.5.6 — 2026-09-30

- Close the notification panel when clicking outside the widget, preserving its messages.

## 1.5.5 — 2026-09-30

- Expand notifications below the widget near the top of the window, and above near the bottom.
- Use available window space before scrolling while preserving control positions and corner snapping.

## 1.5.4 — 2026-09-30

- Snap the widget to 20px from both edges when dragged near a window corner.
- Preserve distances from the nearest window edges across shrinking and expanding.
- Move the notification panel close button 6px to the right.

## 1.5.3 — 2026-09-30

- Remove hover and pressed effects from disabled controls.
- Close the notification panel without clearing messages; dismiss each message with its own X.
- Show the recording indicator as green after resume even while stale caption rows remain blocked.

## 1.5.2 — 2026-09-30

- Keep every widget control visible and disable unavailable actions to preserve positions.
- Pause only transcript capture, leaving Meet captions enabled.
- Enable captions when starting or resuming recording without ever turning them off.

## 1.5.1 — 2026-09-30

- Keep the notification button visible, including when all messages are dismissed.
- Expand notifications upward inside the widget’s shared surface without moving controls.
- Tighten and balance spacing around the recording indicator.

## 1.5.0 — 2026-09-30

- Keep notifications behind an on-demand button with a message count.
- Allow dismissing each message or all messages; hide the button when empty.
- Retain messages until read and dismissed instead of expiring unseen messages.
- Use compact message layouts and plain-language meeting error messages.

## 1.4.3 — 2026-09-30

- Place notification close buttons at the top right above full-width message text.

## 1.4.2 — 2026-09-30

- Tint notification backgrounds subtly by message type and remove their borders.

## 1.4.1 — 2026-09-30

- Combine diagnostics and notifications into one dismissible message stack.
- Keep dismissed active errors closed until the condition changes or recurs.
- Match message transparency and blur to the widget and remove its border.

## 1.4.0 — 2026-09-30

- Detect Meet controls and live captions independently of translated UI labels;
  support the observed Bulgarian interface.
- Keep the Echo widget visible when Meet controls are missing or startup fails.
- Show persistent diagnostic messages above the controls.
- Preserve chat drafts and reject ambiguous DOM controls.

## 1.3.1

Existing version before the interface detection and diagnostics changes.
