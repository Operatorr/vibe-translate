---
name: git-pr
description: Create a feature branch off master/develop/main when needed, commit the work, push, and open a pull request via the gh CLI with a summary-first body, verification evidence, and before/after screenshots for UI changes. Use when the user asks to open a PR, ship changes, or commit and create a pull request.
argument-hint: "Optional summary of the work to ship"
---

# Git PR

Commit the current work and immediately open a pull request. If the current branch is a protected base branch (`master`, `main`, or `develop`), create a feature branch first. Do not ask the user for confirmation — "open a PR" means do it.

A good PR lets a reviewer understand what it solves from the first sentence and see that it works without checking out the branch. One request is one PR.

## Workflow

### 1. Inspect state and repo rules

Run in parallel:

- `git status --short` — what will be staged, including untracked files
- `git diff` and `git diff --stat` — the actual changes
- `git branch --show-current` — the current branch
- `git log -10 --oneline` — the repo's commit and title style
- Look for repo PR rules: `.github/pull_request_template.md` (or `.github/PULL_REQUEST_TEMPLATE/`, `docs/pull_request_template.md`), and the PR sections of `AGENTS.md`, `CLAUDE.md`, and `CONTRIBUTING.md`

Repo rules win over this skill. If the repo has a PR template, fill in its sections instead of the default body below, keeping the summary sentence and evidence rules wherever the template leaves room.

If there is nothing to commit and the branch has no unpushed commits, report that and stop. Do not create an empty commit or an empty PR.

### 2. Keep the PR to one problem

Stage only the work the user asked to ship. Leave out:

- Unrelated edits that happen to be in the working tree — leave them unstaged and say so in the report.
- Secrets and local config (`.env*`, credentials, editor settings).
- PR-only evidence: screenshots, recordings, and scratch notes. They go in the PR body, never in the repository (no `.github/pr-assets/`, no committed `screenshots/`).

If the changes clearly solve two independent problems, report that and ask whether to split them rather than bundling them.

### 3. Resolve the working branch and PR base

- Let `CURRENT` be the output of `git branch --show-current`.
- **If `CURRENT` is `master`, `main`, or `develop`** (a protected base branch):
  - The PR **base** is `CURRENT`.
  - Create a feature branch and switch to it: `git switch -c <type>/<slug>`.
- **Otherwise** (already on a feature branch):
  - Stay on `CURRENT`; do not create a new branch.
  - Determine the PR **base** integration branch:
    - Use `develop` if it exists: `git ls-remote --exit-code --heads origin develop`.
    - Otherwise use the repo default: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.

Build the branch name from the work: `<type>` is `feature`, `fix`, `perf`, `chore`, or `docs`, matching the repo's existing branches; `<slug>` is a short kebab-case summary from the supplied argument or the diff (e.g. `fix/login-redirect`). If the supplied summary contains a task/issue key such as `ABC-123`, include it: `feature/ABC-123-login-redirect`.

### 4. Verify the change

Before pushing, check the behavior the PR changes and record what you observed — this becomes the Verification section.

- Run the repo's fast, focused checks for changed files (the documented pre-push or "check changed" command if there is one; otherwise lint, typecheck, and the tests beside the changed code). Do not run repo-wide suites just to fill this section.
- Bug fixes in logic, data, state, or protocol: a test that fails without the fix is the proof.
- UI changes: capture before/after screenshots (see step 7). A purely visual fix needs captures, not a new UI test.
- Server-only changes with no visible surface: the focused test plus a short runtime transcript or log excerpt when it helps.
- Note anything you could not check and why.

If a check fails because of this change, fix it or report it and stop. Distinguish pre-existing failures from new ones.

### 5. Stage and commit

- Stage the files from step 2 explicitly (`git add <paths>`); use `git add -A` only when every change belongs to this PR.
- Generate a commit message following the **same conventions as the `git-commit` skill**:
  - Subject line ≤ 72 characters summarizing the change.
  - Body of 2–5 sentences focused on the why more than the what.
  - If the branch name contains a task/issue number, start the subject with it.
  - Do not include `Co-Authored-By` lines.
