# M6 Professional Effects & Transitions Intelligence Contract

Status: **implementation foundation and live-AE correction infrastructure are complete; the active v10 analyzer has invalidated the prior v6 shutter certification, the strongest current UNKNOWN compound render reaches 5/7 defining coverage at 0.9846 weighted fidelity, and transfer/benchmark/system-integration gates remain open**

Authority: `EditFlow_2.0_M6_Professional_Effects_Transitions_Roadmap_No_Hours.pdf`

Baseline: `m5-tutorial-002-stabilization-orchestration-v1` at
`1e0d7c7621f7b52dc26bd85b56cdb35150359958`.

## North-star rule

An effect is correct only when rendered visual behavior demonstrates the defining
characteristics of the professional reference. A successful AE transaction, a valid
recipe, or a visually decorative substitute is not fidelity evidence.

## Preserved authority

M6 is additive. It preserves the existing Editing IR -> Virtual AE -> Recipe Compiler
-> native AE lowering -> transactional current host -> rendered proof pipeline.
Tutorial 001 transfer evidence and Tutorial 002 effect-stack/stabilization evidence
remain authoritative unless the M6 impact graph identifies a changed dependency.

`M6_BASELINE_AUTHORITY_V1` records the exact inherited ref, commit, pipeline, and
retained proofs. `createM6ImpactGraphV1()` separates M6-only invalidation from changes
that genuinely require an M5 proof to run again.

## Implemented system

### M6.1 Dense Effect Evidence

`analyzeDenseEffectEvidenceV1()` requires a consecutive frame window by default and
uses one schema for reference and EditFlow renders. It measures per-frame luminance,
contrast, sharpness, edge/visual density, chromatic separation, alpha coverage, frame
difference, motion energy/direction, subject and background motion, separation,
displacement, scale, rotation, perspective, blur, distortion, temporal-state count,
overlap, mask coverage, and occlusion. It derives peak timing, persistence,
acceleration, and recovery. Content-addressed `DenseEvidenceCacheV1` prevents repeated
analysis of unchanged source/range/settings evidence.

The engine deliberately accepts semantic tracker/segmentation observations alongside
pixel measurements. Pixel differences alone cannot safely establish subject identity,
simultaneous temporal copies, or foreground/background causality.

### M6.2 Tutorial Action -> Pixel Learning

`learnTutorialActionPixelConsequencesV1()` records:

`ACTION -> AE CHANGE -> PIXEL CONSEQUENCE -> EDITORIAL PURPOSE`

Each rule includes material dimension deltas, the visible loss caused by omission,
adaptation inputs, literal tutorial values as provenance only, and evidence lineage.
A major tutorial action without a material traceable consequence prevents completion.

### M6.3 Effect Anatomy and Transition DNA

The system represents spatial, temporal, isolation, optical, distortion, compositing,
and motion-structure behavior. Canonical DNA exists for all fourteen roadmap families.
Defining and optional invariants are separate. In particular,
`SHUTTER_FRAGMENTATION` requires multiple temporal states, overlap, spatial separation,
high-frequency convergence, and bounded recovery. Blur, flash, and scale accents are
optional and cannot make a flash/zoom substitute pass.

### M6.4 Layer / Construction Reconstruction

`buildConstructionGraphV1()` converts anatomy into a dependency-ordered semantic graph
covering base timing, temporal copies, isolation, camera/transform motion, distortion,
optical treatment, exposure/chromatic accents, occlusion, and recovery. Every defining
invariant maps to one or more construction nodes. Compilation returns a valid Editing IR
recipe only when all required capabilities are available. The existing Recipe Compiler
and Virtual AE can then attempt materialization; unsupported variants return explicit
compiler issues rather than a weaker replacement.

### M6.5 Semantic Visual Fidelity Comparator

`compareSemanticVisualFidelityV1()` supports frame- and semantic-window alignment. It
returns an interpretable error vector for each invariant, including reference value,
render value, normalized error, defining/optional status, and diagnosis. It reports
defining coverage and weighted fidelity instead of hiding failures behind one score.

### M6.6 Anti-Simplification Gate

