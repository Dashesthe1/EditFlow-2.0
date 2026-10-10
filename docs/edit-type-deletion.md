# Delete an Edit Type

Select an Edit Type and choose **Delete** next to **+ New**, or press the keyboard
Delete key while the preset selector has focus. Both use the same two-step dialog:

1. **Delete “[preset]”?** Choose Yes to review the deletion, or No to leave it intact.
2. **REALLY delete “[preset]”?** Read the consequences and attached session count.
   Choose Yes to permanently delete, or No to leave everything intact.

No receives focus in both dialogs. Escape cancels, including while the preview is
loading. A held or modified Delete key and Delete inside text fields do not start
deletion. Deletion requires the local runtime connection and no active session;
cancel an active session before deleting a preset.

The final Yes removes the entire stored preset, including embedded memories,
learned examples, evidence and attachment records. It removes its entries from the
optional memory store, UI session/control history and in-memory workflow records.
It also deletes the preset's app-owned matching reports, timestamp manifests,
request receipts, generated shot files, workflow receipts and AE checkpoint copies.
The panel clears its cached/pending preset and stored selection after success.

Original Finished/raw media and other presets are preserved. The open AE project
is not edited; layers referencing deleted generated shot files can show missing
footage, as disclosed in the final confirmation. Shared Source Match descriptor
indexes are general media indexes, not preset learning or session records.
No external attachment/evidence path is followed as a deletion target.

The backend binds a short-lived confirmation to the selected preset and current
registry, memory and session state. An active session, changed state, missing or
replayed confirmation, or conflicting artifact ownership rejects deletion. All
artifact ownership is validated before data is removed. Once confirmed, a small
deletion intent containing only the target ID permits an interrupted purge to finish
on runtime restart; no restorable learning backup is made. Starting a session with
a stale deleted ID cannot silently recreate it. A user may explicitly create a new,
empty preset with the same name later.

Validation uses isolated temporary presets and artifacts; no existing user preset
is deleted. Tests cover both No buttons, both Yes buttons, Delete/Escape behavior,
stale cache replies, authentication, invalid/replayed confirmations, changed data,
active-session blocking, ownership conflicts, preservation of other presets and
original files, complete artifact cleanup, and restart completion.
