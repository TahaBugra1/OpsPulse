---
name: test-copilot
description: Pure routing skill for test files in the ATDD pipeline — the orchestrating Claude session must NEVER write or edit test files itself in this workflow, and this skill does not run or verify anything either. Use this after code-copilot has written the implementation, instead of the deprecated "test" skill. It builds the ATDD task spec, delegates test authoring to a subagent (via the Agent tool) targeting the already-written implementation, and confirms the files landed in the right place. Actually running tests and checking quality gates is a separate skill, "verify" — call it next.
---

# Test Copilot — test routing only, no authoring, no verification

## Why this exists
Same rule as `code-copilot`: the orchestrator orchestrates, a subagent
authors. This skill is the bridge for the **test-authoring** side of an ATDD
task, replacing the file-writing part of the old `test` skill (now
deprecated, points here).

- **Single responsibility, on purpose.** This skill only gets tests written
  and confirms they landed on disk. Running tests and the full verification
  checklist is the separate `verify` skill. Splitting them means a bad test
  run doesn't force redoing the authoring call, and a bad authoring call
  doesn't force rerunning every gate; each retries independently.
- **Kept separate from code-copilot on purpose.** Writing tests in the same
  call as the implementation mixes two concerns — splitting them means each
  call stays focused on one.

## Precondition
Both must exist under the same `<task-slug>`:
- `artifacts/<task-slug>/atdd.md`
- `artifacts/<task-slug>/code_diff.md` (written by `code-copilot`)

If either is missing, say so and point at the missing skill — don't guess at
what the implementation looks like.

## Steps

### 1. Read atdd.md and code_diff.md
From atdd.md: Acceptance Criteria (happy path + edge cases) and the Benchmark
section. From code_diff.md: which implementation files the subagent actually
created/modified — that's what the tests need to target.

### 2. Build the ATDD task spec
Same shape as `code-copilot` step 2, reusing the same fields from atdd.md:

```
task_definition: <goal + full project/file path>
task_breakdown: [<Acceptance Criteria 1>, ...]
user_scenarios: [<Given-When-Then item as a plain sentence>, ...]
possible_tests: [<benchmark criterion>, <edge case to verify>, ...]
implementation_files: [<from code_diff.md>]
```
If you still have the exact spec from the `code-copilot` run in context, use
that unchanged rather than re-deriving it — consistency matters more than a
fresh rewrite.

### 3. Decide test file paths
Usually alongside the implementation (e.g. `login.test.ts` next to
`page.tsx`, or a parallel `__tests__`/`e2e` directory), following whatever
convention the project already uses — check code_diff.md or the surrounding
directory, and plan.md's test-file placeholders if present. Don't invent a
new test directory layout without checking.

### 4. State the target directory before delegating
Same risk as `code-copilot`: the subagent must be told the absolute project
root explicitly, taken from code_diff.md's own paths (same root the
implementation was actually written to — verify it there, don't re-derive it
from atdd.md alone, code_diff.md is what's proven on disk). State it out loud
to the user in one line before launching the subagent.

### 5. Delegate test authoring to a subagent
Use the `Agent` tool (subagent_type: `general-purpose`). The prompt must be
self-contained:

```
Agent({
  description: "Write tests for <task-slug>",
  subagent_type: "general-purpose",
  prompt: (
    "You are writing tests for an already-implemented feature in an ATDD "
    "pipeline. Write ONLY test files — do not modify implementation files.\n\n"
    "PROJECT ROOT (absolute, write everything relative to this): <root>\n\n"
    "IMPLEMENTATION FILES (already written, target these): <list>\n\n"
    "TASK SPEC:\n<task spec from step 2>\n\n"
    "TEST FILE PATHS to use:\n<from step 3>\n\n"
    "Cover every Acceptance Criteria (happy path + every edge case). "
    "Follow existing project test conventions. No speculative test cases "
    "beyond what the Acceptance Criteria and benchmark require.\n\n"
    "Your final report must list: files created, which Acceptance Criteria "
    "each test covers, and any gaps or assumptions."
  )
})
```
Tell the user this is a real authoring session before running it — **make
this call once**, not speculatively; get the project root and file list
right first (step 4) instead of finding out via a wasted run.

### 6. Confirm the files landed — nothing more
- Run `git status --short <test dir>` (or list it) on the REAL project
  location. Empty/unexpected result means the subagent wrote to the wrong
  place; investigate before treating anything written elsewhere as usable.
- `Read` the test files the subagent wrote, just enough to confirm they cover
  each Acceptance Criteria atdd.md lists (happy path + every edge case) —
  this is a presence check, not a quality review or a test run. Don't run
  the test suite here, don't write test_report.md here — that's `verify`'s
  job.

### 7. If the subagent's output looks wrong
Don't fix it yourself with `Edit`. Delegate again (fresh `Agent` call or
`SendMessage` to continue the same one) with a sharper prompt describing
what's missing or wrong.

### 8. Report to the user
State which test files were written and that AC coverage looks present at a
glance. Tell them the next step is the `verify` skill, which will actually
run the tests and the rest of the quality gates.

## The one rule that can't bend
Every line of test code comes from the delegated subagent, not from the
orchestrating Claude session directly. Reading files to confirm they exist
and roughly match scope is fine; editing a test file directly is not, and
running/verifying anything belongs to `verify`, not here.