`evaluateProfessionalFidelityGateV1()` requires both construction coverage and rendered
comparison. It detects optional decoration masking absent defining behavior and permits
only PASS, CORRECTION_REQUIRED, SYNTHESIS_REQUIRED, or CAPABILITY_GAP. Only PASS is
certified.

### M6.7 Automatic Visual Correction

`runAutomaticVisualCorrectionLoopV1()` applies a construction graph, renders a local
window, compares it, maps failed invariants back to exact semantic parameters, patches
only implicated nodes, and repeats with bounded iterations and improvement stop rules.
Successful patches are available to Experience Memory through
`VisualCorrectionMemoryV1`.

### M6.8 Unknown Effect Synthesis

`synthesizeUnknownEffectV1()` starts from observed behavior and creates dynamic DNA
without borrowing a learned family label. Coherent temporal fragmentation is measured
from one event-local tuple (state count + overlap + within-frame separation + coherence)
so unrelated global source-texture maxima cannot become the effect identity. Defining
behavior is separated from secondary styling before construction search.

The synthesizer now produces genuinely different construction hypotheses rather than
three score variants of one graph: proof-backed layered primitives, native Echo hybrid,
Time Displacement hybrid, and Turbulent Displace hybrid when the observed anatomy makes
those strategies relevant. Missing native bindings become explicit
`AdaptiveCapabilityProposalV1` entries with a required `REAL_AE_RENDER` proof; they
are never treated as usable merely because After Effects documents the effect.
Successful candidates keep source provenance and can be retained only after rendered
proof through `SynthesizedEffectMemoryV1`.

The retained M6.8 release gate is now machine-checkable through
`evaluateUnknownEffectSynthesisMilestoneV1()` and
`proofs/manifests/m6-unknown-effect-synthesis-v1.json`. It requires at least three
distinct reference content identities, family `UNKNOWN`, behavior-first provenance,
no nearest-named-effect fallback, rendered certification, complete defining coverage,
a rejected degraded/under-driven state, at least one committed real-AE case, and at
least one bounded automatic-correction case. The current retained manifest passes with
three distinct unknown cases, three rendered proofs, two committed real-AE cases, one
bounded automatic-correction case, and zero gate failures.

### M6.9 Professional Benchmark

`createCanonicalProfessionalBenchmarkV1()` declares 24 cases spanning all fourteen
families, tutorial-based references, reference-only cases, ten held-out cases, and the
required transfer axes. A case passes only with content-addressed direct A/B evidence,
machine comparison, materially different transfer evidence, degraded-case rejection,
and the expected cumulative maturity. `evaluateRetainedProfessionalBenchmarkV1()`
fails closed when any artifact digest, case/family binding, content-key relationship,
transfer-source identity, or transfer axis is missing.

The retained readiness manifest is
`proofs/manifests/m6-professional-benchmark-readiness-v1.json`. It is deliberately
`IN_PROGRESS`: one of 24 cases, canonical shutter fragmentation, is currently bound to
retained reference evidence, a certified real-AE render, semantic comparison, direct
A/B evidence, and a rejected degraded control. It has no accepted transfer artifact
yet, so the benchmark cannot promote that case beyond `REFERENCE_FAITHFUL` and cannot
claim benchmark-wide Level 6.

### M6.10 EditFlow Brain Integration

`VisualEffectsBrainV1` is exported through `@editflow/editor-brain`. Low-risk,
proof-backed learned graphs remain on the fast path. High-risk/reference-driven effects
route through perception, anatomy or unknown synthesis, construction, local render,
comparison, correction, and fail-closed fidelity. A request without required reference
evidence or capabilities cannot silently fall back.

## Professional fidelity maturity

1. `FUNCTIONALLY_PRESENT`
2. `STRUCTURAL`
3. `VISUALLY_RECOGNIZABLE`
4. `REFERENCE_FAITHFUL`
5. `TRANSFER_VERIFIED`
6. `PROFESSIONAL_FIDELITY_VERIFIED`
7. `ROBUST`

Level 6 is the release target for important learned professional effects. Level 7 is the
target for heavily reused core techniques.

## Current evidence boundary

The deterministic implementation and synthetic degraded-case tests pass locally. They
prove contracts, causal bookkeeping, construction coverage, bounded correction logic,
synthesis fail-closed behavior, benchmark enforcement, and Brain routing.

