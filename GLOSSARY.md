# Glossary

Domain vocabulary for the Todo Panel / Jira Board extension. Terms only — implementation lives in `docs/adr/` and `.scratch/`.

## Delivery Stage

The furthest node a Jira issue has reached along the code-delivery chain, derived from code-host and build facts. Never hand-entered. When multiple signals disagree, the highest reached stage wins (a self-merged MR is `Merged`, not `Awaiting approval`).

Ladder, in order:

1. **Not submitted** (`未提交`) — no merge request is associated with the issue key.
2. **MR awaiting review** (`MR 待审`) — an associated MR exists and is open, with no approval yet.
3. **Approved, not merged** (`已 Approve 待合入`) — an associated MR is open and carries at least one approval.
4. **Merged, awaiting build** (`已合入待构建`) — an associated MR was merged into the target branch, but no build of that merge has passed yet.
5. **Built** (`已构建`) — a successful build exists for that merge.

The ladder is ordered by reached-ness, not by completeness: skipping a rung (merged without review) advances the stage rather than blocking it.

Stages map onto columns only as a suggestion: approval hints at `In Code Review` for a Story, a merge hints at `In Test` for a Bug or Task. The legal target is whatever the issue's own transitions allow — never inferred from column order.

## Target branch

A branch whose merges count as delivery. Only merges into a target branch advance the Delivery Stage; merges between feature branches do not. Configured per repo — for the Nexus line it is `nexus/dev/7.10.x`, not `main`.

## Board scope

The set of issues the board renders: the active sprint, narrowed by the project filter and the "assigned to me" toggle. Delivery-stage badges never widen or narrow scope.

The board has no lanes. Issues are laid out as one vertical stream inside each column.

Defaults to "assigned to me" on: the daily view is a handful of cards, not the whole sprint.

Projects come from a configured whitelist rather than from whatever the board filter happens to include, so stray issues in unrelated projects stay out of scope.

## Column

A vertical slice of the board, defined by the Jira board configuration (`columnConfig.columns`) rather than guessed from workflow transitions. A column owns a set of Jira statuses, so a card's column is resolved by status id, not by status name.

A column is a legal drop target only when an Advance Path exists from the issue's current status into it.

## Advance Path

Any single workflow transition the issue currently offers whose target status belongs to the target column. The board never assumes adjacency, because workflows diverge by issue type: a Bug jumps straight from `In Progress` to `In Test`, a Task or Sub-task can reach `Done` in one step, while a Story must pass through `In Code Review` first.

Legality is therefore read per issue from its own available transitions, never derived from column order. Only one transition is ever executed — the board never chains two. Reversal (`Return`, `Revert`, `Fail`) sits outside the board and happens in Jira.

## Unmapped status

A Jira status that belongs to no board column. Issues in such a status have no column to sit in, and the board must say so rather than silently dropping them.

## Transition form

The required-fields screen Jira demands before a workflow transition may execute. Rendered from the transitions metadata of the specific issue; must be filled before the write is sent.
