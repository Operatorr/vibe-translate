---
name: deep-review
description: Perform a maximally thorough, CodeRabbit-style code review that fans out one focused sub-agent per changed file, runs independent Standards and Spec reviewers, runs every available linter/SAST/secret scanner, and reports every substantive issue from Critical down to Low. Use for /deep-review or when the user asks for a deep, exhaustive, or thorough review, a CodeRabbit-style review, to "find everything", to "leave no stone unturned", or wants maximum coverage on a PR or branch. Optimizes for recall; excludes cosmetic and subjective style feedback. For bounded bug hunting without per-file fan-out or a scanner battery, use code-review instead.
---

# Deep Review

Review code like a relentless automated reviewer. Fan out a fresh, focused sub-agent for every changed file so no file inherits the leftover attention of a single pass, check the change against the repository's documented standards and its spec with independent reviewers, run every deterministic check available, resolve cross-file impact, and surface every substantive finding from Critical down to Low.

This skill optimizes for **recall, not precision**, on issues with a concrete consequence. Uncertain-but-plausible defects are welcome; cosmetic and subjective style feedback is not. For a bounded review without per-file fan-out or a scanner battery, use the `code-review` skill instead — `deep-review` is its thorough counterpart. Both share the same three axes: **Bugs**, **Standards**, and **Spec**.

## Use Cases

```bash
/deep-review https://github.com/OWNER/REPO/pull/123
Exhaustively review PR #123 — find everything
/skill:deep-review https://github.com/OWNER/REPO/pull/123
CodeRabbit-style deep review of the current branch
Thorough review of this PR against specs/invitations.md, post the summary
Exhaustive review of these local changes, terminal only
```

## Principles

- **Recall over precision.** Under-reporting real defects is the failure mode to avoid. Let severity tiers — not omission — communicate importance. There is no finding quota; never pad the report to reach a count.
- **No nitpicks.** Skip cosmetic and subjective style: naming preferences, formatting, import order, comment wording, grammar in code comments, and micro-refactors without a concrete consequence. A finding needs a consequence a maintainer or user would actually experience. The exception is a documented repository rule (`REVIEW.md`, `CODING_STANDARDS.md`, `CONTRIBUTING.md`, agent instructions) that mandates the style — report that under **Standards** with the rule quoted, unless a configured linter already enforces it.
- **Three axes.** **Bugs** (per-file fan-out plus tools), **Standards** (documented repo rules and invariants), and **Spec** (documented requirements). Standards and Spec each get an independent reviewer, so one axis passing never cancels another's failure.
- **Report low-severity findings individually.** Never collapse, summarize, or count-away Low issues. Every finding gets its own entry.
- **Fresh attention per file.** Never rely on one holistic pass. Each changed file (or small batch) gets a dedicated sub-agent with the full checklist, so no file inherits "salience collapse" from earlier files.
- **Run every available deterministic check.** Linters, type-checkers, SAST, and secret scanners are first-class inputs, not optional. Prefer one-shot runners (`npx --yes`, `uvx`) so "not installed" rarely means "skipped".
- **Be specific and actionable.** Thoroughness must not mean vagueness. Every finding includes the exact file/location, impact, and a concrete fix.
- **Review only by default.** Do not edit code unless the user explicitly asks you to fix the issues.
- **Posting rules (same as `code-review`):** A direct GitHub PR URL grants permission to post. PR numbers, branch reviews, file-only reviews, and local reviews are terminal-only unless the user explicitly asks to post. Any "do not post", "review only", or "terminal only" wording overrides everything.

> **Do not apply `code-review`'s bounds here.** Fan out per file, run the full tool battery, and report plausible defects with medium or low confidence (marked as such) instead of dropping them. Like `code-review`, omit cosmetic Nit feedback.

## Workflow

Follow every phase for each review.

### Phase 0: Establish Target & Output Destination

Determine the review target (a GitHub PR, the current branch vs a base, uncommitted changes, or a specific set of files) and the output destination.

Output destination rules (identical to `code-review`):

