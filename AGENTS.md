# AGENTS.md

Guidance for coding agents working in this repo.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/`.
See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label names.
See `docs/agents/triage-labels.md`.

### MR ↔ issue linking

The board links a merge request to an issue by title, description and source
branch, and — only when all three carry no key — the commit subject line. The
description is read only when the title has no key. Name every issue an MR fixes
in the title anyway: once one key is found, commits are not read.
See `docs/agents/mr-issue-linking.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root.
See `docs/agents/domain.md`.
