# deep-review

Maximally thorough, CodeRabbit-style code review for GitHub PRs and local branch changes. The thorough counterpart to `code-review`, across the same three axes — **Bugs**, **Standards**, and **Spec**. It fans out one focused sub-agent per changed file, runs independent Standards and Spec reviewers over the whole change, runs every available linter/SAST/secret scanner, and reports every substantive issue from Critical to Low. Optimizes for recall, but leaves out nitpicks and subjective style.

## Files

- [`SKILL.md`](./SKILL.md) — main skill instructions (principles, phased workflow, severity tiers, output)
- [`REFERENCE.md`](./REFERENCE.md) — finding shape, terminal + GitHub summary-comment templates, the posting command, fallback commands, pitfalls
- [`SUBAGENT_PROMPT.md`](./SUBAGENT_PROMPT.md) — the per-file review prompt (the anti-salience-collapse core) and the Standards and Spec reviewer prompts
- [`TOOL_BATTERY.md`](./TOOL_BATTERY.md) — language/file detection and the linter/SAST/secret-scanner matrix with the npx/uvx install policy

## Example prompts

```text
/deep-review https://github.com/OWNER/REPO/pull/123
/skill:deep-review https://github.com/OWNER/REPO/pull/123
Exhaustively review PR #123 — find everything.
CodeRabbit-style deep review of the current branch.
Thorough review of this PR against specs/invitations.md, post the summary.
Exhaustive review of these local changes, terminal only.
```

## When to use which

- **deep-review** — maximum coverage; you want every substantive issue, including lower-confidence ones, with per-file fan-out and a scanner battery.
- **[code-review](../code-review/SKILL.md)** — bounded bug hunting with the same Standards and Spec checks, focused verification, and no per-file fan-out or scanner battery.
