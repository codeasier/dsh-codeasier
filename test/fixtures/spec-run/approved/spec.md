# Deterministic greeting

Change ID: greeting
Status: draft
Approval: pending

## Motivation
Provide a deterministic greeting with no external dependencies.

## Scope
Only greeting.mjs, greeting.test.mjs, greeting-doc.md and greeting-doc.test.mjs.

## Requirements
R1: Export greet(name); greet('DSH') returns 'Hello, DSH!'.
R2: Document the exact greeting in greeting-doc.md.

## Scenarios
Calling greet('DSH') returns 'Hello, DSH!'; the documented example matches.

## Impact
Local fixture files only; no dependencies or remote services.

## Exclusions
No remote writes, deletion, installation, publication or paid calls.

## Open Questions
None. Caller approval must still identify this exact package and current scope.
