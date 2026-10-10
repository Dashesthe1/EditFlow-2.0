# Practice source process validation — October 10, 2026

The scoped process was exercised on the deployed Shadow runtime with the existing AE process (PID 16628), the actual browser Supervisor, CUDA SSCD matching, actual range extraction and native AE transactions.

A synthetic 320x240, 12fps raw movie contained two distinct scenes. The Finished edit used source 7–9 seconds first, then source 2–4 seconds. No shot boundaries, source ranges, original timeline export or ChatGPT footage review were supplied to Practice. Source Match automatically detected the two shots, returned COMPLETE with both full ranges VERIFIED, and saved the exact timestamps. The Supervisor's verified first-chat delivery preceded the match job. Official timestamps were saved before extraction/import.

The native AE batch committed seven operations. Independent native project inspection confirmed two layers in Finished order at 0–2 and 2–4 seconds, 100% stretch, a 4-second 12fps composition, and the exact two prepared raw source files. The AEP checkpoint existed and its native transaction committed. Practice reached COMPLETED, then no further process started. A separate unresolved test reached BLOCKED and performed no AE import. Pro Creation retained an empty session. The pre-test AE project was restored in the same process.

Repository checks: schema fixtures, TypeScript and 765 Node tests pass. All 60 Python matching/extraction tests pass and cover measured frame geometry, invisible/ambiguous endpoints, source identity, original PTS, exact extraction, variable frame rates and equal-color shot cuts. A real matching-process cancellation check confirmed CANCELLED and no active child worker.

This is a known-frame functional validation, not a claim that arbitrary movie edits always yield exact recoverable endpoints or that long movies meet a performance target. Unresolved results remain blocked with no partial AE assembly.
