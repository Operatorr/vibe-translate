---
name: code-review
description: "Perform a thorough single-pass code review for GitHub pull requests or local branch changes that aims to find every Critical, High, and Medium issue while skipping Low/Nit noise. Use for /code-review, standard PR reviews, current-branch reviews, and default review requests when the user has not asked for a deep, exhaustive, CodeRabbit-style, nitpick-level, or find-everything review. Report all material findings; use deep-review for per-file sub-agent fan-out, full scanner batteries, and nitpick coverage."
---

# Code Review

Review like a careful senior engineer who is expected to catch the real problems in one sitting: understand the intent, read every changed file with enough surrounding context to verify behavior, walk a fixed checklist per file, and report every Critical, High, and Medium finding you can back with evidence.

This is the default review skill for `/code-review`. It optimizes for **full recall of material issues with low noise**. There is no cap on findings: a non-trivial PR with 6 real Medium-or-higher issues should produce 6 findings. What it still leaves out is Low/Nit coverage, per-file sub-agent fan-out, and the linter/SAST battery, all of which belong to `deep-review`.

## Use Cases

```bash
/code-review https://github.com/OWNER/REPO/pull/123
/skill:code-review https://github.com/OWNER/REPO/pull/123
Review PR #123
Review the current branch against main
Do a security-focused review of this PR
Review these local changes but do not post to GitHub
```

## Principles

- **Find every Critical, High, and Medium issue.** Missing a real bug is the failure mode to avoid. Do not stop after the first few findings, and do not cap the report.
- **Evidence over speculation.** Every finding must be grounded in the diff or in code you actually read. If you suspect an issue but cannot confirm it from the code, either read more code to confirm it or leave it out. Do not pad with hedged guesses.
- **Cover every changed file.** Each changed source file gets the full checklist below. Do not let a large file early in the diff exhaust your attention for later ones.
- **Follow the blast radius.** When a signature, contract, schema, or shared helper changes, grep for its callers and check them. Broken callers outside the diff are in scope.
- **Skip Low/Nit.** Naming, formatting, import order, wording, docs, and micro-refactors are out of scope unless an explicit project rule makes them merge-blocking.
- **Do not fan out sub-agents or run the `deep-review` tool battery.** This is a single-agent review.
- **Be specific and actionable.** Every finding includes the exact file/location, impact, and a concrete fix.
- **Review only by default.** Do not edit code unless the user explicitly asks you to fix the issues.
- Treat a direct GitHub PR URL as permission to post the completed review back to that PR, unless the user says not to post.
- Keep local branch reviews, file-only reviews, and non-URL PR references terminal-only unless the user explicitly asks to post.
- User wording such as "do not post", "review only", "don't comment", or "terminal only" overrides any posting permission.

## Workflow

Follow this process for every review.

### Phase 1: Establish the Review Target

Determine both the review target and the output destination. Review targets can be:

1. A GitHub PR, e.g. `PR #123`
2. The current branch against a base branch, usually `main` or `master`
3. Uncommitted local changes
4. A specific set of files

Output destination rules:

1. Direct GitHub PR URL, e.g. `https://github.com/OWNER/REPO/pull/123` — post one PR comment by default.
2. GitHub PR number or shorthand, e.g. `PR #123` — print to terminal unless the user explicitly asks to post.
3. Local branch, uncommitted, or file-only review — print to terminal unless the user explicitly asks to post and provides a PR target.
4. Any explicit "do not post" wording — print to terminal only.

For direct GitHub PR URLs with posting enabled, run `gh auth status` before resolving PR metadata. If `gh` is unavailable or auth fails, mark posting unavailable, continue terminal-only when the PR diff can still be gathered, and include the failure reason with the terminal review.

For GitHub PRs, gather PR metadata and diff with `gh` when available. Use the PR URL when one was provided:

```bash
gh auth status
gh pr view <url-or-number> --json title,body,author,baseRefName,headRefName,files,commits,url
gh pr diff <url-or-number>
```

For local branch reviews, inspect the merge base and diff:

