# M4 Local SAM 3.1 Segmentation Provider

Status: **LIVE TEMPORAL RUNTIME PROMOTED / DIGEST-BOUND TRANSFER EVIDENCE**
Provider ID: `sam3.1.local`
Sidecar schema: `editflow.segmentation.sam3.1.v1`

## Purpose

Provide concrete local SAM 3.1 image and temporal segmentation surfaces without weakening the provider-neutral M4 contract. The image-only provider remains a separate bounded path; the temporal sequence provider is now live-promoted from retained two-source checkpoint-backed evidence and can feed the already transfer-proven sequence-matte materialization planner. The live promotion proof itself remains read-only and does not mutate After Effects.

## Exact model-family rule

The provider is named `sam3.1.local`, so it must never silently execute SAM 3.0. When no explicit local checkpoint path is configured, the Python sidecar resolves the checkpoint through `download_ckpt_from_hf(version="sam3.1")`. The image model is then constructed with that resolved checkpoint and `load_from_HF=False`.

A missing Hugging Face authorization/token is a refusal condition. The provider does not silently fall back to another model family or an unverified checkpoint.

## Process boundary

The TypeScript adapter launches one fixed Python sidecar with:

- `shell: false`;
- a fixed executable path supplied by configuration;
- a fixed sidecar script path supplied by configuration;
- one JSON request passed as data;
- a bounded timeout;
- bounded stdout/stderr capture.

The sidecar may not choose arbitrary executables or shell commands from request content.

## Source binding

Every request must already contain exact `requestId`, `sourceId`, `timestampMs`, and `semanticId` values accepted by the core segmentation validator.

The configured source resolver must return the same `sourceId`, an absolute local path, and at least one retained evidence ID. The adapter refuses mismatched identity or missing provenance before launching inference.

## Supported prompt surface

This provider tranche supports:

- exact `entityClass` text prompts;
- normalized `[x, y, width, height]` box prompts;
- explicit preferred output encoding (`BINARY`, `ALPHA`, or `PROBABILITY`).

This provider tranche explicitly refuses:

- positive/negative point prompts;
- `previousArtifactId` temporal refinement.

The core interface remains capable of expressing those prompts, but the local image-only SAM 3.1 implementation does not claim support until they are genuinely consumed by a proven runtime path.

## Local runtime requirements

The Python sidecar requires:

- Python 3.12-compatible SAM 3 code;
- a CUDA-capable GPU;
- CUDA BF16 support;
- an explicit local SAM 3.1 checkpoint or authenticated access to the gated `facebook/sam3.1` checkpoint.

The current development workstation has the SAM 3 runtime, CUDA/BF16 support on the NVIDIA RTX A4500, and an explicitly authorized local `facebook/sam3.1` multiplex checkpoint. The retained promotion evidence binds that checkpoint to SHA-256 `0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6`; live temporal inference is therefore no longer blocked by checkpoint access.

The temporal sidecar is pinned to the current upstream multiplex builder contract: an explicit checkpoint is passed only as `checkpoint_path`, while `use_fa3` is forced to `False` on the target workstation because the RTX A4500 runtime has no `flash_attn_interface`. The upstream high-level builder already suppresses Hugging Face download when an explicit checkpoint is present; the sidecar therefore does not pass the unsupported `download_from_hf` keyword. When no explicit checkpoint is configured, Hugging Face authorization is checked before importing SAM/Torch or constructing a model, so a missing credential fails cheaply with `CHECKPOINT_ACCESS_REQUIRED`.

## Artifact integrity

A successful sidecar result must return an absolute materialized artifact path and a segmentation result accepted by `acceptSubjectSegmentationResultV1`.

Before the artifact becomes resolvable downstream, the TypeScript adapter verifies that:

1. the path is inside the configured artifact directory;
2. the path exists and is a file;
3. the accepted result contains a lowercase SHA-256 digest;
4. the digest recomputed from the materialized bytes matches exactly.

Only then is the artifact added to the provider's verified-artifact map. `resolveArtifact(artifactId)` returns only these verified local artifacts.

## Quality/provenance semantics

