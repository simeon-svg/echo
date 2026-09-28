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
