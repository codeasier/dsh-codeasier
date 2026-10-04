# GitHub read-only recipe

This is a conditional CLI recipe, not an installed adapter or a claim of GitCode/other-forge support. Discover `gh` (or the caller-provided executable path) and use its existing authentication; do not run `gh auth login` or echo credentials. Commands below use `OWNER`, `REPO` and `NUMBER` as validated target placeholders, not shell input from comments. Quote arguments; construct GraphQL variables with `-F`, never splice external text into queries.

1. Probe `gh api user` for authenticated identity, `gh api repos/OWNER/REPO` for repository access/returned permissions, and `gh api repos/OWNER/REPO/pulls/NUMBER` for exact PR identity. Capture title/body/state/mergeable/mergeable_state plus `base.repo`, `base.ref`, `base.sha`, `head.repo`, `head.ref`, `head.sha`. `mergeable: null` means unknown, not mergeable. PR metadata alone does not prove write permission; before publication, separately probe the actual head repository and verified write interface. Missing permission/capability evidence stops that write path. Do not assume a fork head is writable.
2. Read REST `pulls/NUMBER/reviews`, `pulls/NUMBER/comments` (inline review comments) and `issues/NUMBER/comments` (ordinary comments), each using `gh api --paginate 'repos/OWNER/REPO/<endpoint>?per_page=100'`. Preserve every page's values and IDs; do not take just the first array, or mistake the inline endpoint for all comments.
3. Read threads through GraphQL. Request the following selection with owner/repo/number variables and a nullable cursor; explicitly advance `pageInfo.endCursor` while `hasNextPage` is true. Check GraphQL `errors` even on HTTP 200; partial `data` is not a complete read.

```graphql
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes { id databaseId url body author { login } path line originalLine replyTo { id } }
          }
        }
      }
    }
  }
}
```

4. For EACH thread whose initial comments connection has another page, fetch `node(id: $thread) { ... on PullRequestReviewThread { comments(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id databaseId url body author { login } path line originalLine replyTo { id } } } } }` until exhausted. Thread pagination does not paginate nested comments. Stop on missing/repeated cursors, inaccessible nodes or errors and record incomplete feedback.
5. Read GraphQL `closingIssuesReferences(first: 100, after: $cursor)` separately, requesting `{ pageInfo { hasNextPage endCursor } nodes { number url title body repository { nameWithOwner } } }`; follow every page. Read each issue and all its ordinary comments via its own verified repository's REST endpoints. Inspect explicit issue links in PR body/review context too; do not assume all `#N` references are closing links or share a repository. Report inaccessible links as missing evidence. Never edit the issue.
6. Record successful endpoints, page/cursor completion, source IDs/URLs and retrieval time. Read-only EOFs permit at most two retries per request; persistent auth/policy/unavailability stops the affected path. Logs must not contain tokens.

## Writes are not part of reading

Replies, thread resolution and Git publication use only independently verified write capabilities after the Skill's separate exact previews and confirmations. A confirmed reply would use the discovered ordinary-comment or inline-reply endpoint, not an interchangeable destination. Thread resolution needs the exact GraphQL thread ID. Git operations need the actual remote ref/SHA. After uncertain writes, re-read the exact comment/thread/ref before considering any newly confirmed retry. These instructions do not supply write authorization.
