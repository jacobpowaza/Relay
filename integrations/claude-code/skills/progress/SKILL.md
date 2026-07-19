---
description: Use Relay progress-board state for long-running coding tasks, resumptions, handoffs, checkpoints, blockers, and card-by-card execution.
---

# Relay Progress

Relay board is persistent source of truth for long-running work. Repository code is source of truth for implementation state.

## Token-saving goal

Relay saves tokens during **context persistence, session handoffs, and task
resumption** — it is a compact handoff note from the previous session, not a
replacement for reading the repository.

Without Relay a new session would reread the whole plan, inspect every card,
replay notes, search the repo, and reconstruct what happened. With Relay it
immediately knows: active card, changed files, test state, decisions, next step.
Then it opens only those relevant files, verifies them against Git, and
continues.

**What Relay saves tokens on:**
- Rebuilding context from zero every session
- Storing redundant or duplicate checkpoint data
- Loading full board history, timeline, notes, and plans into each resume
- Unbounded context growth from repeated checkpoints

**What Relay does NOT save tokens on:**
- Reading source files that are actually needed for the active card
- Verifying Git state, diffs, and test output before editing
- Broad repository inspection when context is stale, files moved, or
  architecture changed
- Normal code exploration required to implement the task

The budget-enforced resume (≤3,000 estimated tokens), content-hash dedup,
context compaction, and diagnostics command all exist to keep the handoff
compact. They do not exist to avoid reading code.

At session start, use hook-provided bootstrap first. Then run the plugin command
instead of writing repository-local state:

```sh
node "$HOME/.claude/plugins/cache/relay-local/relay-progress/0.1.0/scripts/relay-progress.mjs" status --cwd "$PWD"
```

When the user gives a specific task to track, create a NEW board for it (this
is the default). Pipe the full original user request:

```sh
printf '%s' "$ORIGINAL_USER_REQUEST" | node "$HOME/.claude/plugins/cache/relay-local/relay-progress/0.1.0/scripts/relay-progress.mjs" create-board --cwd "$PWD" --title "$PROJECT_OR_FEATURE_NAME"
```

`create-board` is a single verified transaction: it creates the board through
Relay app-owned storage, reads it back to confirm persistence, and only then
prints `{"ok":true,"boardId":...,"verified":true,...}`. On failure it prints
`{"ok":false,"stage":...,"error":...}`, exits non-zero, and preserves the plan
under `~/.relay/integrations/pending/` for retry. Never report success unless
`ok` is `true`.

The board is identified by a stable `taskId` derived from the repository key and
board title. The `taskId` is persisted when the board is created and returned in
the command output. Pass `--task-id <id>` on subsequent calls to resume the same
board — even when the request wording changes.

Auto-continuation: when the repository already has a linked board and the request
looks like a continuation ("continue", "resume", "keep working", a short
statement, etc.), the plugin automatically resumes the existing board. Only
structured multi-section requests with clear plan headings create a separate
board. Explicit `--board-id` or `--task-id` always takes precedence.

Initial card generation is automatic based on request complexity:
- Small (simple request): 1-3 cards with ~2 phases
- Medium (moderate request): 4-8 cards with ~6 phases
- Large (complex multi-section request): 8-20 cards with ~10 phases

Cards use distinct phase names (Foundation, Updates, macOS, Windows, Performance,
Testing, Documentation, etc.) — never multiple "Planning" groups. The full
original prompt is saved in `board.originalPrompt` and the plan in `board.plan`.
Initial card creation is batched into a single timeline event.

To explicitly continue a board by name or ID:

```sh
printf '%s' "$ORIGINAL_USER_REQUEST" | node "$HOME/.claude/plugins/cache/relay-local/relay-progress/0.1.0/scripts/relay-progress.mjs" create-board --cwd "$PWD" --task-id "$TASK_ID"
printf '%s' "$ORIGINAL_USER_REQUEST" | node "$HOME/.claude/plugins/cache/relay-local/relay-progress/0.1.0/scripts/relay-progress.mjs" create-board --cwd "$PWD" --continue-board "$BOARD_NAME"
```

This writes only to:

- `~/Library/Application Support/Relay/relay-data/workspace.json`
- `~/.relay/integrations/config.json`