- Commit using a HEREDOC so formatting is preserved:

  ```sh
  git commit -m "$(cat <<'EOF'
  <subject>

  <body>
  EOF
  )"
  ```

### 6. Push the branch

```sh
git push -u origin <branch>
```

### 7. Prepare before/after evidence (UI changes)

Any change a user can see needs before/after screenshots. Add a short recording (GIF or MP4) when motion, timing, transitions, or interaction are part of the change.

- Capture **before** from the base revision (a separate worktree at `<base>`) and **after** from the branch, with the same viewport, theme, account, and fixture data, so the only difference is the change.
- Capture every state the change touches: empty/loading/error states, each affected breakpoint, each affected user role or view.
- Crop to the relevant area; keep enough surrounding UI for orientation.
- Host the images on GitHub, not in the repository. `gh` cannot attach images to a PR body, so either ask the user to drag the files into the PR description (and give them the local paths), or use an upload route the environment already provides. Never commit them to the branch. If you cannot capture or host them, say so in the Verification section and list the local file paths.

### 8. Write the title and body

**Title:** follow the repo's existing PR/commit title style. If it has none, use a conventional commit in plain language that names the outcome: `fix(web): new threads no longer spike CPU`, not `fix: update thread handler`.

**Body:** open with one summary sentence a reviewer could stop after — what the PR does and the problem it solves. Then use this structure (or the repo's template):

```markdown
<One sentence: what this PR does and what it solves.>

## Problem

<The problem in a sentence or two: what was wrong or missing, who it affected, and the expected behavior. Include repro steps or environment when relevant. Link the issue: "Closes #123".>

## Change

<How this solves it, in a few sentences or a short list of the key changes. If it spans server, client, schema, or several packages, explain why each part is needed for the same fix. Call out migrations, config, or breaking changes.>

## Verification

<What you ran or checked, and what you observed — commands with results, manual steps with outcomes. Not "tests pass" alone. State what you could not check.>

### Before and after

<Optional one sentence naming the scenario and fixture both captures share.>

| Before: <what the user saw> | After: <what the user sees now> |
| --- | --- |
| <img src="<before-url>" width="360"> | <img src="<after-url>" width="360"> |

<Written with <model> in <harness>.>
```

Rules for the body:

- Drop the "Before and after" section for changes with no visible surface. For several states, add one table per state, each with a sentence above it saying what it shows.
- Caption each column with what the reader should notice ("Before: a 6-seat table with an empty seat"), not just "Before".
- Explain decisions and constraints a reviewer can't see in the diff. Don't narrate every file or restate the code.
- End with the model and harness that did the work, when an agent wrote it.

Create the PR with the body in a temp file so formatting survives:

```sh
body="$(mktemp -t pr-body.XXXXXX.md)"
# Write the body to "$body" with a file-writing tool or a quoted heredoc.
gh pr create --base <base> --head <branch> --title "<title>" --body-file "$body"
```

Open it as ready for review unless the user asks for a draft.

### 9. Report

Report the PR URL printed by `gh pr create`, the verification you ran, any screenshots the user still needs to drag into the description (with local paths), and anything you left unstaged. If the environment has a PR-linking tool, link the PR. Verify the working tree with `git status`.

## Failure handling

- If `gh` is not installed or not authenticated (`gh auth status` fails), report that and stop after committing — do not lose the commit.
- If `git push` fails (e.g. no remote, rejected, auth), report the exact error rather than retrying blindly.
- If a pre-commit hook modifies files, fails, or leaves staged/unstaged changes, report that state rather than silently retrying.
- If a PR already exists for the branch, `gh pr create` will fail — report the existing PR (`gh pr view --json url`) and offer to update its body instead of treating it as an error.
- If a summary of the work is already in context or supplied as arguments, use it for the branch name, commit message, and PR body.
