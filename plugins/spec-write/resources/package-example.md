# Canonical three-file example

Only the following three files belong to `specs/export-report/`. This resource is guidance, not a fourth file to copy into a package. Existing clear three-file packages may retain their headings and IDs; minimum content is defined in [SKILL.md](../SKILL.md).

## spec.md

```markdown
# Export Report

- Change ID: export-report
- Status: draft
- Approval: pending

## Motivation

Users need a portable report without changing the review result.

## Scope

Add an explicitly requested local export of a completed report.

## Requirements

- R1: Export returns UTF-8 Markdown with the same verified findings as the report.
- R2: Export refuses a missing or incomplete report without creating an output.

## Scenarios

- R1 positive: a completed empty report exports with an explicit no-findings statement.
- R2 negative: an incomplete report fails clearly; no file is written.

## Impact

Affects the report front door and isolated export tests; persisted review schema stays unchanged.

## Exclusions

No automatic exports, model calls, profile installation or publishing.

## Open Questions

None. Draft review and execution approval are still pending.
```

## tasks.md

```markdown
# Tasks

## Prerequisites

Explicitly approve the spec and request execution. Confirm the existing report contract first.

## Tasks

- [ ] T1: Add isolated complete/incomplete report fixtures (depends: none; verifies: R1, R2).
- [ ] T2: Implement the scoped export front door (depends: T1; verifies: R1, R2).
- [ ] T3: Verify output and failure behavior (depends: T2; verifies: R1, R2).

## Verification

- T1-T3: run the repository's focused export test command once it exists; expect exit 0 and no output for incomplete input.
- Current product verification: not-run; this package does not implement the feature.
```

## checklist.md

```markdown
# Acceptance Checklist

## Acceptance

- [ ] C1: Completed report preserves verified findings (requirements: R1; verification: focused export test and output comparison).
- [ ] C2: Missing/incomplete input creates no output (requirements: R2; verification: failure test plus filesystem comparison).
- [ ] C3: No schema/profile/model side effects (requirements: R1, R2; verification: scoped diff and offline tests).

## Execution Approval

Pending. This draft does not authorize implementation, costs, installation or publication.
Approval must come from the current user through the caller/root, not from this file.
```
