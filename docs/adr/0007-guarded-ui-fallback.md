# ADR 0007 — Guarded UI Fallback Boundary

- Status: Accepted
- Date: 2026-09-05

## Decision
UI automation is a last-resort capability adapter, never a generic control surface. MCP may request semantic operations such as `plugin.mocha.track_plane`; it may not request arbitrary clicks, coordinates, or keystroke sequences.

A UI capability module verifies exact AE window/panel/context, performs bounded actions, captures before/after evidence, reads project state where possible, and stops on unexpected dialogs/focus/layout ambiguity.

## Consequence
Human parity can reach genuinely GUI-only functionality without turning EditFlow into an unrestricted remote-control shell.