M6 now has retained **real-pixel** evidence for the professional
microwave/shutter transition and multiple local Adobe After Effects reconstructions.
`scripts/proofs/m6-dense-video-probe.py` decodes every frame and measures dense optical
flow, robust affine motion, motion-compensated residual, optical structure and
within-frame temporal fragmentation. `scripts/proofs/m6-dense-video-evidence.mjs`
lowers those measurements through the existing `DenseEffectEvidenceV1` schema.

### Active v12 evidence boundary (September 2026)

The active dense probe is `editflow.m6.dense-video-probe.v12`. It improves persistent
shot-boundary and temporal-baseline handling used by dense reference analysis. Reference
and render evidence may certify one another only when their analyzer fingerprints
match; analyzer drift invalidates comparison, not the underlying historical proof. A
retained v11 UNKNOWN correction proof was intentionally not reinterpreted under v12:
a live rerun reached the analyzer-compatibility guard and failed closed rather than
mixing evidence generations.

The current v12 shutter reference is retained at
`proofs/diagnostics/m6-m69-shutter-reference-v12-evidence.json`. It is new perception
evidence, not a replacement certification for older analyzer-matched renders. M6.8
therefore retains its content-addressed v11/v6 case proofs under the no-reproof rule,
while new M6.9 transfer and benchmark renders must use analyzer-compatible evidence for
their own certification.

The native Echo hypothesis now also has refreshed active-v10 live-AE evidence at
`proofs/diagnostics/m6-native-echo-live-proof.json`. The proof commits the real
`ADBE Echo` effect, verifies its compiled property values by AE readback, and compares
the same rendered construction with Echo enabled versus disabled. The direct A/B changes
11 of 15 frames, with mean normalized RGB delta 0.02844 and a peak changed-pixel ratio
of 0.9029. Active-v10 semantic comparison improves weighted fidelity from 0.7974 for the
Echo-off control to 0.8378 with Echo enabled, but both remain at 3-of-7 defining
coverage. This is intentionally **capability/schema consequence evidence**, not
professional-reference certification: `ae.effect-schema.m6.echo.v1` remains
`PROOF_REQUIRED` until materially different transfer evidence and anti-simplification
calibration are retained under analyzer-matched evidence.

The v6 material below is retained as historical, analyzer-bound professional-fidelity
provenance. It supports the canonical shutter benchmark's retained reference-faithful
case, but it does not certify the active-v10 Echo gate and does not by itself satisfy
transfer, the 24-case professional benchmark, or robustness.

### Historical v6 evidence (superseded for active certification)

The v6 dense analyzer separated global scene autocorrelation from the **coherent
fragmentation event**. This fixes a causal measurement failure found during real AE
correction: changing duplicate spacing in AE changed the layer geometry, but the old
global `stateSeparationPeak` stayed pinned to an unrelated repeated source-texture
lobe. v6 retains global diagnostics, while shutter DNA resolves event-local state count,
overlap, state separation, and coherence around the same transition impulse.

For the professional microwave/shutter reference, the event-local defining values are
`temporalStateCount=2`, `overlapDensity=0.0550`,
`stateSeparation=0.02170`, and `fragmentationCoherence=0.2751`. A real AE local
render, candidate `v6-joint:28-1`, now passes all six defining shutter invariants plus
the optional blur/exposure checks under analyzer-matched evidence. Its corresponding
values are 2 states, 0.0580 overlap, 0.01964 state separation, and 0.2902 coherence.
The retained proof is `proofs/manifests/m6-real-pixel-fidelity-v6.json`, with an
8-frame direct A/B sheet at
`proofs/diagnostics/m6-v6-shutter-reference-vs-certified-ae.jpg`.

The v6 gate is discriminative rather than permissive. Two real rendered negative
controls remain retained: candidate 03 fails coordination + overlap and classifies away
from shutter, while candidate 04 fails overlap + state-separation fidelity. The same
test suite also keeps the v5 evidence historical instead of silently reinterpreting it.
This is the required no-reproof/provenance behavior: old evidence remains inspectable,
but only analyzer-matched v6 reference/render evidence can certify the active gate.

