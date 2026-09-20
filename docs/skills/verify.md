---
name: verify
description: Runs the real quality-gate checklist (build/lint/type-check/unit/e2e/accessibility/security/etc.) against the project and reports PASS/FAIL/N/A per gate — never authors or fixes code, never runs Copilot. Use this after test-copilot has written test files, as the ATDD pipeline's dedicated verification step (atdd → code-copilot → test-copilot → verify → red-team → human approval).
---

# Verify — quality gates only, no authoring

## Why this exists
Kept separate from `test-copilot` on purpose: a skill that both routes
authoring AND runs a full gate checklist has two responsibilities, so a bad
gate result would force re-reading the whole skill instead of just
re-running gates. This skill's only job is running real checks against the
real project and reporting what it found — honestly, including what doesn't
apply here.

- **No OpenAPI contract gate.** Most tasks don't touch the API surface, and
  framework-level validation plus `pytest`/integration tests give the same
  practical assurance for the cases that matter — verifying real behavior
  beats verifying a contract document.
- **Never marks a gate ✅ without evidence.** A gate that doesn't apply to
  this project (no e2e suite configured, no web UI in scope, etc.) is marked
  **N/A with a one-line reason** — never silently skipped, never faked.

## Precondition
`artifacts/<task-slug>/code_diff.md` should exist (from
`code-copilot`) so you know which files/surfaces to verify. If `test-copilot`
already ran, `test_report.md`'s "AC -> Test Mapping" section tells you which
test files to run — read it if present, don't guess.

## The gate checklist

Run **every** gate below against the real project. For each one, either
produce real PASS/FAIL evidence or mark it **N/A** with a one-line reason. Do
not skip a gate silently and do not mark one passing without having actually
run something.

1. **Dosya konumu** — confirm the files you're about to verify actually exist
   on disk where `code_diff.md`/`test_report.md` claim (`git status --short`,
   `Read`). Not a pass/fail gate itself, but everything below depends on it.
2. **Build/derleme** — the project's real build or import-sanity command
   (e.g. `uv run python -c "import <module>"` for Python, `npm run build`
   for JS/TS). PASS/FAIL from real output.
3. **Lint** — the project's configured linter (`ruff check`, `eslint`, etc.)
   if one exists in repo config. N/A ("proje linter tanımlamıyor") if none.
4. **Type check** — the project's configured type checker (`pyright`,
   `mypy`, `tsc --noEmit`) if configured. N/A otherwise, with reason.
5. **Unit testler** — run the real suite: `pytest <test files> -v` (or the
   project's equivalent). Use actual output, don't guess. Also check that
   every Acceptance Criteria in `atdd.md` (happy path + edge cases) has at
   least one covering test — a quick test-pyramid/code-smell pass too (God
   function, magic numbers, deep nesting, long parameter lists).
6. **E2E testler** — if the project has a configured e2e suite (Playwright,
   Cypress, etc.), run it. N/A ("bu görevde e2e altyapısı yok") otherwise.
7. **Lighthouse (performans)** — only if the change touches a served web
   page/UI. Start the relevant dev server (`preview_start`), use the
   `lighthouse` MCP server (`mcp__lighthouse__run_audit` /
   `get_performance_score`) against the running URL. N/A if no web UI in
   scope for this task.
8. **Erişilebilirlik (accessibility)** — read from the same Lighthouse run's
   accessibility category (gate 7) when it applies; report critical issues
   found, not just the numeric score. N/A under the same condition as gate 7.
9. **Güvenlik taraması (kritik açık)** — a lightweight sanity check here
   (e.g. `bandit` for Python, `npm audit` for JS, if configured/available),
   NOT a replacement for the dedicated `red-team` skill that runs after
   this one — say so explicitly in the report rather than claiming security
   review is "done" here.
10. **AI code review** — intentionally satisfied by the separate `red-team`
    pipeline step, not duplicated here. Record it as pending/deferred.
11. **Görsel regresyon (visual regression)** — only if the project has
    configured visual-diff tooling (Percy, Chromatic, screenshot-diff).
    N/A otherwise.
12. **İnsan onayı** — always the last gate, always pending until the user
    explicitly signs off — this skill and `red-team` can recommend, they
    cannot grant it. Never write this as done in the report.

## Report

Write `artifacts/<task-slug>/verify_report.md`:

```markdown
# Verify Report — <task-slug>
_Reference: atdd.md, code_diff.md, test_report.md (if present)_

## Verification Gates
| # | Gate | Result | Evidence / Reason |
|---|------|--------|--------------------|
| 1 | Dosya konumu | PASS/FAIL | ... |
| 2 | Build/derleme | PASS/FAIL/N/A | ... |
| 3 | Lint | PASS/FAIL/N/A | ... |
| 4 | Type check | PASS/FAIL/N/A | ... |
| 5 | Unit testler | PASS/FAIL | ... |
| 6 | E2E testler | PASS/FAIL/N/A | ... |
| 7 | Lighthouse (performans) | PASS/FAIL/N/A | ... |
| 8 | Erişilebilirlik | PASS/FAIL/N/A | ... |
| 9 | Güvenlik taraması | PASS/FAIL/N/A | ... |
| 10 | AI code review | PENDING (red-team) | ... |
| 11 | Görsel regresyon | PASS/FAIL/N/A | ... |
| 12 | İnsan onayı | PENDING | ... |

## AC -> Test Mapping
1. <Acceptance Criteria 1> -> <test function> -> PASS/FAIL

## Coverage / Quality Notes
<any AC with no covering test, pyramid imbalance, code smells>
```

## If a gate fails
Don't fix it yourself. If the failure is in test code, tell the user to
re-run `test-copilot` with a sharper description of what's wrong. If it's in
the implementation, tell them to re-run `code-copilot`. Report the failure
honestly; don't mark the whole step "done" while anything mandatory (build,
unit tests, any gate that applies) is still red.

## The one rule that can't bend
This skill never writes or edits implementation or test files — Read, Bash
(to run checks), and the report file only. No gate is ever marked passing
without real evidence behind it.