```bash
git status --short
git branch --show-current
git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main
git diff <merge-base>...HEAD --name-status
git diff <merge-base>...HEAD
```

Adjust the base branch if the repository uses a different default branch.

Build a short **changed-file list** from `--name-status`: path, change type, and rough size. Skip lockfiles, generated, and vendored paths from manual review. This list drives Phase 4 and Phase 5.

### Phase 2: Gather Project Context

Read the changed files in full, not just the hunks, when the file is under roughly 500 lines; for larger files read the changed functions plus every function they call or are called by. Check project standards in this priority order:

1. `REVIEW.md` in the target repository root, if present
2. `CLAUDE.md`, `.claude.md`, or equivalent agent instructions
3. `CONTRIBUTING.md`, coding standards, architecture docs, ADRs
4. Package/tooling files such as `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.
5. Existing nearby tests and similar implementations

Treat the target repo's `REVIEW.md` as the highest-priority review rules.

Then build a small **caller index**: for every exported or shared symbol whose signature, return shape, or semantics the diff changes, run a read-only `git grep` for its usages and note the call sites you need to check in Phase 4.

If this skill's bundled reference files are available, use them as support material:

- `REFERENCE.md` — examples, output templates, severity guidance
- `PROJECT_REVIEW_TEMPLATE.md` — starter `REVIEW.md` users can copy into a project

### Phase 3: Run Available Checks

Run the already-configured checks that directly cover the changed area:

- Type checks
- Unit tests for changed areas
- Linters/format checks

Do not install tools, invoke one-shot package downloads, run broad scanner batteries, or run expensive full-suite checks by default. If the right check is too expensive or unavailable, note that it was not run and continue with manual review. Any failing check that relates to the diff becomes a finding.

### Phase 4: Review Every File Against the Checklist

Work through the changed-file list one file at a time. For each file, walk every category below and write down what you checked, even when the answer is "nothing found". Then check the call sites recorded in the caller index for that file's changed symbols.

1. **Intent** — What is this file's change trying to accomplish, and does the code actually do that? Compare against the PR description, issue, or commit messages.
2. **Correctness** — logic errors, inverted conditions, off-by-one, wrong operator or variable, broken edge cases (empty, zero, negative, unicode, very large, concurrent), race conditions, bad state transitions, incorrect error propagation, wrong async/await or promise handling, mutation of shared state.
3. **Security** — auth/authz on every new or changed entry point, injection (SQL, shell, template, path), unsafe input handling, secrets or credentials in code or logs, SSRF, XSS, unsafe deserialization, insecure defaults, missing rate limiting on sensitive actions, privilege escalation, sensitive data in logs or responses.
4. **Reliability** — unhandled errors, swallowed exceptions, missing retries or timeouts on external calls, non-idempotent operations that can be retried, null/undefined handling, resource cleanup (files, connections, listeners, subscriptions), partial-failure behavior, unbounded loops or recursion.
5. **Data & API compatibility** — migrations (reversibility, locking, data backfill), schema changes, response-shape or contract changes, breaking changes to public functions, serialization format changes, feature flags and rollout safety.
6. **Testing** — new behavior with no test, changed behavior whose existing test still passes only because it does not cover the change, tests that assert nothing meaningful, tests that were deleted or weakened, untested error paths.
7. **Performance** — N+1 queries, hot-path regressions, unnecessary expensive work, missing pagination or batching, sync work in async paths, unbounded memory growth, blocking I/O on request paths.
8. **Maintainability** — only concrete complexity, duplication, or inconsistency that is likely to cause bugs. Reserve this for Medium; if it is only cosmetic, drop it.

For large PRs, review the highest-risk files first (auth, data access, migrations, shared helpers, public APIs), then continue through every remaining file. Do not sample. If the change is genuinely too large to review every file with care in one pass, say so explicitly in the report, list which files were reviewed and which were not, and recommend `/deep-review` for the remainder.

### Phase 5: Coverage Check Before Writing

Before producing output, do one structured re-scan:

1. **File coverage** — confirm every file in the changed-file list was reviewed. Any substantial file with zero findings gets a second look at Correctness, Security, and Testing.
2. **Category coverage** — if the whole review has no Security findings, re-read every new or changed entry point, input parser, and data access path. If it has no Testing findings, confirm each new behavior actually has a test.
3. **Caller coverage** — confirm every entry in the caller index was checked.
4. **Evidence check** — for each finding, confirm you can point to the exact lines that prove it. Drop anything you cannot.
5. **Severity check** — apply the severity scale below consistently across all findings. Demote anything that is really Low/Nit and remove it.

Suppression rules:

- Omit Low/Nit findings.
- Report missing tests only when a specific new or changed behavior clearly needs coverage.
- Do not report issues that require assumptions about undocumented product requirements.
- Do not summarize minor issues as a list; leave them for `deep-review`.

## Severity Scale

- **Critical** — security vulnerability, data loss, production crash, auth bypass, major regression, leaked secret
- **High** — logic bug, missing critical error handling, broken feature, serious performance issue, breaking API/contract change, broken caller outside the diff
- **Medium** — missing test for a concrete regression risk, maintainability risk likely to cause future bugs, minor behavior issue, error path that degrades badly
- **Low/Nit** — out of scope for `code-review`; use only for explicit project-rule violations that should block merge

Rule of thumb: if you would ask for it to be fixed before merging, it is Medium or higher and belongs in the report. If you would let it merge and mention it in passing, leave it out.

## Output Format

Start with a short overall assessment. Then list every finding from highest to lowest severity. Do not cap the number of findings.

For every issue, use this format:

````markdown
## [Severity] Issue: [Short descriptive title]

**File:** `path/to/file.ext:line-range`
**Category:** Bug | Security | Logic | Reliability | Compatibility | Testing | Performance | Maintainability

**Problem:**
[Clear 1-2 sentence explanation of what is wrong and why it matters.]

**Impact:**
[Specific consequence if this is not fixed.]

**Suggested Fix:**
```diff
[Exact unified diff, or a precise before/after code block if a diff is not practical.]
```

**Handoff Prompt:**
```
In the file `path/to/file.ext`, around lines X-Y:

