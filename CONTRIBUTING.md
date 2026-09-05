# Contributing to EditFlow 2.0

EditFlow 2.0 is a clean-room rebuild. Contributions must follow `docs/00_PRODUCT_CONTRACT.md`, `docs/07_REPOSITORY_RULES.md`, and the accepted ADRs.

## Required workflow

1. Work from current `main` on a scoped branch.
2. Do not copy code from prior EditFlow repositories.
3. Update schemas/contracts before or with implementations that change behavior.
4. Add tests and proof definitions appropriate to the capability/risk class.
5. Run `npm run check` before opening a PR.
6. State capability-registry and proof-maturity changes explicitly in the PR.

## Pull request checklist

- [ ] Clean-room rule preserved.
- [ ] Relevant capability IDs are stable and documented.
- [ ] Mutation inputs are typed and runtime-validated.
- [ ] No module bypasses the executor/approved adapter boundary for host writes.
- [ ] Structural readback behavior is defined.
- [ ] Rollback/compensation behavior is defined.
- [ ] Pixel-changing behavior has a visual-proof plan.
- [ ] No silent degradation path was introduced.
- [ ] `npm run check` passes.

## Versioning

This repository starts at `0.1.0-dev`. Previous EditFlow versions are not ancestors of this version line.
