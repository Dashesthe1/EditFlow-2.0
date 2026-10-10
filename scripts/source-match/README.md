# EditFlow Source Match Service

This is the sole footage analyzer for the scoped Practice process. The Supervisor first delivers ChatGPT a coordination-only instruction. The service detects Finished shot boundaries, searches the raw movies, verifies temporal/spatial correspondence and saves exact source timestamps. ChatGPT never reviews footage, selects ranges or supplies shot acceptance.

Install with install.ps1 (CUDA by default). Runtime/model checksum and CUDA smoke inference must pass before source-match-config.json is published. Match jobs are bounded to one GPU process and a 480-second workflow budget. Input media and exact original integer PTS are retained.

Only a COMPLETE report with every shot VERIFIED, complete measured endpoint ranges, competing-location review and continuous Finished coverage can produce official-timestamps.json. No inferred hidden trims or partial assembly is allowed. Automatic shot detection is advisory and combines color histograms with measured spatial/feature continuity; unobservable or ambiguous footage remains unresolved.

The assembly service saves the official receipt first, extracts ProRes working clips at original speed, verifies the original identities and prepared clips, then supplies only comp creation, raw media import, layer creation and contiguous timing operations in Finished order. The Practice controller persists native AE transaction receipts and an AEP checkpoint, then ends the session. It cannot accept a caller-provided editing plan or launch a broader editing workflow.

Validation: python -m pytest scripts/source-match; npm run check. Tests cover crop/geometry, independent temporal/gradient evidence, ambiguous/unobservable endpoints, variable frame rates, exact frame extraction, source/clip tampering and complete range gating.
