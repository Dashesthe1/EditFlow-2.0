# ADR 0010: Installed After Effects Runtime Knowledge Layer

- Status: Accepted
- Date: 2026-09-09

## Context

Human-parity development has repeatedly required answering two different questions:

1. what does After Effects expose in principle; and
2. what does the exact installed After Effects environment expose right now?

Documentation alone cannot answer the second question because installed effects, plugin versions, host version, locale and observed property graphs vary by workstation. Repeated one-off discovery also wastes real-AE proof time.

The repository already defines the capability registry as the runtime planning constraint and release gate. The knowledge layer therefore extends that registry instead of creating a competing source of capability truth.

## Decision

EditFlow will maintain a versioned, read-only **AE Runtime Knowledge** snapshot produced by interrogating the installed After Effects process.

The profiler records:

- After Effects version/build/OS metadata;
- the ExtendScript reflection surface for the application, project and observed layers;
- `app.effects`, including stable effect `matchName` identifiers and installed versions;
- the active composition's existing layer/property hierarchy;
- property `matchName`, property/value types, expression/animation/spatial flags, min/max metadata and units where exposed;
- explicit warnings whenever bounded discovery truncates or cannot inspect a surface.

Runtime snapshots are normalized before indexing. Effect identity uses `matchName`, not localized display names. Environment-level knowledge fingerprint input excludes capture time, project content, localized labels and transient warnings.

The initial profiler is observational. It does not create synthetic layers/effects or mutate the project merely to discover a property surface.

## Evidence precedence

For development and planning, use the following hierarchy:

1. **Installed AE runtime evidence** for what is actually present on the target workstation.
2. **Official Adobe After Effects scripting / ExtendScript / C++ SDK documentation** for intended semantics and supported API contracts.
3. **Verified secondary developer references** only to accelerate discovery or fill navigation gaps.
4. **Real-AE EditFlow proof artifacts** to establish that a discovered route is actually safe and correct for EditFlow.

Runtime discovery never replaces proof. Finding a writable-looking property does not promote its editing capability to `FULL`; normal structural, visual, rollback and transfer proof requirements still apply.

## Control-surface escalation

When implementing a human workflow, EditFlow should prefer the deepest deterministic supported route:

1. typed ExtendScript / host API;
2. dedicated subsystem or native AEGP/C++ adapter when ExtendScript is insufficient;
3. guarded UI automation only for surfaces that cannot be exposed reliably through the first two routes.

The knowledge layer should make the choice explicit rather than discovering it ad hoc during each proof.

## Warm-process rule

Runtime knowledge capture reuses the currently running After Effects process. It MUST NOT close or restart AE merely for discovery. A restart is permitted only under the repository's established warm-AE lifecycle policy: when a specific proof requires lifecycle behavior, AE is demonstrably unhealthy, or safe isolation cannot be restored in-process.

The capture runner therefore uses `AfterFX.exe -r` against the existing process, verifies the original PID remains alive and exposes `restarted=false` in proof evidence.

## Persistence and privacy

The canonical code/schema for runtime knowledge is version controlled. Workstation snapshots are runtime/generated evidence and are not committed by default because they can contain project paths and installed-plugin information. The default persistent snapshot lives under the local EditFlow application-data knowledge directory; proof jobs may additionally store a copy in their declared artifact directory.

A new capture should be generated after material host/plugin changes. Diffs between normalized fingerprints identify environment-surface changes without treating project edits or localization as capability changes.

## Authoritative technical references

- Adobe After Effects scripting Application reference: https://ae-scripting.docsforadobe.dev/general/application/
- Adobe After Effects Property reference: https://ae-scripting.docsforadobe.dev/property/property/
- Adobe After Effects PropertyBase reference: https://ae-scripting.docsforadobe.dev/property/propertybase/
- Adobe ExtendScript Reflection interface: https://extendscript.docsforadobe.dev/extendscript-tools-features/extendscript-reflection-interface/
- Adobe After Effects AEGP C++ API: https://ae-plugins.docsforadobe.dev/aegps/aegps/

## Consequences

Future human-parity work can query a deterministic local knowledge artifact instead of repeatedly guessing effect/property names and API reach. Installed third-party effects can be identified immediately by `matchName` and version. The capability registry gains structural inspection routes while continuing to refuse unproven write capabilities.

The first property-graph capture is intentionally partial because it observes the current composition. A later non-destructive sandbox/archetype profiler may expand coverage across generated layer/effect types once its creation/cleanup transaction is itself proven.
