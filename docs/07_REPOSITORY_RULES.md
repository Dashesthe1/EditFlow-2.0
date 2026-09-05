# Repository and Development Rules

## Clean-room enforcement

1. Do not copy source code from prior EditFlow repositories into this repository.
2. Do not use old release numbers or treat an old implementation as a required compatibility target.
3. Prior behavior may be referenced only as requirements evidence, failure evidence, or acceptance-test inspiration.
4. Any intentional compatibility layer introduced later requires an ADR explaining why it is needed.

## Source of truth

- `main` contains only reviewed, internally consistent foundation or implementation changes.
- Feature work occurs on scoped branches and enters `main` through pull requests after the initial foundation merge.
- `docs/` contains normative architecture/product contracts.
- `spec/` contains machine-readable schemas/contracts.
- `proofs/` will contain reproducible proof definitions and manifests, not hand-written success claims.

## Architecture decision records

Material decisions require `docs/adr/NNNN-title.md` with:

- context;
- decision;
- alternatives considered;
- consequences;
- human-parity impact;
- safety/rollback impact;
- proof impact.

Required ADR topics before host implementation:

1. primary control-plane runtime/language;
2. AE host integration routes and trust boundaries;
3. stable-ID strategy;
4. project revision/fingerprint strategy;
5. persistence stores and provenance;
6. visual-proof artifact format;
7. UI fallback technology and safety boundary.

## Definition of done for code changes

A change is not done until it has, as applicable:

- typed contract/schema updates;
- validation behavior;
- unit/contract tests;
- deterministic error reporting;
- readback support;
- transaction/recovery behavior;
- proof fixture updates;
- documentation for new capability IDs;
- no-silent-degradation coverage.

## No hidden host writes

No module may mutate After Effects outside the executor/adapters registered in the capability graph. Helper modules may prepare data but cannot bypass transaction ownership.

## Capability naming

Capabilities use stable namespaced IDs, for example:

- `ae.layer.parent.set`;
- `ae.mask.path.animate`;
- `ae.keyframe.temporal.influence.set`;
- `ae.tracker.point.track`;
- `ae.roto_brush.propagate`;
- `plugin.mocha.planar.track`.

IDs describe semantic capability, not implementation route.

## Error model

Errors are structured and actionable. Minimum categories:

- `VALIDATION_ERROR`;
- `CAPABILITY_UNAVAILABLE`;
- `SEMANTIC_BINDING_UNRESOLVED`;
- `STALE_PROJECT_STATE`;
- `HOST_CONFLICT`;
- `ADAPTER_FAILURE`;
- `VISUAL_PROOF_FAILURE`;
- `ROLLBACK_FAILURE`;
- `EXTERNAL_UI_UNEXPECTED_STATE`;
- `ENVIRONMENT_DEPENDENCY_MISSING`.

Errors include stable code, affected capability/operation IDs, expected vs actual state, recovery recommendation, and proof/ledger references.

## Pull-request expectations

A PR must state:

- problem/capability being added;
- architecture impact;
- schemas/contracts changed;
- tests/proofs added;
- rollback/recovery behavior;
- known limitations;
- human-parity registry status change, if any.

## Release rule

No release tag is created from a commit whose declared milestone proof gate is failing. Capability statuses must reflect evidence, not intent.
