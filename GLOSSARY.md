# Glossary

Domain vocabulary for the Todo Panel / Jira Board extension. Terms only — implementation lives in `docs/adr/` and `.scratch/`.

## Delivery Stage

The progress of the issue's **current round** along the code-delivery chain, derived from code-host and build facts. Never hand-entered. When a card owns several merge requests, the newest one decides the stage — not the highest reached one: after rework the old MR is already merged and built, while the new MR is the work in flight.

Ladder, in order:

1. **Not submitted** (`未提交`) — no merge request is associated with the issue key.
2. **MR awaiting review** (`MR 待审`) — an associated MR exists and is open, with no approval yet.
3. **Approved, not merged** (`已 Approve 待合入`) — an associated MR is open and carries at least one approval.
4. **Merged, awaiting build** (`已合入待构建`) — an associated MR was merged into the target branch, but no build of that merge has passed yet.
5. **Built** (`已构建`) — the latest successful build whose code tree **contains** that merge. Containment is a fact about commit ancestry, never about timestamps: a merge is inside a build when the build's commit has the merge as an ancestor. A failed or still-running build proves nothing. Attribution is deliberately to the latest success rather than the first one that carried it, so the answer cannot drift as the branch is rebuilt.

The claim is about source, not artefacts: `Built` means the change was in the tree a build ran on. It never means a given installer or release contains it — the artefact comes from the tree at build start, while the build's recorded commit may come from a later checkout of the same build.

When a build records no commit SHA (or the ancestry question cannot be answered), the stage falls back to the old time window — a successful build started after the merge — and the detail panel labels that conclusion as **inferred** (`推断`). An inference is never presented as the same fact as ancestry.

The ladder is ordered by reached-ness, not by completeness: skipping a rung (merged without review) advances the stage rather than blocking it.

Stages map onto columns only as a suggestion: approval hints at `In Code Review` for a Story, a merge hints at `In Test` for a Bug or Task. The legal target is whatever the issue's own transitions allow — never inferred from column order.

## Rework

A card whose Jira status has gone back to development — `In Progress`, `Reopened`, `In Rework` or `Test Failed` by default — after an earlier round was built. The delivered round is history: until a newer merge request exists, the stage shows **Rework** (`返工中`) instead of `Built`, and the detail panel keeps the previous MR and build number as evidence. The delivery fact is never erased; it is scoped to its round. Once a newer MR appears the stage follows that MR again: awaiting review, approved, merged, built.

A `Built` badge therefore always means "the merge of the round currently in flight is inside a successful build", not "this issue has ever been built".

Children do not drag a parent's delivered stage into a new round: a sub-task inherits the parent stage only when it is not code work. Types whose name contains `Bug` — including an `In-Sprint Bug` filed under a returned Story — are code work and are judged on their own merge requests and builds. A fix MR must name the child bug key in its title, description or source branch, otherwise the child has no MR and stays at `Not submitted`.

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

## MR Board

The second board in PC Board: a read-only view of merge requests organised by who owes the next action — me as reviewer, or me as author. It is not a smaller Jira Board: an issue can own several MRs and an MR can serve several issues, so the MR Board never groups by issue.

## Review Queue

The merge requests whose reviewers include me and which I have not yet approved. Membership is decided by my own approval record, not by the MR's overall approved state — a merge request can be fully approved by others and still sit in my queue.

## My MRs

Merge requests I authored. Author is the only criterion; being assigned to an MR I did not write does not put it here.

## Review State

Whether a merge request has been looked at by someone other than its author: awaiting me, unreviewed, reviewed by N people, or unknown. Unknown means the approval source could not be read; it never means unreviewed.

## MR Board scope

The set of repository and target-branch pairs the MR Board draws from. Independent of the Jira Board's repo mapping: widening one never widens the other.

## Review Handoff

Carrying a merge request out of the board and into a review session: the MR's diff is materialised as a local artifact and a review instruction is put on the clipboard. The board does not open or seed the session itself — that step belongs to the person.

## Draft MR

A merge request explicitly marked work in progress. Outside the MR Board's scope entirely: a draft is neither queued nor counted.

## Fact Store

The local database shared by every IDE window on one machine. It holds only **facts** — values the servers stamped themselves (a merge time, a build result, an approval) — never derived conclusions such as a Delivery Stage or a badge count, which are recomputed from facts on demand. Two windows reading the same store must therefore never disagree about what happened, only about how fresh it is.

## Fetch stamp

A per-scope record in the Fact Store saying when that scope was last read successfully, and whether some window is reading it right now. There is deliberately no leader window: whoever finds a scope stale and unclaimed refreshes it, so the cadence is set by whichever window looks most often, and a crashed window needs no takeover — its claim simply expires.
