# code-review

Thorough single-pass code review for GitHub PRs and local branch changes.

This is the default `/code-review` workflow: it walks every changed file against a fixed checklist, follows changed symbols to their callers, and reports every Critical, High, and Medium issue it can prove, with no cap on count. It skips Low/Nit findings, sub-agent fan-out, and the scanner battery. Use [`deep-review`](../deep-review/SKILL.md) when you want CodeRabbit-style coverage down to nitpicks.

## Files

- [`SKILL.md`](./SKILL.md) — main skill instructions
- [`REFERENCE.md`](./REFERENCE.md) — templates, examples, severity guidance
- [`PROJECT_REVIEW_TEMPLATE.md`](./PROJECT_REVIEW_TEMPLATE.md) — starter project-level `REVIEW.md` template

## Example prompts

```text
/code-review https://github.com/OWNER/REPO/pull/123
/skill:code-review https://github.com/OWNER/REPO/pull/123
Review PR #123.
Review https://github.com/OWNER/REPO/pull/123 but do not post to GitHub.
Review the current branch against main.
Do a security-focused review of this PR, but do not post to GitHub.
```
