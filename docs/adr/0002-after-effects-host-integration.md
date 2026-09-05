# ADR 0002 — After Effects Host Integration Boundary

- Status: Accepted
- Date: 2026-09-05

## Decision
The first AE host route will be a dedicated, versioned CEP/ExtendScript adapter controlled through typed commands. ChatGPT never submits arbitrary JSX.

The adapter owns audited host-side scripts and accepts validated data only. More specialized AE/plugin subsystems use dedicated adapters; UI automation is reserved for capabilities not sufficiently reachable through deeper routes.

## Consequence
The new bridge is written from scratch and remains replaceable behind the adapter protocol. No direct Adobe write is allowed from MCP/planner modules.
