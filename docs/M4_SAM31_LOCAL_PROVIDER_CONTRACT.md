# M4 Local SAM 3.1 Segmentation Provider

Status: **STRUCTURAL FOUNDATION / NOT RUNTIME PROMOTED**
Provider ID: `sam3.1.local`
Sidecar schema: `editflow.segmentation.sam3.1.v1`

## Purpose

Provide a concrete local implementation of `SubjectSegmentationProviderV1` without weakening the provider-neutral M4 segmentation contract. This tranche establishes bounded process execution, exact source binding, exact SAM 3.1 checkpoint selection, fail-closed output validation, and retained artifact integrity. It does not yet claim accepted live SAM 3.1 inference or After Effects materialization/application.

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

The current development workstation has Python 3.12, CUDA, BF16 support, and an NVIDIA RTX A4500. The selected Python environment does not currently have the `sam3` package installed and Hugging Face checkpoint access is not authenticated, so live inference is not accepted yet.

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

Deterministic adapter tests prove:

- one fixed shell-free sidecar invocation;
- exact request/source correlation;
- pre-launch refusal of unsupported point/prior-artifact prompts;
- exact source provenance requirement;
- artifact-directory containment;
- byte-level SHA-256 verification;
- timeout/process/malformed-output/provider-mismatch refusal;
- source inspection showing explicit SAM 3.1 checkpoint selection and no implicit SAM 3.0 download path.

A real Node-to-Python preflight also reaches the expected `CHECKPOINT_ACCESS_REQUIRED` refusal without downloading a model or mutating After Effects.

These checks are structural/provider evidence only. They do **not** promote the public M4 segmentation capability beyond `DECLARED`, and they do not register this provider into production runtime yet.

## Promotion gate

Runtime promotion requires retained live evidence that:

1. the intended SAM 3.1 code and checkpoint load on the target workstation;
2. real source pixels produce a retained segmentation mask;
3. the result passes exact request/result correlation and provenance checks;
4. the materialized PNG bytes match the accepted digest;
5. a second materially different subject/source can be segmented without hidden state carryover;
6. no After Effects project mutation occurs during this read-only provider proof.

After provider promotion, the separate M4 materialization/application tranche must still prove exact raster import/alignment, matte binding, readback, rollback, and viewer-visible After Effects output.
