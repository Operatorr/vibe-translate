# code-review

Deep, context-aware code review for GitHub PRs and local branch changes.

## Files

- [`SKILL.md`](./SKILL.md) — main skill instructions
- [`REFERENCE.md`](./REFERENCE.md) — templates, examples, severity guidance
- [`PROJECT_REVIEW_TEMPLATE.md`](./PROJECT_REVIEW_TEMPLATE.md) — starter project-level `REVIEW.md` template

## Example prompts

```text
/skill:code-review https://github.com/OWNER/REPO/pull/123
Review PR #123 with full context.
Review https://github.com/OWNER/REPO/pull/123 but do not post to GitHub.
Review the current branch against main as if it were a PR.
Do a security-focused review of this PR, but do not post to GitHub.
```
