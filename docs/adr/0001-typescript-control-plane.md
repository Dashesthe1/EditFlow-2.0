# ADR 0001 — TypeScript Control Plane

- Status: Accepted
- Date: 2026-09-05

## Decision
Use strict TypeScript/Node.js for the MCP server, planner, registry, executor, orchestration, and shared contracts. JSON Schema remains the durable interchange source of truth.

## Rationale
The system is schema-heavy, MCP-facing, JSON-native, and benefits from one type system across planning and execution boundaries.

## Consequence
Adobe-side or OS-side adapters may use other technologies when required, but they communicate through versioned typed protocols and cannot redefine core contracts.