The provider records exact model/checkpoint/source provenance. Single-frame image inference currently reports `temporalConsistency: 0` with evidence marking temporal refinement unavailable rather than presenting a post-hoc mask comparison as model refinement.

`edgeQuality` is an image-gradient/boundary alignment diagnostic. `occlusion` is currently a bounded presence-score proxy. These remain provider diagnostics and must not be interpreted as stronger semantic guarantees than their evidence IDs state.

## Current proof status

The temporal provider has retained live acceptance evidence on the target workstation. `scripts/proofs/m4-sam31-live-transfer-proof.mjs` completed against two materially different real-video fixtures with the explicit SAM 3.1 checkpoint and no hidden fallback.

The accepted path is semantic initialization followed by point-based target disambiguation and native full video-grounding propagation. Fresh point-only temporal seeding is deliberately refused because the multiplex partial-refinement path did not produce reliable temporal material in validation.

Retained evidence:

- `proofs/diagnostics/m4-sam31-live-transfer-proof.json`;
- `proofs/diagnostics/m4-segmentation-runtime-evidence-live.json`;
- `proofs/diagnostics/m4-segmentation-runtime-evidence-live.json.sha256`.

Both retained fixtures contain six material mask frames, material coverage on both sides of the prompt frame, and six distinct per-frame mask digests. The strict retained-file loader accepts the real evidence bytes at SHA-256 `c403b2d9f45f198eb1747c1250f0569b527bf70e08401d018967d17d33d74ecc`, and a real runtime-registration check projects both segmentation acceptance and sequence-matte planning as `FULL / TRANSFER / R0_READ_ONLY`.

Deterministic regression coverage also rejects the original false-positive shape in which only the prompt frame is material while temporal neighbors are blank. The live proof itself has no After Effects control dependency and issues no project mutation.

## Promotion gate

The retained live promotion gate is now satisfied for the temporal SAM 3.1 route. Acceptance requires all of the following:

1. the intended SAM 3.1 code and explicit checkpoint load on the target workstation;
2. real source pixels produce retained temporal masks;
3. exact request/result correlation and provenance checks pass;
4. every materialized PNG matches its accepted lowercase SHA-256 digest;
5. at least two materially different sources produce materially different verified sequences without hidden session carryover;
6. temporal material exists on both sides of an interior prompt frame when those sides are requested;
7. no After Effects project mutation occurs during the read-only provider proof.

### Live proof harness

`scripts/proofs/m4-sam31-live-transfer-proof.mjs` is the retained promotion harness. It requires an already-authorized explicit local SAM 3.1 checkpoint plus at least two distinct absolute source-video files; it never accepts model terms or authorizes an account on the operator's behalf. It does not download or authorize a checkpoint on the operator's behalf.

Each fixture must provide semantic initialization through `entityClass` or a normalized bounding box. Positive/negative points may disambiguate the semantic candidates, but point-only fresh temporal seeding is refused. The sidecar then runs the bounded native multiplex video-session path and retains exact frame-correlated PNG artifacts.

The harness independently re-hashes checkpoint, source, and output bytes, requires native SAM 3.1/checkpoint/temporal provenance, rejects duplicate source bytes and identical verified mask sequences across sources, and fails closed with `TEMPORAL_MATERIAL_MISSING` when an interior prompt has no material temporal result before or after it.

Only after every gate succeeds does the harness write the detailed live proof, the exact `editflow.m4.segmentation-runtime-evidence.v1` file, and its SHA-256 sidecar. The retained runtime evidence now includes `temporalMaterialAccepted: true` in addition to the original live-inference, correlation, per-frame integrity, transfer, and no-hidden-fallback gates.

## Guarded production registration

The desktop host remains fail-closed by default. A normal session registers neither the provider-neutral subject/object acceptance route nor the temporal sequence-matte materialization route unless it is supplied a retained evidence file and matching lowercase SHA-256 sidecar.

The exact evidence schema requires the `sam3.1.local` provider ID, temporal sidecar schema, model family `sam3.1`, lowercase checkpoint/result digests, at least two source fixtures, and all six acceptance booleans: live inference, exact correlation, per-frame SHA-256 integrity, materially different transfer, no hidden fallback, and temporal material. Extra fields, missing fields, malformed JSON, missing files, digest mismatch, provider/schema drift, uppercase hashes, or any false acceptance field leave both runtime capabilities unregistered.

