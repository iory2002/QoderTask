# MR ↔ issue linking

How the Jira board decides that a merge request belongs to an issue, and what
that means for how MRs are titled.

## What the board reads

`MrAssociation` extracts issue keys from four fields, in this order:

1. **Merge request title**
2. **Description** — only when the title yielded no key at all
3. **Source branch name** — only when the title and description yielded no key
4. **Commit subjects** — only when all three fields above yielded no key

Step 4 is a bounded fallback: one extra `/merge_requests/:iid/commits` request
per unassociated MR, at most 12 MRs per refresh (most recently updated first),
and only the **first line** of each commit. Merge and revert subjects are
skipped. Commit bodies are never scanned.

Only prefixes listed in `pcBoard.projects` are recognised (default: `NEX2`).
An MR for `NEX-932` is invisible to the board unless `NEX` is added to that
setting.

## Title syntax

Two forms work, and both are already used in `gipc-app`:

```
SPRS<00000>[NEX2-672][NEX2-650] Vascular AI is insensitive
SPRS<00000>NEX2-950+954+955: keep the page in step with the active tab
```

- Bracketed keys: `[NEX2-954][NEX2-955]`
- Number suffix: `NEX2-950+954+955` or `NEX2-950, 954` — bare numbers inherit the
  preceding project prefix
- Keep the usual `SPRS<xxxxx>` prefix in front of the keys

Long project keys are matched before short ones, so `NEX2-954` is never read as
the `NEX` project's issue 2.

## Rules

**Write every issue the MR actually fixes into the title.** A single MR often
closes several issues; only the ones named in the title reach the board.

**Never rely on the description for a second key.** The description is only read
when the title produced no key at all. A title of `NEX2-950: ...` plus a body
mentioning `NEX2-954` silently loses 954.

**The commit fallback does not fix multi-issue MRs either.** It only runs when
the title, description and branch name are all keyless. Once any of them names
an issue, commits are not read — so `NEX2-950` in the title still hides 954 and
955 that live in the same branch.

**Do not name issues the MR merely touches.** Every key in the title marks its
card as merged and built. A passing typo fix would falsely promote that issue
past "not committed"; leaving it off the title is the accurate signal.

**Branch names carry at most one key.** `bug-NEX2-610-bridge` works, but a
branch cannot express several issues — that is what the title is for.

## Worked example

[MR !3698](https://gitlab.apps.ge-healthcare.net/ultrasoundgeneralimaging/gipc-app/-/merge_requests/3698)
was titled `SPRS<00000>NEX2-950: keep the page in step with the active tab`, yet
it also carried commits for `NEX2-954` and `NEX2-955`. Those changes did reach
`nexus/dev/7.10.x` and were built, but neither card could show a stage: the
title named only 950, the description named none, and the branch
(`bug-fix-on-spot`) carried no key. The fix is the title form above.

## Why the commit fallback is bounded

Some authors only write the key in commit subjects (`NEX2-954: ...`), leaving
the MR title generic. Reading commits for every MR would mean one extra
`/merge_requests/:iid/commits` request per candidate MR; the board polls every
60 s over dozens of MRs, so that cost is only paid where it can change the
answer: MRs that are currently invisible to the board.

Boundaries that keep it honest:

- Only the subject line counts. A body line like `refs NEX2-954` is a mention,
  not a fix, and would wrongly promote that card.
- `Merge ...` and `Revert ...` subjects are ignored: the first usually carries a
  branch name, the second means the fix was undone.
- Results are cached per MR revision (`updatedAt`), so an unchanged MR is not
  re-fetched on every poll.
- A failed commit request only loses that MR's fallback; the rest of the board
  is unaffected.
