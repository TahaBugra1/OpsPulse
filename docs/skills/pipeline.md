---
name: pipeline
description: Orchestration reference for the full ATDD pipeline (atdd → jira-sync → plan → code-copilot → test-copilot → verify → red-team → commit). Doesn't do any work itself — it names which skill runs next and what each hands to the next. Use when the user asks to run the whole flow, or to figure out "what's the next step" for a task already in progress.
---

# Pipeline — orchestration reference only

## Why this exists
Kept separate from `atdd` on purpose — `atdd`'s only job is building the
ATDD draft, not deciding when to hand off to `code-copilot`/`test-copilot`/
`red-team`. This skill is just the map of the chain, so no single step-skill
needs to know what comes after it. Each step-skill still ends by naming the
next one and stopping — this skill doesn't auto-chain across turns either,
it's a reference to consult, not a background process.

## The chain

```
atdd  (+ jira-sync when a Jira ID is involved)
  ↓
plan
  ↓
code-copilot
  ↓
test-copilot
  ↓
verify
  ↓
red-team
  ↓
commit   (only on explicit user request — never automatic)
```

| Step | Reads | Writes | Never does |
|---|---|---|---|
| `jira-sync` | Jira issue, Saga | `saga_task_id` + issue summary (returned to atdd, not a file) | Write atdd.md itself |
| `atdd` | jira-sync output (if any) | `atdd.md` | Talk to Jira/Saga directly, chain to plan |
| `plan` | `atdd.md`, real codebase (read-only) | `plan.md` | Write implementation/test code |
| `code-copilot` | `atdd.md`, `plan.md` | implementation files (via Copilot) + `code_diff.md` | Write code itself, write tests |
| `test-copilot` | `atdd.md`, `code_diff.md` | test files (via Copilot) | Run tests, write reports, run gates |
| `verify` | `code_diff.md`, test files | `verify_report.md` | Write/fix code or tests |
| `red-team` | `atdd.md`, `code_diff.md`, `verify_report.md` | `red_team.json` | Write/fix code |
| `commit` | `red_team.json` verdict | git commit + push (with user approval) | Run without explicit "commit"/"push" request |

## How to use this skill

- **User asks "run the whole thing" / "baştan sona çalıştır":** walk the
  chain top to bottom, calling each skill in turn via the `Skill` tool,
  stopping between steps only for what each step's own rules require
  (clarifying questions in `atdd`, open questions in `plan`, approval in
  `commit`). Don't skip a step to save time — each one exists because
  skipping it caused a real problem before (see each skill's own "Why this
  exists").
- **User asks "nerede kaldık" / "what's next":** call `jira-sync`'s Saga
  lookup (step A) to find the task's current status, then check which
  artifact files exist under `artifacts/<task-slug>/`
  (`atdd.md`, `plan.md`, `code_diff.md`, test files, `verify_report.md`,
  `red_team.json`) to see how far the chain already got. Resume at the next
  missing artifact, not from scratch.
- **A step's gate fails** (red verify gate, red-team `block` verdict): don't
  advance to the next step. Report the failure and let the user decide
  whether to retry the failing step or address it manually.

## Rule
- This skill never writes code, tests, or reports itself — it only calls
  other skills via the `Skill` tool and reports where things stand.
- `commit` is never auto-invoked as part of "run the whole pipeline" — even
  in full-pipeline mode, stop after `red-team` and ask before committing.
