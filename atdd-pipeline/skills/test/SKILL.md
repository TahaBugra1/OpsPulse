---
name: test
description: "DEPRECATED — do not use. Test generation lives in test-copilot. Running/checking anything lives in verify (build/lint/type/unit/e2e/accessibility/security gates, no authoring)."
---

# Test Skill — DEPRECATED, fully retired

This skill is not used. It has no steps.

- Need tests written for an ATDD task? Use **`test-copilot`** — it converts
  `atdd.md` + `code_diff.md` into a task JSON, calls GitHub Copilot once to
  write the test files, and confirms they landed in the right place. It does
  not run anything and does not judge quality.
- Need to verify a change actually works (build, lint, types, unit/e2e tests,
  accessibility, security scan, etc.)? Use **`verify`** — it runs the real
  gate checklist against the project and reports PASS/FAIL/N/A per gate,
  never authoring or fixing anything itself.

The old single-skill design (write tests + run pytest + a review gate, all in
one call) mixed authoring and verification in one step, making partial
retries wasteful — that's why it was split. Do not resurrect the old steps
here — they're gone, not paused.
