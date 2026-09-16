# Local Fast Runtime V1 — Live AE Proof

Date: 2026-09-16
Branch: `arch/local-fast-runtime-v1`
Base commit: `6fe47f8` (`Recover Shadow CEP bridge without AE restart`)

## Architecture under proof

`ChatGPT -> MCP Shadow Gateway -> LocalFastRuntimeV1 -> persistent warm CEP -> After Effects`

The MCP boundary carries a coarse-grained routine batch. `LocalFastRuntimeV1` owns the warm AE session and runs allow-listed micro-actions locally through `ContinuousFastLoop` / `RoutineDecisionEngine`.

## Live environment

- Existing After Effects 2025 process reused; AE was not restarted.
- CEP bridge reconnected into the running AE process.
- Local runtime: `1.0.0`.
- Batch cap: 64 routine actions.
- Per-action budget: 1000 ms.
- Whole-batch budget: 30000 ms.

## Reversible live proof

Baseline host revision: 31.
Baseline layer transform position: `[960, 540, 0]`.

One `/run-batch` request executed 20 `SET_LAYER_TRANSFORM` actions. The actions alternated X position between 961 and 960 and ended at the original `[960, 540, 0]` value.

Result:

- Route: `LOCAL`
- Requested actions: 20
- Completed actions: 20
- Escalations: 0
- Planning: 0.177 ms
- Summed AE action time: 1521.283 ms
- Mean AE action time: 76.064 ms
- Maximum AE action time: 85.266 ms
- Local runtime total: 1522.646 ms
- End-to-end localhost HTTP wall time: 1583.023 ms
- Within budget: true
- Final host revision: 51

One checkpoint state read after the batch verified revision 51 and exact restoration of the layer position to `[960, 540, 0]`.

## Acceptance

PASS. Twenty real AE writes were executed inside one local orchestration request with no model reasoning or full project observation between micro-actions. The final checkpoint read verified state coherence and reversible restoration.