After that, load only focused board summary: project summary, active phase,
active card, blockers, recent decisions, Git state, recommended next action.

Use the Relay flow commands for context building instead of free-form files:

```sh
node "$HOME/.claude/plugins/cache/relay-local/relay-progress/0.1.0/scripts/relay-progress.mjs" create-card --cwd "$PWD" --title "$CARD_TITLE" --column Ready --tags ui,api < card-context.json
node "$HOME/.claude/plugins/cache/relay-local/relay-progress/0.1.0/scripts/relay-progress.mjs" add-note --cwd "$PWD" --card-id "$CARD_ID" < note.txt
node "$HOME/.claude/plugins/cache/relay-local/relay-progress/0.1.0/scripts/relay-progress.mjs" record-context --cwd "$PWD" --title "$CONTEXT_TITLE" --category "Current state" < context.txt
node "$HOME/.claude/plugins/cache/relay-local/relay-progress/0.1.0/scripts/relay-progress.mjs" record-decision --cwd "$PWD" --title "$DECISION_TITLE" < decision.json
node "$HOME/.claude/plugins/cache/relay-local/relay-progress/0.1.0/scripts/relay-progress.mjs" checkpoint --cwd "$PWD" --card-id "$CARD_ID" < checkpoint.json
node "$HOME/.claude/plugins/cache/relay-local/relay-progress/0.1.0/scripts/relay-progress.mjs" repair-board --cwd "$PWD" --board-id "$BOARD_ID"
```

Repair-board merges duplicate phases, deduplicates timeline entries, and removes
generic cards. Run it when the board has structural issues from older sessions.

Checkpoint JSON may include `summary`, `changedFiles`, `commandsRun`, `tests`,
`knownIssues`, `remainingWork`, `nextTask`, `progress`, `blocked`, and
`complete`. Keep entries concise and evidence-based.

Track task when request has multiple phases, large architecture or refactor work, migrations, research then implementation, testing/review/release phases, likely context or usage limits, or cross-agent handoff risk. Tiny fixes and simple questions stay untracked.

## Session resume flow

At session start, load the compact Relay resume, then verify against the real
repository before editing:

1. Load the compact Relay handoff — active card, current state, changed files,
   blockers, next action.
2. Inspect current Git state — branch, diff, commit log, any uncommitted
   changes since the last checkpoint.
3. Read the specific files and symbols referenced in the active card and
   changed-file list. Verify their actual content against what Relay summarised.
4. Run tests relevant to the active card if the checkpoint mentioned test
   results.
5. Confirm Relay state is not stale — if files moved, architecture changed, or
   Git history diverges from what the board describes, treat Relay as a hint
   and re-orient from the repository.
6. Continue implementation on the active card.
7. Save a concise checkpoint before the session ends.

**Do not** automatically rescan the entire repository, reread every file, or
rerun broad codebase exploration when Relay already provides enough context to
resume. The token savings come from not rebuilding from zero — they do not come
from skipping needed code verification.

**Do** read the relevant files. Relay's summary is a handoff note, not a
source-of-truth replacement. Confirm the code, Git diff, tests, and current
state before editing. Expand into broader inspection only when the active task
requires it, the saved context is stale, files moved, architecture changed, or
verification reveals inconsistencies.

Checkpoint when card starts, meaningful code changes land, decision is made, blocker appears, tests run, card completes, card changes, context compaction approaches, or session ends. Record concise evidence: changed files/symbols, commands, test results, known issues, remaining work, Git diff summary, next task. Use `record-context` for durable facts, `record-decision` for accepted/proposed choices, and `add-note` for card-local working notes.

Never upload secrets, `.env` contents, private keys, tokens, cookies, or full sensitive files. Summaries and file references preferred over source snippets.

If Relay is unavailable or the repo is unlinked, do not create substitute board
files in the repository such as `.scratch/board.md`. Do not create markdown
boards, local fallback plans, or checkpoint files in the current repository.
Use the plugin command above to create/link a real Relay board in app-owned
storage, or ask the user before proceeding. Repository scratch files are not
Relay boards.

If a checkpoint cannot be uploaded, save only plugin-owned local queue data under
`~/.relay/integrations/` when available, continue safe coding work, and do not
claim upload succeeded.