[Detailed, self-contained instruction explaining the exact change needed, why it is required, edge cases to consider, and how to verify it. Reference relevant project patterns if applicable.]

Only modify the necessary lines. Keep unrelated code unchanged.
```
````

After all issues, include:

```markdown
### PR Summary
[2-4 sentence overview of the change and overall assessment.]

### Recommendations
- [ ] Highest-priority fixes before merge
- [ ] Tests to add or run
- [ ] Optional improvements

### Coverage
- Files reviewed: X of Y (list any skipped files and why)
- Callers checked: [symbols whose call sites were verified, or "none changed"]

### Statistics
- Files changed: X
- Issues found: Y (Critical: A, High: B, Medium: C)
- Checks run: [commands or "not run"]
```

If no issues are found, say so clearly, list what was checked in the Coverage block, and include a brief positive summary of what looked good.

## GitHub PR Posting

When posting is permitted, use one normal PR comment by default. Do not create inline comments unless the user explicitly asks for them.

Posting workflow:

1. Run `gh auth status`.
2. If auth fails or `gh` is unavailable, print the full review to the terminal and include the failure reason.
3. Resolve PR metadata with `gh pr view <url-or-number> --json title,body,author,baseRefName,headRefName,files,commits,url`.
4. Generate the same findings and overall assessment you would produce for a terminal review.
5. Write the GitHub comment body to a temporary Markdown file.
6. Post with `gh pr comment <url-or-number> --body-file <tmp-review.md>`.
7. If posting fails, print the full review to the terminal and include the posting error.

The posted comment must include the summary, coverage, and statistics at the top, followed by one collapsible `<details>` section per finding. Each `<summary>` line must use:

```markdown
[Severity] File:line - issue title
```

Each details section must include the problem, impact, suggested fix, and handoff prompt. See `REFERENCE.md` for the exact GitHub comment template and fallback commands.

For terminal-only reviews, use the standard output format above.
