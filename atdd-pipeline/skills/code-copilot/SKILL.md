---
name: code-copilot
description: Pure routing skill for implementation code in the ATDD pipeline — Claude (the orchestrator) must NEVER write or edit code files itself in this workflow. Use this whenever an atdd.md task is ready to be implemented (after the "atdd" skill), instead of the deprecated "code" skill. It builds the ATDD task spec from atdd.md/plan.md and delegates the actual authoring to a subagent (via the Agent tool) instead of an external CLI. Test files are NOT written here — that's the separate test-copilot skill. The orchestrator only reads the subagent's result and writes a report; it never authors a single line of the feature code itself.
---

# Code Copilot — implementation routing only, no authoring

## Why this exists
On this pipeline, the orchestrating Claude session is only allowed to
orchestrate — never to author code files with `Write`/`Edit` directly. The
actual authoring happens in a separate subagent, launched via the `Agent`
tool. This skill is the bridge for the **implementation** side of an ATDD
task; it replaces the file-writing part of the old `code` skill (now
deprecated, points here).

Two decisions worth keeping in mind:
- **Code and tests are deliberately SEPARATE calls, in separate skills.**
  `code-copilot` writes implementation files only; `test-copilot` writes test
  files only, afterward, targeting the implementation this skill produced.
  Each call stays focused on one concern — easier to review, and if only one
  side needs a retry (e.g. tests need adjusting but the implementation is
  fine), you re-run only that call instead of redoing both.
- **No external-model review gate.** An earlier version routed review through
  a third-party API that turned out unreliable in practice (intermittent
  timeouts/500s unrelated to prompt size or correctness) — removed entirely.
  Review is the orchestrator reading the subagent's result directly — not
  authoring, so it doesn't conflict with the "orchestrator can't write code"
  rule.

## Precondition
`artifacts/<task-slug>/atdd.md` must already exist. If it
doesn't, tell the user and point them at the `atdd` skill — don't draft one
yourself. If `artifacts/<task-slug>/plan.md` exists (from the
`plan` skill), use its "Files to Modify"/"New Files" lists as the file scope
instead of re-deriving it from atdd.md alone.

## Steps

### 1. Read atdd.md (and plan.md if present)
Pull out: User Story / goal, Acceptance Criteria, out-of-scope items, known
affected files, and benchmark. From plan.md (if present): the concrete file
list, dependencies, and migration notes. These map directly onto the task
spec in step 2 — don't paraphrase away specifics.

### 2. Build the ATDD task spec
Assemble a plain task spec — this is what the subagent's prompt will be built
from, not a file format any external tool requires:

```
task_definition: <goal + full project/file path, from atdd.md/plan.md>
task_breakdown: [<Acceptance Criteria 1>, <Acceptance Criteria 2>, ...]
user_scenarios: [<Given-When-Then item as a plain sentence>, ...]
possible_tests: [<benchmark criterion>, <edge case to verify>, ...]
files: [<New Files / Files to Modify from plan.md, or atdd.md's affected_modules>]
```

Use atdd.md's/plan.md's own wording — this spec is what the subagent bases
its whole implementation on; anything you add here that isn't in atdd.md is
scope you invented, not scope the user approved.

### 2a. CAVEMAN Principles (Mandatory)

