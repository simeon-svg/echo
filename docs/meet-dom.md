# Live investigation — September 24, 2026

Inspected an actual active Google Meet in Chrome using DevTools. English UI.

- Visible `button[aria-label="Leave call"]` identifies the active call controls.
- The caption control changes from `Turn on captions` to `Turn off captions`.
- Caption region: `[role="region"][aria-label="Captions"]`.
- Speaker row: `.nMcdL` within that region.
- Speaker text: `.NWpY1d` within the row. The local speaker is displayed as `You`.
- Caption text: `.ygicle` within the row.
- The same row was observed changing from `Okay. Do I speak? Sounds good.
  Perfect! I'm.` to `Okay. Do I speak? Sounds good. Perfect! I'm talking.`
  332 ms later. Punctuation on the last word can change during expansion.

These are observed selectors, not an API contract. No voice recognition is done
by this extension. Additional speakers and long rolling captions need further
live validation; synthetic parser tests cover those scenarios independently.

## Bulgarian DOM investigation — September 30, 2026

Captured from an active call with `hl=bg`. Control labels are translated, while
these technical markers were present:

| Element | Technical markers |
| --- | --- |
| Leave call | `button[jsname="CQylAd"]`, `call_end` icon |
| Captions toggle, enabled | `button[jsname="RrG0hf"]`, `closed_caption` icon |
| Caption region | `[role="region"][jscontroller="KPn5nb"]` |
| Open chat | `button[data-panel-id="2"]`, `chat` / `chat_bubble` icons |
| Chat textarea | `textarea[jsname="YPqjbf"]` |
| Send message | `button[jsname="SoqoBf"]`, `send` icon |

Icon identifiers are text inside `.google-symbols.notranslate`. Caption row,
speaker, and text classes match the English investigation. The local speaker is
displayed as `Вие`. A reduced capture is saved in `tests/fixtures/meet-bg.json`;
chat identifiers were read separately through DevTools without sending messages.

`content/meet-adapter.js` owns these details. Detection requires a unique visible
candidate and never chooses between ambiguous controls. English labels remain
a fallback for older DOMs. Modern caption state is inferred from the visible
caption region; live confirmation of region disappearance when switching
captions off is still pending. Auto-start, Pause/Resume, new segments, translated
labels, missing labels, ambiguity, and chat draft protection are covered by tests.

This investigation verifies the enabled state and caption structure, not a full
end-to-end run of the updated extension. The Mac locked before the live toggle
and recording checks. Other locales' local-speaker aliases and account-name
resolution remain unverified.

## Embedded Google Chat capture — October 1, 2026

User-provided saved HTML shows the Chat panel hosting an iframe from
`https://chat.google.com/u/<account>/embed/space/<space>?origin=https://meet.google.com`.
The composer is `[contenteditable="true"][role="textbox"][jsname="yrriRe"]`;
Send is `button[jsname="GBTyxb"]`. The existing top-frame textarea selectors
cannot reach this cross-origin document and also do not match its editor.

`content/chat-bridge.js` connects the Meet announcement to a content script
restricted to embedded Chat space URLs. Both sides check message origins and
window identity; the helper requires the Meet embed origin. Readiness probes
can repeat while the editor loads, but a send request is never retried. The
iframe uses the same draft, cancellation and confirmation checks as legacy
chat. The rich-text editor uses native insertion to update the composer state.

Regression tests cover the sanitized captured structure, communication between
two frame contexts, delayed readiness, drafts, cancellation and sender checks.
The saved HTML establishes the DOM and origin mismatch; a live Google Chat
delivery after this change still needs confirmation in an actual meeting.
