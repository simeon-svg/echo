# Meet variants and Echo diagnostics

Checked September 30, 2026 against Google's documentation.

- Google has updated the web meeting controls using Material 3. The documented
  rollout includes both Workspace customers and personal accounts; Workspace
  does not by itself prove the presence of a separate incompatible web UI.
  [Updated meeting controls](https://workspaceupdates.googleblog.com/2024/06/updated-design-for-meeting-controls-google-meet.html)
- Companion mode has a different feature set: microphone and meeting audio are
  disabled on that device, and some controls differ. Captions are among the
  features Google documents for Companion mode. Echo has not been tested in it.
  [Companion mode](https://support.google.com/meet/answer/11295507?co=GENIE.Platform%3DDesktop&hl=en)
- Feature availability differs by Workspace edition, including translated
  captions. Ordinary live captions and translated captions are distinct.
  [Workspace feature comparison](https://knowledge.workspace.google.com/admin/meet/compare-meet-features-across-google-workspace-editions)
- Meet calling and meetings have different experiences. An extension using the
  web meeting DOM does not automatically support every calling or mobile UI.
  [Calling transition](https://support.google.com/meet/answer/15226792?hl=en)

The reported failure in a client's Workspace meeting has not been reproduced.
Possible causes include a different DOM, a different Chrome profile, restricted
site access, an organization extension policy, an embedded frame, or stale tab
scripts after updating the extension. These are hypotheses, not a diagnosis.
Echo's manifest currently injects into top-level `https://meet.google.com/*`
pages; embedded frames are not explicitly enabled.

Echo 1.4.0 creates its overlay before loading settings or detecting a meeting.
Missing controls, scan exceptions, startup exceptions, unavailable captions,
chat notice failures, and save errors appear in the shared dismissible message
panel above it, opened only by clicking the notification button. Messages persist
until dismissed or resolved; repeated scans of
the same dismissed condition do not reopen them. A changed or recurring
condition produces a new message.
Successful subsequent detection clears recovered errors. Recording still requires unambiguous controls
and readable live captions; showing the widget is not proof of recording.

If the widget is entirely absent, the page script may never have been injected.
Check Echo's Chrome profile, enabled state, site access, and the actual page
address. Open an embedded meeting in its own Meet tab and reload Echo plus the
tab after an update. No widget can report an error from code Chrome did not run.

For the next failing meeting, record the installed version from `chrome://extensions` and the exact
widget diagnostic message, the page host, whether it is in a frame or a separate tab,
and the meeting mode. A screenshot and a minimal DOM capture of the failing
control can then establish which selector or startup boundary needs repair.
