# Incognito windows

Echo uses `incognito: "split"` so packaged pages can open inside incognito tabs.
The toolbar and Meet History pass the originating tab's window ID to `tabs.create`.
Chrome still requires the user to enable Allow in incognito.

The user requested durable, shared history. Split incognito's web storage is
temporary, so the incognito worker never writes conversations to its own
IndexedDB. The regular worker remains the owner of the existing database,
backup handles and serialized mutation queue. There is no database migration.

`background/incognito.js` relays history commands through `chrome.storage.local`,
which Chrome shares across split contexts. Each request has a UUID and a
pending/processing/complete state. A storage event wakes the regular worker.
Only the incognito worker constructs relayed sender metadata, after checking
the real runtime sender. The regular worker validates it again and applies the
existing Meet tab/token guards and page operations. Caption saves, title edits,
bookmarks, merges and deletion all enter the same queue.

Replies preserve error codes, including `SESSION_FINALIZED`. Transient mailbox
entries are removed after a reply; expired entries are removed on startup and
the recovery alarm. A processing entry left by a worker restart receives an
uncertain-result error rather than replaying a potentially completed action.
Requests time out after two minutes and are not automatically replayed.

Incognito tab closure, navigation and discard are forwarded to the regular
worker. Persisted sessions record their incognito origin. Regular browser
startup does not finalize live incognito sessions; the regular heartbeat
recovery alarm still handles missing clients in either context.

Automatic backups run in the regular worker with the existing folder. Directory
handles cannot be serialized into Chrome's JSON storage transport. Incognito
Settings therefore opens regular Settings for folder selection and permission.
Incognito backup deletion uses already-granted shared permission; otherwise it
opens regular Settings and leaves the action available for retry.

Lifecycle tests run the actual worker and relay in separate VM contexts with
shared storage events and an isolated temporary incognito database. They verify
shared listing, durability after closing/reopening incognito, close/navigation
finalization, concurrent rename/save and bookmark preservation, deletion, terminal
errors, sender rejection, expiration and interrupted-operation handling.
This verifies application logic; a live Chrome incognito check is separate.

Chrome references:

- [Split and spanning modes](https://developer.chrome.com/docs/extensions/reference/manifest/incognito)
- [Extension storage events and persistence](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [IndexedDB private-mode lifetime](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
