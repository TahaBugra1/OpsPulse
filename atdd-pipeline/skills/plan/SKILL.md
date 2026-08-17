---
name: plan
description: Between atdd and code-copilot — reads atdd.md and the real codebase to produce a concrete file-change plan (files to modify, new files, dependencies, migrations, risks) before any Copilot call is made. Read-only (Glob/Grep/Read only), never writes implementation or test code. Reduces rework by giving code-copilot a sharper extra_instructions target instead of guessing scope from atdd.md alone.
---

# Plan — file-impact planning, no authoring

## Why this exists
Sits between `atdd` and `code-copilot`. Without it, `code-copilot` would have
to derive its file list purely from atdd.md's own guesses — often missing
real dependencies (a shared helper, a config file, a migration) until after
an expensive authoring call already ran. This skill does that discovery up
front, for free, using Claude's own read tools against the real repo.

## Precondition
`artifacts/<task-slug>/atdd.md` must exist (from `atdd`,
optionally enriched by `jira-sync`). If missing, point at `atdd` — don't plan
against a task that was never clarified.

## Steps

1. **Read atdd.md fully** — frontmatter (`affected_modules`, `priority`,
   `test_strategy`) and body (Acceptance Criteria, Kapsam Dışı, Rollback
   Beklentisi, Risks/Assumptions/Unknowns).
2. **Explore the real codebase** for each `affected_modules` entry and
   anything the Acceptance Criteria imply touching — `Glob`/`Grep`/`Read`
   only. Look for: existing patterns to follow (naming, error handling,
   response shapes), files that will need a matching change (e.g. a route
   file if a new endpoint is added), and anything the ATDD's "Etkilenen
   Dosyalar" section missed.
3. **Check for migrations.** If the change implies a schema/data change
   (new table, new column, new required field), note it explicitly — this
   pipeline's projects generally forbid silent schema changes (see the
   target repo's own CLAUDE.md/ADRs for the actual rule, e.g. Group-9's
   ADR 0001 on `profiles.role`).
4. **Write the plan** to `artifacts/<task-slug>/plan.md`:

```markdown
# Plan — <task-slug>
_Reference: atdd.md_

## Files to Modify
| File | Why | Risk |
|------|-----|------|
| path/to/file.py | <reason tied to an AC> | low/medium/high |

## New Files
| File | Purpose |
|------|---------|
| path/to/new_file.py | ... |

## Dependencies
<existing modules/functions this change will call or must stay consistent with>

## Migration Required?
Yes/No — <if yes, what and why; if the project forbids ad-hoc migrations,
say so and flag it for the user instead of assuming>

## Risks
<carried over/refined from atdd.md's Risks section, plus anything found here>

## Open Questions
<anything discovered during exploration that atdd.md didn't cover — ask the
user before code-copilot runs, don't guess>
```

5. If step 4 surfaced open questions, ask them (`AskUserQuestion`) before
   handing off — cheaper to resolve now than after a Copilot authoring call.
6. Tell the user `plan.md` is ready and the next step is `code-copilot`,
   which should pass this plan's "Files to Modify"/"New Files" lists as its
   file scope instead of re-deriving them from atdd.md alone.

## Rule
- Read-only. `Glob`, `Grep`, `Read`, and the `plan.md` report file only —
  never `Write`/`Edit` on implementation or test files, never a Copilot call.
- Don't pad the plan with speculative future-proofing — only files an
  Acceptance Criteria or a real dependency actually requires.