Successful loads produce a process-issued trusted attestation tracked through a private runtime `WeakSet`; structurally similar caller-created objects are not trusted. The actual retained workstation evidence has been loaded through this path and registers `tracking.segmentation.subject_object.accept` plus `tracking.segmentation.sequence_matte_materialize.plan` as `FULL / TRANSFER / R0_READ_ONLY`. This is digest-bound retained-evidence validation, not external digital-signature authentication.

## Temporal sequence tranche

The additive temporal surface implements `SubjectSegmentationSequenceProviderV1` with sidecar schema `editflow.segmentation.sam3.1.sequence.v1`. It does not replace the image-only provider.

The promoted temporal adapter:

- binds exact `requestId`, `sourceId`, `semanticId`, `startFrameIndex`, `startTimestampMs`, frame rate, frame count, and prompt-frame index;
- requires semantic text or a normalized box as the fresh temporal seed;
- permits positive/negative points as exact candidate-binding cues while refusing point-only fresh temporal seeding and unimplemented `previousArtifactId` refinement;
- launches through the same shell-free bounded process boundary and requires exact source provenance before inference;
- uses the current SAM 3.1 multiplex video-session path with bounded frame-window materialization, semantic `add_prompt`, native full video-grounding propagation, and `close_session`;
- refuses ambiguous multi-object output when exact subject identity cannot be resolved;
- requires complete requested frame coverage and treats an empty target-ID mask as absent rather than material;
- writes one contiguous numbered PNG sequence, retains per-frame SHA-256 evidence, and re-hashes every returned file in TypeScript before making the sequence resolvable;
- rejects path escape, duplicate artifact paths, byte drift, provider mismatch, malformed output, start-frame correlation drift, and prompt-only/blank temporal propagation.

The runtime preserves the selected semantic object ID across propagation. A temporarily absent target is represented as a zero mask with explicit zero-confidence/occlusion evidence rather than silently rebinding to another instance. Sequence timing remains source-frame exact; local output frame `0` always corresponds to the declared absolute `startFrameIndex`.

The protocol-2.5 sequence-matte planner/materialization surface was already `FULL / TRANSFER` from deterministic real-AE proofs. With the retained live SAM 3.1 evidence now accepted by the strict runtime loader, the live temporal segmentation acceptance route is also `FULL / TRANSFER` for sessions configured with that retained evidence. The live promotion harness itself remains read-only and does not mutate the user's After Effects project.

## Downstream live SAM 3.1 → After Effects acceptance

The provider-promotion harness described above remains intentionally read-only. A separate bounded downstream proof now consumes its retained checkpoint-backed `sam3.1.local` configuration and executes the accepted temporal sequence through the sequence-matte planner and native After Effects surfaces.

`M4_SAM31_LIVE_SEQUENCE_MATTE_E2E_REAL_AE` produced six material 1080×1080 masks at 59.94 fps, imported them through protocol 2.5 as a native temporal image sequence, applied exact transform/timing plus a LUMA track matte, and read the sequence/matte/composite state back exactly. Three source-frame visual checkpoints passed and produced three distinct review-frame SHA-256 values.

The proof reused the already-running AE process, removed only proof-owned objects, and restored project item count, Render Queue count, and project-file identity. A follow-on P5 lifecycle rerun accepted save/reopen plus a distinct authenticated CEP reconnect, a fresh post-reconnect matte mutation, visual stability, and exact restoration of the saved user-project baseline.

This closes the live-provider-to-AE dynamic materialization evidence gap without changing the public capability boundary: digest-bound runtime registration exposes the accepted segmentation route and temporal planner as `FULL / TRANSFER / R0_READ_ONLY`; unrestricted production write dispatch remains outside this acceptance.

Retained downstream evidence:

- `proofs/diagnostics/m4-sam31-live-sequence-matte-e2e-live-acceptance.json`;
- `proofs/manifests/m4-sam31-live-sequence-matte-e2e-real-ae.request.json`;
- `M4_SEGMENTATION_SEQUENCE_MATTE_MATERIALIZATION_CONTRACT.md`.
