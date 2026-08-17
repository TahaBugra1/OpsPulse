---
name: code
description: "DEPRECATED — use code-copilot."
---

# Deprecated

This skill no longer writes implementation.

Implementation is handled exclusively by `code-copilot`.

## Pipeline

```
ATDD
→ code-copilot
→ test-copilot
→ verify
→ red-team
→ commit
```

## Rules

- Never write or edit implementation files.
- Never create test files.
- Never perform review.
- Never continue this workflow.

If this skill is invoked, tell the user to use:

`/code-copilot`

Do nothing else.