1. Direct GitHub PR URL (`https://github.com/OWNER/REPO/pull/123`) — post by default.
2. PR number or shorthand (`PR #123`) — terminal only unless the user asks to post.
3. Local branch, uncommitted, or file-only review — terminal only unless the user asks to post and provides a PR target.
4. Any "do not post" / "terminal only" wording — terminal only.

When posting is enabled, post **exactly one summary comment** on the PR. Never post inline review comments or a PR review — every finding lives inside the summary comment.

### Phase 1: Gather the Diff & Build the Changed-File Manifest

For GitHub PRs, run `gh auth status` first, then gather metadata and diff:

```bash
gh pr view <url-or-number> --json title,body,author,baseRefName,headRefName,files,commits,url
gh pr diff <url-or-number>
```

For local branches:

```bash
git status --short
git branch --show-current
git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main
git diff <merge-base>...HEAD --name-status
git diff <merge-base>...HEAD
```

Adjust the base branch if the repo's default is not `main`/`master`.

Build a **changed-file manifest**. For each changed file, record:

- `path`
- `change_type` (added / modified / deleted / renamed)
- `language` (from extension)
- `hunk_ranges` — the changed line ranges parsed from each `@@ -a,b +c,d @@` header

Keep the `hunk_ranges` — Phase 4 hands them to the sub-agents as their assigned changed line ranges.

### Phase 2: Build the Repo-Context Packet & Locate the Spec

Read project standards in this priority order (highest first):

1. `REVIEW.md` in the target repo root
2. `CLAUDE.md`, `AGENTS.md`, `.claude.md`, or equivalent agent instructions
3. `CODING_STANDARDS.md`, `CONTRIBUTING.md`, architecture docs, ADRs
4. Package/tooling manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, …)
5. Nearby tests and similar implementations

Treat the target repo's `REVIEW.md` as the highest-priority rules. Record the source path and lines of each rule so reviewers can quote them rather than rely only on a paraphrased digest.

Find the spec from an explicit user path/link first, then the PR body and linked issues, commit issue references via the configured tracker, and matching documents under `docs/`, `specs/`, or `.scratch/`. Use actual requirement text, not requirements inferred from the implementation. Distinguish binding requirements from discussion or proposals. If sources conflict, report the ambiguity instead of choosing silently. If none is available, mark Spec **no spec available** and skip the Spec reviewer; do not block the rest of the review.

Assemble one compact **context packet** to hand to every sub-agent (a cheap stand-in for whole-repo indexing):

- **Standards digest** — key rules extracted from `REVIEW.md` / agent instructions / `CODING_STANDARDS.md` / `CONTRIBUTING.md`, each with its `path:line`.
- **Stack summary** — languages, frameworks, test runner, lint configs present.
- **Conventions digest** — naming, error-handling, and test patterns observed in nearby files.
- **Symbol/caller index** — for each exported or imported symbol touched by the diff, the grep-derived list of other files referencing it, so each per-file agent knows its blast radius. Build with read-only `git grep` scoped to symbols appearing in the diff.

### Phase 3: Run the Tool Battery

Detect languages/file types from the manifest and run every matching available linter, type-checker, SAST scanner, and secret scanner. See `TOOL_BATTERY.md` for the full detection-and-runner matrix and the install policy.

Policy summary:

- Prefer one-shot runners (`npx --yes …`, `uvx …`, `docker run …`). These are ephemeral and run without asking.
- Never run a global install (`npm i -g`, `pip install`, `brew install`, `go install`) without explicit permission. If declined, mark the tool `skipped (not installed)` in statistics and continue.
- Check mode only — never `--fix` / `--write`. This skill reviews; it does not edit.
- Scope runs to changed paths where the tool supports it.

Normalize every tool result into the shared finding shape (see `REFERENCE.md`): `path`, `line`, `category`, `rule_id`, `message`, `source: <tool>`.

### Phase 4: Fan Out Per-File and Axis Review Sub-Agents

