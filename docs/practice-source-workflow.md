# Practice: Source Match, then raw assembly

1. Preserve the user's Finished edit, raw video/audio selections and Edit Type.
2. Supervisor opens one fresh ChatGPT session and verifies delivery of its scoped instructions. No media work starts before this receipt.
3. EditFlow Source Match Service alone detects Finished shots, searches the raw movies and saves measured exact source timestamps with retained machine evidence. ChatGPT coordinates status only. No image-review packets or editorial acceptance are requested from ChatGPT.
4. Require a COMPLETE report, every shot VERIFIED, measured full endpoints, competing-location checks and continuous Finished coverage. Save official-timestamps.json before extracting any clips. Ambiguous identity, hidden/unobservable endpoints, incomplete results or changed sources block all AE import.
5. Extract the saved raw ranges to ProRes working clips at original speed, preserving originals. Import and place each shot contiguously in Finished order using bounded native AE transactions. Persist each transaction receipt. An interrupted in-flight AE batch blocks replay.
6. Save raw-assembly.aep and its native transaction receipt. Mark Practice complete and stop. No follow-on editing, effects, retiming, rendering, research, learning or mastery starts.

Pro Creation saves an empty UI session. All existing file input/drop, Edit Type selection/creation, start/status and cancel controls remain. Audio selections are retained but have no processing step in this workflow.

The source matching budget is 480 seconds. Detection and exact endpoint recovery are not universal guarantees. Unresolved results remain saved and visible as BLOCKED, with no guessed ranges and no partial AE assembly. Cancel stops future matching/extraction/AE batches; a native transaction already in progress completes its controlled transaction boundary.

MCP: run_practice_source_match(session_id) is an idempotent status/coordinator call. It cannot bypass the Supervisor receipt or accept caller-chosen paths/ranges/plans. get_editflow_run reports status and saved artifacts. The local Supervisor only delivers the initial instructions; it has no editing or footage-analysis authority.