Include these implementation rules in the subagent's prompt — either inline
or as a fixed prefix you always send. They shape *how* the subagent
implements, not *what* (that's still atdd.md's/plan.md's job):

Implement only what ATDD requires.

Prefer:
- the smallest implementation
- the fewest files
- the fewest abstractions
- the fewest helper functions
- explicit code
- existing project patterns

Never:
- introduce speculative architecture
- optimize for future requirements
- create extension points
- add unnecessary configuration
- create utilities "just in case"
- split files without a real reason

If two implementations satisfy the Acceptance Criteria, always choose the
simpler one. When uncertain, do not add complexity.

### 2b. Definition of Done

Include this as part of the subagent's prompt, and use it yourself in step 5's
review — the subagent should consider the implementation complete only if
all of these hold:

**Acceptance Criteria**
- Every Acceptance Criterion is implemented.
- No Acceptance Criterion is partially implemented.
- No out-of-scope functionality exists.

**Code Quality**
- No TODO.
- No FIXME.
- No placeholder implementation.
- No dead code.
- No unused helpers.
- No unnecessary abstractions.

**Architecture**
- Existing project conventions are respected.
- Existing structure is reused.
- No unnecessary files were added.
- No unnecessary public APIs were introduced.

**Maintainability**
- Functions are cohesive.
- Names are meaningful.
- Code is readable.
- Duplication is preferred over premature abstraction.

**Safety**
- Existing behavior outside ATDD remains unchanged.

Ask the subagent to perform a self-review against every item above before
returning (see 2c).

### 2c. Subagent Output Contract

Ask the subagent's final report to contain:
1. Files created.
2. Files modified.
3. Acceptance Criteria coverage.
4. Remaining limitations.
5. Assumptions.
6. CAVEMAN review.

For the CAVEMAN review part of the report:
- Files added
- New abstractions
- New helper functions
- New public APIs
- Complexity justification

Every new file and abstraction must include a short justification. If no
justification exists, it shouldn't have been created — flag this in your own
step 5 review if the subagent's report is missing one.

### 3. State the target directory before delegating
Same failure mode risk as any file-writing delegation: the subagent must be
told exactly where the project root is, in absolute terms — never let it
guess. Before launching the subagent:
1. State out loud (to the user, one line) which absolute directory the
   implementation files live under, e.g. "hedef proje kökü: `<absolute
   path>`, dosyalar: `app/login/page.tsx`, ...". This comes from
   atdd.md's/plan.md's own path references — never guess it.
2. Include that absolute path explicitly in the subagent's prompt as the
   project root, and tell it to write files relative to that root — not
   relative to wherever it happens to start.

### 4. Delegate authoring to a subagent
Use the `Agent` tool (subagent_type: `general-purpose`, or `claude` if that's
the only general-purpose type available) — never `run_in_background: false`
unless you're about to immediately review the result and have nothing else
useful to do meanwhile. The prompt must be self-contained (the subagent has
no memory of this conversation):

```
Agent({
  description: "Implement <task-slug> (login sayfası vb.)",
  subagent_type: "general-purpose",
  prompt: (
    "You are implementing a feature for an ATDD pipeline. Write ONLY "
    "implementation files, no test files.\n\n"
    "PROJECT ROOT (absolute, write everything relative to this): <root>\n\n"
    "TASK SPEC:\n<task spec from step 2>\n\n"
    "CAVEMAN PRINCIPLES:\n<step 2a>\n\n"
    "DEFINITION OF DONE:\n<step 2b>\n\n"
    "OUTPUT CONTRACT — your final report must contain:\n<step 2c>"
  )
})
```

Tell the user before this call that it's a real multi-file authoring session
— **make this call once**, not speculatively; get the project root and file
list right first (step 3) instead of finding out via a wasted run.

### 5. Verify — never trust the subagent's own summary at face value
- Run `git status --short <dir>` (or list the target dir) on the REAL
  project files first — confirm something actually changed on disk before
  reading further. An empty/unexpected result means the subagent wrote to
  the wrong place or failed silently; don't re-launch yet — investigate
  first.
- `Read` the files the subagent touched. Check each Acceptance Criteria from
  atdd.md against what's actually there — this is read-only review, not
  authoring. The subagent's own summary is a claim, not evidence — the
  `Read` is the evidence.
- Check the result against **Definition of Done** (2b): any TODO/FIXME/
  placeholder/dead code/unused helper, any file or abstraction without a
  stated justification (2c), or any out-of-scope addition is a finding —
  don't silently accept it, launch a follow-up subagent call (via
  `SendMessage` to continue the same agent, or a fresh `Agent` call with a
  sharper prompt) naming exactly what to remove/simplify.
- Write `artifacts/<task-slug>/code_diff.md`, built from the
  subagent's own final report plus what `Read` actually confirmed. This is a
  report, not code, so `Write` is fine here.

### 6. Hand off to test-copilot
Tell the user the implementation is done and the next step is the
`test-copilot` skill, which will write tests against these same files.

## The one rule that can't bend
Every line of implementation code comes from the delegated subagent, not
from the orchestrating Claude session directly. If something looks wrong
after step 5's review, the fix is delegating again with a sharper prompt —
not `Edit`-ing the file directly, even for "just a typo" or "just one line."
