# M6 Professional Effects & Transitions Intelligence Contract

Status: **implementation foundation complete; one real AE shutter case is professional-fidelity verified, M6.7 automatic local correction is real-AE proof-closed for that case, and M6.8 has its first behavior-only real-pixel synthesis proof (1/3); transfer/benchmark/system-integration gates remain open**

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

The v6 dense analyzer now separates global scene autocorrelation from the **coherent
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

M6.8 now also has one retained behavior-only real-pixel synthesis proof at
`proofs/diagnostics/m6-real-unknown-synthesis-case01.json`. The learned family identity
is explicitly disabled, the selected graph remains family `UNKNOWN`, the defining
event-local DNA reaches coverage 1.0 and weighted fidelity 0.9599, and the degraded
seed control is rejected. This proves that unknown-effect perception, DNA construction,
candidate synthesis, and semantic certification can work from rendered behavior for
one case. The certified render is intentionally reused from the proven shutter
correction actuator path. A separate retained live-AE structural proof now exists at
`proofs/diagnostics/m6-generic-native-materializer-case01.json`: the same behavior-only
`UNKNOWN` graph compiles through Editing IR / Virtual AE / native AE, commits six native
operations, creates the required temporal duplicate, realizes its prior-frame state with
an event-local one-frame Time Remap source offset, and retains bounded event-local
visibility without shifting the whole layer. This closes direct generic UNKNOWN
graph-to-real-AE materialization provenance for this one case, but it is structural
readback evidence rather than an additional rendered-fidelity certification.

The shutter case **is** `PROFESSIONAL_FIDELITY_VERIFIED` for the retained shutter
construction, and its bounded M6.7 local AE correction loop is automatic; it does
**not** certify M6 as a whole. The following evidence remains open:

1. transfer the shutter construction to materially different footage;
2. real AE reconstructions for at least three substantially different compound effects;
3. two additional substantially different reference-only unknown-effect reconstructions, plus rendered-fidelity proof for generic UNKNOWN graph-to-AE realization beyond the retained structural case;
4. 20-30 rendered benchmark cases with held-out and transfer variants;
5. a normal edit request invoking perception -> synthesis -> construction -> comparison
   -> correction -> fidelity without developer intervention.

M6 therefore has its first real professional-fidelity-verified effect case, while
`TRANSFER_VERIFIED`, benchmark-wide `PROFESSIONAL_FIDELITY_VERIFIED`, and
`ROBUST` remain open release gates.

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
