# Initial Implementation Blueprint

This document chooses a concrete starting implementation for the clean-room rebuild. Decisions that prove unsuitable may change through ADRs; none are inherited from the old EditFlow codebase.

## 1. Repository shape

Use a TypeScript-first monorepo with strict package boundaries.

Planned top-level layout:

```text
apps/
  mcp-server/             ChatGPT-facing MCP control plane
  desktop-host/           local orchestration/diagnostics service
packages/
  core-contracts/
  capability-registry/
  ae-object-model/
  planner/
  executor/
  scene-graph/
  recipe-graph/
  memory/
  visual-proof/
  orchestrator/
  adapters/
    ae-cep/
    tracking/
    roto/
    mocha/
    ui-fallback/
proofs/
  fixtures/
  manifests/
spec/
docs/
```

TypeScript is the control-plane language because the system is schema-heavy, MCP-facing, JSON-native, and benefits from one strict type model across planner/executor/registry boundaries.

## 2. Contracts and validation

- JSON Schema in `spec/` is the durable interchange contract.
- Generated TypeScript types are derived from schemas where practical; generated types are not the source of truth.
- Runtime validation occurs at every process/adapter boundary.
- Unknown fields are rejected for mutation commands unless a schema explicitly allows extension data.
- IDs are opaque stable strings; code never assumes AE layer indices are durable identities.

## 3. Process boundary

The system is split into:

### MCP server

Exposes compact semantic tools to ChatGPT. It never contains Adobe-specific write logic.

### Desktop host

Owns:

- project sessions;
- capability/environment discovery;
- planner/executor lifecycle;
- proof artifact storage;
- local adapter connections;
- recovery diagnostics.

### AE-side adapter

A dedicated After Effects integration performs typed host operations. The initial route is a dedicated CEP/ExtendScript adapter because it can bridge a local panel/runtime to the AE scripting object model while keeping executable behavior owned by audited adapter code.

ChatGPT never submits arbitrary JSX. The adapter exposes fixed typed commands; any ExtendScript used is shipped/versioned with the adapter and only receives validated data parameters.

### Guarded UI agent

A separate Windows-side adapter is reserved for functions with no sufficient scripting/object-model route. It is capability-scoped, visually guarded, and cannot accept arbitrary mouse/keyboard scripts from ChatGPT.

## 4. AE adapter design

The AE adapter protocol is versioned and request/response based.

Every mutation request contains:

- transaction ID;
- operation ID;
- capability ID;
- expected project revision/fingerprint;
- typed payload;
- expected readback profile.

Every response contains:

- operation outcome (`APPLIED`, `NO_OP`, `REJECTED`, `FAILED`);
- host error category/details;
- affected stable IDs;
- structural readback;
- new project revision/fingerprint;
- adapter diagnostics;
- optional proof artifact references.

The adapter is intentionally lower-level than recipes but higher-level than raw string scripts.

## 5. Stable identity

Never treat AE layer indices/names as global identity.

Initial strategy:

- assign EditFlow UUIDs to tracked project objects;
- persist mappings in EditFlow session metadata and, where safe, mirrored AE metadata/comment fields for recovery;
- map identity using a tuple of host object ID where available, parent identity, object kind, durable metadata marker, and structural evidence;
- revalidate mappings on every transaction;
- surface ambiguity instead of guessing.

A dedicated ADR and proof suite must validate recovery after reorder, rename, precompose, duplicate, save/reopen, and reconnect.

## 6. Project fingerprinting

Fingerprints are hierarchical, not one giant opaque hash only.

- project fingerprint;
- composition fingerprints;
- affected object fingerprints;
- environment fingerprint.

This allows safe rejection of relevant drift without forcing a full reanalysis for unrelated changes.

## 7. Persistence

Initial local persistence uses SQLite for structured state/provenance plus filesystem/object storage for larger proof media.

Persist:

- sessions and project mappings;
- capability registry snapshots;
- recipe versions and provenance;
- Scene Graph metadata/references;
- transaction ledgers;
- proof manifests;
- Learning/Training/Experience Memory indexes.

Large source media is referenced, not duplicated by default.

## 8. Scene-intelligence boundary

Scene intelligence is provider-agnostic. The core consumes typed detections/tracks/segmentations with provenance and confidence. It must be possible to combine:

- model vision observations;
- local CV/segmentation/tracking providers;
- AE tracker outputs;
- Mocha/Roto outputs;
- user corrections.

No one model provider is hard-wired into recipe semantics.

## 9. Adapter SDK

Every adapter implements:

- identity/version/capabilities;
- environment probe;
- input/output schemas;
- preflight;
- execute;
- readback;
- cancel/progress where meaningful;
- rollback/compensation hooks;
- proof-evidence hooks;
- declared limitations.

The capability registry composes adapter declarations with live environment discovery.

## 10. UI fallback boundary

UI fallback is its own adapter process with explicit capability modules. It may expose operations such as `mocha.track_plane` or `roto_brush.add_foreground_stroke`; it may not expose `click(x,y)` or arbitrary keystroke sequences to the MCP surface.

Internally, a capability module may use Windows UI Automation, accessibility metadata, image anchoring, and bounded click/drag/type actions. Before every destructive/interactive step it verifies expected application/window/panel context.

## 11. Proof architecture

Proofs are executable scenarios, not prose logs.

Each scenario has:

- environment prerequisites;
- fixture project/media;
- capability/recipe under test;
- execution plan or plan generator;
- structural assertions;
- visual checkpoint profile;
- failure injection;
- cleanup/rollback assertions;
- transfer variant.

A proof run writes a manifest tied to git commit and environment fingerprint.

## 12. CI strategy

Repository CI will initially run:

- formatting/lint/type checks;
- JSON Schema validation;
- contract fixtures;
- planner deterministic compilation tests;
- capability-resolution tests;
- executor transaction simulations;
- adapter protocol tests with fake host;
- restart/idempotency tests.

Real-AE proofs run on the Windows workstation/self-hosted acceptance environment and remain mandatory before host-capability release gates.

## 13. Security model

- localhost connections authenticate per session;
- MCP cannot invoke arbitrary OS commands/scripts;
- adapters accept only registered capability operations;
- filesystem access is allowlisted to project/media/proof locations required by a declared operation;
- secrets/licensing data are never written into proof artifacts;
- destructive operations require an explicit recovery strategy and higher risk classification.

## 14. Implementation sequence inside Milestones 1–3

1. create schemas/types package and fixture validation;
2. create capability registry with static taxonomy + live adapter merge;
3. implement project/environment fingerprints;
4. implement immutable execution-plan validator/compiler shell;
5. implement transaction ledger + simulated executor;
6. implement MCP session/state diagnostics only;
7. create new AE CEP adapter handshake and read-only project inspection;
8. prove save/reconnect/stable-ID behavior;
9. add baseline writes with readback;
10. add masks/mattes/parenting/Graph Editor parity primitives;
11. run real-AE proof ladder before adding tracking/roto.

This sequencing deliberately builds reliable manipulation vocabulary before higher-level creative intelligence.