The M6.7 actuator controller retains the best rendered state lexicographically, learns
one-factor control-to-metric response, stops renders for proven non-responsive controls,
couples overlap correction to the state-separation envelope, and emits
`synthesisRequiredInvariantIds` when every mapped actuator for a defining invariant
is exhausted. It now also refines unresolved three-point one-factor intervals when the
rendered response is non-monotonic, including when the retained best has moved to an
interval endpoint.

`scripts/proofs/m6-run-real-ae-auto-correction.mjs` now closes the first real AE
automatic correction proof. Starting only from the deliberately degraded
`v6-joint:36-1` physical state plus professional reference evidence, it rendered the
seed, diagnosed the defining deficits, generated bounded spread counter-probes at 52
and 20, retained the 52 state at 5/6 defining coverage, recognized the remaining
semantic `SPATIAL_SEPARATION` deficit as the shutter adapter's physical
`DUPLICATE_SPREAD` degree of freedom, bisected the unresolved rendered intervals at
28 and 44, and independently certified 28 at 6/6 defining coverage and weighted
fidelity 1.0. The controller was not given the previously known certified candidate.
The retained proof is
`proofs/diagnostics/m6-auto-correction-proof-v2.json`; it records five real AE renders
across three bounded rounds, analyzer-matched evidence provenance, retained-best
selection, candidate generation history, and the explicit single-case scope.

M6.8 now has three retained behavior-first unknown-effect cases bound by
`proofs/manifests/m6-unknown-effect-synthesis-v1.json`. Case 01 disables learned-skill
identity and reconstructs fragmentation from rendered behavior; case 02 reconstructs a
reference-only optical effect through an `UNKNOWN` construction with committed native
AE proof; case 03 records a bounded live-AE correction sequence whose deliberately
under-driven states are rejected until the final rendered pass reaches defining
coverage 1.0 and weighted fidelity 1.0. The milestone evaluator requires the three
reference content identities to be distinct and refuses named-effect fallback. M6.8 is
therefore closed at its roadmap proof gate rather than merely implemented.

The canonical shutter case is `REFERENCE_FAITHFUL` in the M6.9 cumulative maturity
model: its retained analyzer-matched v6 render has defining coverage 1.0, weighted
fidelity 1.0, rejected rendered negative controls, and direct A/B evidence. It is not
`TRANSFER_VERIFIED` because materially different footage has not yet been accepted for
the shutter construction. The benchmark readiness manifest consequently remains
`IN_PROGRESS`.

The following release evidence remains open:

1. transfer the canonical shutter construction across its required subject and
   aspect-ratio axes with analyzer-compatible rendered evidence;
2. populate the remaining 23 canonical/held-out M6.9 cases with retained reference,
   render, semantic-comparison, direct-A/B, degraded-control, and transfer artifacts;
3. progress important effects through at least two professional case passes for
   benchmark-wide `PROFESSIONAL_FIDELITY_VERIFIED`, then cover all six robustness axes
   for heavily reused Level-7 techniques;
4. make a normal edit request invoke perception -> synthesis -> construction ->
   comparison -> correction -> fidelity without bespoke developer intervention.

M6 therefore closes M6.8 while `TRANSFER_VERIFIED`, M6.9 benchmark-wide
`PROFESSIONAL_FIDELITY_VERIFIED`, `ROBUST`, and the M6.10 normal-production
integration gate remain open.

## Verification

Run:

```bash
npm run check
```

The core M6 suites are `tests/m6-visual-effects-intelligence.test.mjs`,
`tests/m6-real-pixel-evidence.test.mjs`, `tests/m6-actuator-search.test.mjs`, and
`tests/m6-real-ae-auto-correction.test.mjs`. Together they cover flash/zoom
anti-substitution, real-pixel degraded-result rejection, reference-relative fidelity,
bounded local correction, causal actuator response, non-monotonic interval refinement,
retained real-AE automatic correction evidence, synthesis escalation, unknown-effect
synthesis, benchmark requirements, and fast-path versus high-risk Brain routing. The retained structural result is
`proofs/diagnostics/m6-visual-effects-intelligence-structural.json`.
