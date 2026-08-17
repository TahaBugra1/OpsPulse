---
name: jira-sync
description: Reads a Jira issue and creates/updates the matching Saga task — the ONLY skill in the pipeline allowed to talk to Jira or Saga. Returns issue summary + AC + saga_task_id for atdd (and later status updates for the tail end of the pipeline). Kept separate from atdd for single responsibility — atdd stays tool-independent.
---

# Jira Sync — Jira + Saga integration only

## Why this exists
Kept separate from `atdd` on purpose: `atdd`'s job is clarifying
requirements, not talking to Jira/Saga — integrations are the piece most
likely to break or change independently, and coupling them to `atdd` would
force every requirements-gathering change to also touch Jira/Saga logic.
This skill's only job is talking to Jira and Saga. It knows nothing about
Acceptance Criteria wording, question counts, or benchmarks — that's
`atdd`'s job, using this skill's output as input.

## Configuration (fill in for your own Jira/Saga instance)
Before using this skill, set:
- **Jira Cloud ID / site** and **project key** for the target Jira project.
- Which epic(s) under that project this pipeline's tasks belong to.
- **Saga project_id** and **epic_id** to file tasks under.

Don't hardcode these into this file from memory or guesswork — look them up
via the Jira/Saga MCP tools (or ask the user) the first time, then reuse
what's confirmed for the rest of the session. Never invent an ID.

## When to call this skill
- `atdd` calls it when the user references a Jira ID ("KAN-14'ten devam",
  "kaldığımız yerden devam") or asks "nerede kaldık" — check Saga FIRST here,
  not conversation history.
- The tail end of the pipeline (after `verify`/`red-team`, or when `commit`
  finishes) calls it to update the Saga task's status — see "Status updates"
  below.

## Steps

### A. Lookup for a new or resumed task (called from `atdd`)
1. **Check Saga first** for an existing open task before doing anything else:
   `mcp__saga__task_list` (configured epic_id, no status filter), or if a
   Jira ID is known, `mcp__saga__tracker_search`. This answers "nerede
   kaldık" — never scan chat history for this, Saga is the source of truth.
2. If a Jira ID was given and no Saga task exists yet for it, fetch the issue
   via the Jira MCP tool's `getJiraIssue` using the configured Cloud ID.
3. **Create the Saga task** (before `atdd.md` itself is written):
   ```
   mcp__saga__task_create({
     epic_id: <configured epic_id>,
     title: "<JIRA-ID>: <short summary>",
     description: "<Jira epic/story full summary + will-be atdd.md path>",
     status: "todo",
     priority: "high" | "medium" | "low",   // mirror Jira's priority exactly
     tags: ["<JIRA-ID>", "epic-N", "atdd"]
   })
   ```
4. **If resuming** (Saga task already exists): `mcp__saga__task_update({id,
   status: "in_progress"})` instead of creating a new one.
5. Return to the caller (`atdd`): Jira issue summary, full AC text verbatim,
   priority, epic link, and the `saga_task_id`. `atdd` embeds this verbatim
   into `atdd.md`'s frontmatter/Jira section — it must not re-query Jira.

### B. Status updates (called after verify/red-team/commit)
Always ask before writing, via `AskUserQuestion`:
```
"<task> için Saga görevini (id: <saga_task_id>) 'review'/'done' olarak
güncelleyeyim mi?"
Seçenekler: "Evet, güncelle" / "Hayır, henüz değil"
```
If yes: `mcp__saga__task_update({id: <saga_task_id>, status: "review"|"done",
actual_hours: <if known>})`. Don't skip asking silently — "nerede kaldık"
answers depend on Saga staying current.

## Rule
- This is the only skill that calls Jira/Saga MCP tools in the pipeline.
  `atdd`, `plan`, `code-copilot`, `test-copilot`, `verify`, `red-team`, and
  `commit` all read the IDs/summary this skill already produced instead of
  querying Jira/Saga themselves.
- Never invent a Jira ID or Saga task_id — if lookup fails, say so and ask
  the user, don't guess.
