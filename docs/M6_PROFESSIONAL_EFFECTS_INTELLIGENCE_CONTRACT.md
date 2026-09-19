# M6 Professional Effects & Transitions Intelligence Contract

Status: **implementation foundation complete; rendered professional-fidelity acceptance pending**

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

`synthesizeUnknownEffectV1()` starts from observed behavior, creates dynamic DNA,
searches construction primitives/capabilities, ranks multiple candidates, and refuses
activation when full defining coverage has a capability gap. Successful candidates keep
source provenance and can be retained only after proof through
`SynthesizedEffectMemoryV1`.

### M6.9 Professional Benchmark

`createCanonicalProfessionalBenchmarkV1()` declares 24 cases spanning all fourteen
families, tutorial-based references, reference-only cases, ten held-out cases, and the
required transfer axes. A case passes only with direct A/B evidence, machine comparison,
transfer, degraded-case rejection, and the expected maturity. This commit defines and
tests the benchmark contract; it does not fabricate the missing rendered case evidence.

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

The current v5 analyzer classifies the bounded professional reference as
`SHUTTER_FRAGMENTATION`. Its defining reference measurements include
`overlapDensityPeak=0.3038` and `stateSeparationPeak=0.0217`. The best retained
density-based reconstruction materially improves the earlier weak result, but a replay
through the **current** comparator still fails closed: defining coverage is 4/6 because
simultaneous overlap remains under-driven and within-frame state separation is
materially over-driven relative to the professional reference.

This replay also demonstrates M6 proof invalidation discipline. An older comparison of
the same rendered evidence had passed displacement and reported 5/6 defining
invariants. After the reference-relative displacement contract was tightened, the same
pixels correctly re-evaluate to 4/6. Historical comparator results therefore cannot be
treated as current authority without matching analyzer/comparator provenance.

The M6.7 actuator controller now retains the best rendered state lexicographically,
learns one-factor control-to-metric response, stops spending renders on controls proven
non-responsive, and emits `synthesisRequiredInvariantIds` when every mapped actuator
for a defining invariant is exhausted. This makes the M6.7 -> M6.8 boundary explicit:
the system must synthesize a new construction instead of continuing parameter
thrashing. Real probes already show duplicate opacity and duplicate spread have
negligible leverage on the remaining overlap deficit; fragmentation density is
responsive but weak, while Time Displacement, Echo, band-overlap and Wide Time
variants have not produced a faithful solution without regressions.

The retained evidence does **not** promote M6 to professional-fidelity acceptance.
The following evidence remains open:

1. a reference-faithful shutter reconstruction that passes every current defining
   invariant under the frozen v5 evidence/comparator contract;
2. real AE reconstructions for at least three substantially different compound effects;
3. a bounded local correction sequence that reaches certification or terminates in an
   explicit synthesis/capability-gap outcome;
4. three reference-only unknown-effect reconstructions with real rendered proof;
5. 20-30 rendered benchmark cases with held-out and transfer variants;
6. a normal edit request invoking the full loop without developer intervention.

Until those gates pass, M6 remains partially evidenced but not certified at
`PROFESSIONAL_FIDELITY_VERIFIED` or `ROBUST`.

## Verification

Run:

```bash
npm run check
```

The core M6 suites are `tests/m6-visual-effects-intelligence.test.mjs`,
`tests/m6-real-pixel-evidence.test.mjs`, and `tests/m6-actuator-search.test.mjs`.
Together they cover flash/zoom anti-substitution, real-pixel degraded-result rejection,
reference-relative fidelity, bounded local correction, causal actuator response,
synthesis escalation, unknown-effect synthesis, benchmark requirements, and fast-path
versus high-risk Brain routing. The retained structural result is
`proofs/diagnostics/m6-visual-effects-intelligence-structural.json`.