This is the structural core of the skill. Partition the manifest into per-file review tasks, add the two whole-change axis reviewers, and dispatch them.

**Task split:**

- One file = one task by default.
- **Batch** tiny files (each under ~40 changed lines) so one sub-agent handles up to ~5 files or ~400 total changed lines.
- **Split** any file with more than ~600 changed lines into multiple hunk-range tasks so no agent reviews more than it can hold with fresh attention. (Large means *more* agents, not fewer findings.)
- **Skip** lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`, `go.sum`), pure deletions, and generated/vendored paths — no LLM agent (tools may still scan them).

**Axis reviewers:** add one **Standards** reviewer and, when a spec exists, one **Spec** reviewer. Each reviews the whole change, not one file, using its brief in `SUBAGENT_PROMPT.md`. Give them the pinned snapshot, the manifest and diff, and the source locations of the rules or requirements. Do not give them per-file findings, your suspected findings, or the author's reasoning. They must stay independent.

**Dispatch:** run sub-agents (the Agent tool, read-only) in **parallel waves of up to 5**. Put the axis reviewers in the first wave. Dispatch a wave, wait for it to return, dispatch the next, until the task list is exhausted.

**Each per-file sub-agent receives** (assemble the prompt from `SUBAGENT_PROMPT.md`):

1. Its assigned file path(s) and changed line ranges.
2. The file's diff hunks.
3. The Phase 2 context packet.
4. Any Phase 3 tool findings already scoped to its file(s) — to confirm/expand, not miss.
5. The full category checklist (see below).
6. Anti-collapse instructions and the fixed output schema (both in `SUBAGENT_PROMPT.md`).

### Phase 5: Aggregate, Ground & Dedupe

Collect all per-file and axis sub-agent findings plus all normalized tool findings into one list keyed by `(path, line-range, category)`. Then:

1. **Dedupe** in three layers:
   - Exact/near-exact location + same category → keep the richer entry.
   - Tool-vs-LLM overlap (same defect, same place) → merge into one entry tagged `confirmed-by-tool` (raises confidence).
   - Same root cause reported from multiple call sites → merge with an "also affects" list.
   - Same root cause on multiple axes (for example a per-file bug that also breaches a documented rule or a requirement) → keep the full finding in its primary axis and cross-reference it from the others.
2. **Resolve cross-file context** — for each finding carrying `cross_file_refs`, read/grep the referenced call sites to confirm impact. A changed signature that breaks an unseen caller becomes its own High finding.
3. **Verify axis claims** — for Standards, confirm the quoted rule exists and applies to the changed code; for Spec, confirm the requirement citation and the implementation trace. A Standards finding without a quoted rule must be labelled `possible <smell> (judgement call)` and name a concrete maintenance risk, or be dropped.
4. **Drop nitpicks** — remove any finding whose only consequence is cosmetic or a matter of taste (see Principles). This includes style/format tool findings and per-file findings that slipped through. Do not raise severity to keep one.
5. **Normalize severity** — sub-agent severities are advisory; assign final tiers consistently across the whole report.
6. **Group and order** findings by axis (Bugs, Standards, Spec), then Critical → High → Medium → Low, then by file and line.
7. **Count** per-axis and per-tier totals. Do **not** drop or summarize the Low tier.

### Phase 6: Self-Critique Re-Scan

Before producing output, run a structured re-scan (read-only):

1. **Coverage matrix** — build a `(changed file) × (category)` grid. Re-examine any empty cell for a substantial file ("file X produced zero findings — re-read it for error paths, tests, stale docs"; "no Security findings anywhere — re-scan auth/input/secret surfaces").
2. **Tool reconciliation** — confirm every tool that ran was folded in and listed in statistics; none silently dropped.
3. **Cross-file completeness** — confirm every `cross_file_refs` was resolved and every signature/contract change has a finding.
4. **Axis completeness** — confirm the Standards reviewer covered every applicable rule source, and the Spec requirement map has a status for every requirement. A partial or blocked axis is reported as `incomplete`, never as clean.
5. **Count sanity check** — on a non-trivial PR, a near-empty report signals under-reporting; re-run a targeted pass over the largest changed files for error handling, boundary cases, and contract drift. Do not fill the gap with cosmetic feedback.

Merge any new findings through Phase 5's dedupe.

### Phase 7: Output

Produce the terminal report (always) and, when posting is permitted, the GitHub output. See the Output Format and GitHub Posting sections below, with full templates in `REFERENCE.md`.

## Category Checklist

Every per-file sub-agent applies all of these. Each finding needs a concrete consequence; cosmetic and subjective style is out of scope (see Principles).

1. **Correctness** — logic errors, wrong assumptions, off-by-one, broken edge cases, race conditions, bad state transitions, incorrect error propagation.
2. **Security** — auth/authz, injection, unsafe input, secrets, SSRF, XSS, unsafe deserialization, sensitive logging, insecure defaults.
3. **Reliability** — error handling, retries, idempotency, null/undefined handling, resource cleanup, timeouts, partial-failure behavior.
4. **Data & API compatibility** — migrations, schema changes, response-shape changes, backward compatibility, contract drift.
5. **Tests** — missing coverage for new logic, missing regression/edge-case tests, weak assertions, untested error paths, flaky patterns.
6. **Performance** — N+1 queries, hot-path regressions, unnecessary allocations/work, missing pagination/batching, sync work in async paths.
7. **Maintainability** — duplication likely to drift, dead code, leaky abstractions, misleading names (a name that contradicts behavior), complexity that hides a real defect risk. Name the specific likely fault; a smell name alone is not a finding.
8. **Docs & user-facing text** — stale or misleading doc comments, README, or changelog that would mislead a reader; missing docs the project requires; typos or wrong wording in user-visible UI, error, or log strings.

## Severity Scale

- **Critical** — security vulnerability, data loss, production crash, auth bypass, major regression, leaked secret.
- **High** — logic bug, missing critical error handling, broken feature, serious performance issue, breaking API/contract change.
- **Medium** — missing test for a named regression scenario, maintainability risk likely to cause a future bug, documented rule or requirement breach that impairs a supported flow, minor behavior issue.
- **Low** — verified minor defect, stale or misleading docs, user-visible text error, or an explicit rule/requirement violation with a concrete but small consequence. Non-blocking by default unless a repo rule makes it blocking.

There is no Nitpick tier. Emit one entry per Low finding; the report must list every Low item (collapsed for GitHub, never dropped).

## Output Format

Start with a short overall assessment, then list findings under separate **Bugs**, **Standards**, and **Spec** sections, each ordered highest to lowest severity. Include the Spec requirement map. Close with the worst issue per axis (or `none confirmed`, `no spec available`, `incomplete`), then the closing blocks (PR Summary, Recommendations, Statistics) defined in `REFERENCE.md`. Do not blend the axes into one score. The statistics block must report files changed, sub-agents/waves run, issues per axis and per tier, rule and requirement sources used, tools run with pass/fail/skipped, and the tool-confirmed count.

If no issues are found on an axis, say so clearly — but on a non-trivial PR treat that as a signal to re-run Phase 6 before concluding.

## GitHub PR Posting

When posting is permitted, post **one summary comment and nothing else** (see `REFERENCE.md` for the template and exact commands).

1. Run `gh auth status`. On failure or `gh` missing, print the full review to terminal with the reason.
2. **Summary comment** — one comment via `gh pr comment <url-or-number> --body-file <tmp.md>` with the overall assessment and statistics, then a section per axis: each Critical/High/Medium finding in its own `<details>`, and one collapsed `Low-severity findings` `<details>` per axis wrapping each Low finding individually.
3. **No inline comments, no PR review.** Do not call `gh api repos/OWNER/REPO/pulls/<n>/reviews` or `gh pr review`. A review with a `comments` array creates a resolvable conversation per finding and duplicates the summary; the single comment already carries every finding with its `path:line`.
4. If posting fails, print the full review to terminal with the error.
