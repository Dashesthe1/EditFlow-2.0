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
prove contracts, causal bookkeeping, dense-evidence behavior, construction coverage,
diagnostic discrimination, bounded correction logic, synthesis fail-closed behavior,
benchmark enforcement, and Brain routing.

They do **not** promote M6 to professional-fidelity acceptance. The following retained
evidence must still be produced through the normal warm-AE proof path:

1. a real previously weak microwave/shutter reference and every-frame evidence;
2. real AE reconstructions for three substantially different compound effects;
3. direct A/B proof that the comparator rejects the previously weak EditFlow result;
4. a bounded real-AE correction sequence that improves the rendered pixels;
5. three reference-only unknown-effect reconstructions;
6. 20-30 rendered benchmark cases with held-out and transfer variants;
7. a normal edit request invoking the full loop without developer intervention.

Until those gates pass, M6 remains structurally implemented but not certified at
`PROFESSIONAL_FIDELITY_VERIFIED` or `ROBUST`.

## Verification

Run:

```bash
npm run check
```

The M6 suite is `tests/m6-visual-effects-intelligence.test.mjs`. It deliberately tests
the flash/zoom anti-substitution failure, real capability-gap refusal, bounded correction
convergence, three unknown syntheses, all benchmark requirements, and fast-path versus
high-risk Brain routing. The retained structural result is
`proofs/diagnostics/m6-visual-effects-intelligence-structural.json`.
