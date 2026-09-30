# Changelog

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
