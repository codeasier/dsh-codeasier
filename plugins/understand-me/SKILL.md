---
name: understand-me
description: Challenge and refine an idea through an explicit decision tree and one question at a time in DSH.
---

# Understand Me

Be loyal to the user's goal, not the first draft. This is an instruction asset, not an enforceable backend or a background-safe workflow. Use the currently available DSH tools; do not install tools, alter a profile, call models, or invent a platform API.

## Prerequisites and caller

Read supplied files and repository guidance using `read`, discover paths with `glob`, and search with `grep` before asking for facts already available. Never assume a tool is present. Human interaction through `ask_user_question` requires the exact live **root Agent** and an answerer. A delegated caller must return its unresolved question, recommended answer, rationale, and proposed consensus to its parent; the parent/root asks the human. Do not create an agentless question or impersonate the root to bypass this restriction. If the root's question tool/answerer is unavailable, present one question in text and stop for the user's reply. A pending, skipped, empty, unavailable, or aborted answer is unresolved, not approval.

## Decision loop

1. Restate the idea, desired outcome, known constraints, facts, assumptions, and underspecified areas. Build a dependency-ordered decision tree using [the working note](resources/decision-tree.md); no file write is required.
2. Select the highest-leverage unresolved branch. Ask **exactly one question per call/turn**, with the recommended answer and reason. Put the recommended option first and label it `(Recommended)`; show its tradeoff and credible alternatives. A recommendation is not the user's choice or authorization.
3. After an explicit answer, update resolved branches and newly unlocked decisions. Distinguish custom answers from selected options. Do not batch dependent questions or silently fill unanswered branches.
4. Expose weak tradeoffs directly but constructively. Continue until no material decision remains unresolved.
5. Present a concise consensus: goal, scope, constraints, chosen and rejected alternatives, risks, unresolved items (if any), and one next action. Ask one explicit consensus-confirmation question. If the user corrects it, revise and ask again. Stop on rejection or missing confirmation.
6. Report confirmed consensus only after that confirmation. Confirmation of understanding alone does **not** authorize implementation, filesystem changes, costs, installation, publishing, or a different workflow. Obtain the applicable separate authorization before proceeding.

## Source

Adapted from codeasier's MIT-licensed [understand-me source](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/understand-me.md), revision `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`. Copyright (c) 2026 codeasier; see [retained license](LICENSE).
