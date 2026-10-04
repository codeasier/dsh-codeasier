# Tasks

## Prerequisites
Caller approval for specs/greeting and its current scope. R1/R2 are unambiguous.

## Tasks
- [ ] T1: Implement the deterministic greeting and its regression (depends: none; verifies: R1).
- [ ] T2: Document the greeting and its example regression (depends: T1; verifies: R2).

## Verification
T1: node --test greeting.test.mjs must exit 0 and assert R1.
T2: node --test greeting-doc.test.mjs must exit 0 and assert R2.
