# Deep Review Reference

Supporting templates and commands for the `deep-review` skill. See also `SUBAGENT_PROMPT.md` (per-file fan-out prompt) and `TOOL_BATTERY.md` (linter/SAST/secret matrix).

## Shared finding record

Both sub-agent findings and normalized tool findings use this shape so Phase 5 can merge them mechanically:

```text
path: <file>
line: <line or range>
axis: Bugs | Standards | Spec
severity: Critical | High | Medium | Low
category: Correctness | Security | Reliability | Data/API | Tests | Performance | Maintainability | Docs | Standards | Spec
title: <short>
problem: <1–2 sentences>
impact: <concrete consequence>
fix: <unified diff or before/after>
confidence: high | medium | low
citation: <quoted rule or requirement with path:line, for Standards/Spec; else none>
source: llm | <tool name>
confirmed_by_tool: true | false
cross_file_refs: <symbols/callers, or none>
```

## Terminal per-finding format

````markdown
## [Severity] Issue: [Short descriptive title]

**File:** `path/to/file.ext:line-range`
**Category:** Correctness | Security | Reliability | Data/API | Tests | Performance | Maintainability | Docs | Standards | Spec
**Source:** LLM | <tool> (confirmed-by-tool when both)
**Rule / Requirement:** <quoted text with `path:line` — Standards and Spec findings only>

**Problem:**
[1-2 sentences: what is wrong and why it matters.]

**Impact:**
[Specific consequence if unfixed.]

**Suggested Fix:**
```diff
[Exact unified diff, or precise before/after.]
```

**Handoff Prompt:**
```
In the file `path/to/file.ext`, around lines X-Y:

[Self-contained instruction: the exact change, why it is required, edge cases, and how to verify it.]

Only modify the necessary lines. Keep unrelated code unchanged.
```
````

Group findings under `## Bugs`, `## Standards`, and `## Spec`, and order each section Critical → High → Medium → Low, then by file and line. Use `B`, `S`, and `P` identifiers. Every Low gets its own entry — never summarized away. Under `## Spec`, add the requirement map (`requirement → implementation → evidence → satisfied / partial / missing / contradicted / unclear`), or state `no spec available`.

## Terminal closing blocks

```markdown
### PR Summary
[2-4 sentence overview and overall assessment.]

### Worst issue per axis
- Bugs: <ID/severity, none confirmed, or incomplete>
- Standards: <ID/severity, none confirmed, or incomplete>
- Spec: <ID/severity, none confirmed, no spec available, or incomplete>

### Recommendations
- [ ] Blocking fixes (Critical/High)
- [ ] Tests to add or run
- [ ] Low-severity cleanup (non-blocking)

### Statistics
- Files changed: X
- Sub-agents run: N per-file + Standards + Spec (waves: W)
- Issues found: Y (Bugs b, Standards s, Spec p; Critical: a, High: b, Medium: c, Low: d)
- Rule sources: [paths] | Requirement sources: [paths/URLs, or no spec available]
- Tools run: [tool: passed | failed | skipped (reason), ...]
- Tool-confirmed findings: Z
```

## GitHub summary comment template

One comment — the only thing posted to the PR. One section per axis; Critical/High/Medium findings in their own `<details>`, Low findings wrapped in one collapsed section per axis.

````markdown
# Deep Review

[Overall assessment: mergeable / blocking issues / needs follow-up.]

### Statistics
- Files changed: X | Sub-agents: N per-file + Standards + Spec (waves W) | Tools: [list]
- Issues: Y (Bugs b, Standards s, Spec p; Critical a, High b, Medium c, Low d) | Tool-confirmed: Z
- Worst per axis: Bugs <…> · Standards <…> · Spec <… / no spec available>

## Bugs

<details>
<summary>B1 — [Severity] path/to/file.ext:line - short title</summary>

**Category:** ...
**Source:** ...

**Problem:** ...

**Impact:** ...

**Suggested Fix:**
```diff
...
```

**Handoff Prompt:**
```text
...
```
</details>

<details>
<summary>Low-severity findings (d)</summary>

<details>
<summary>B7 — [Low] path:line - title</summary>

**Problem:** ...
**Suggested Fix:**
```diff
...
```
</details>

</details>

## Standards

<Same layout as Bugs. Each finding adds **Rule:** with the quoted rule and `path:line`. Or: none confirmed.>

## Spec

<Same layout as Bugs. Each finding adds **Requirement:** with the quoted requirement and source.>

<details>
<summary>Requirement map</summary>

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| ... | ... | ... | satisfied / partial / missing / contradicted / unclear |

</details>
````

Always keep all three axis headings; write `none confirmed`, `no spec available`, or `incomplete` under an empty one. Omit an empty Low-severity block. Never omit a finding to shorten the comment — collapse it instead.

## Posting the summary comment

Write the summary markdown to a temp file and post it as a single PR comment:

```bash
gh auth status  # bail to terminal output on failure

tmp_review="$(mktemp -t deep-review.XXXXXX.md)"
# Write the summary comment markdown to "$tmp_review" first.
gh pr comment <url-or-number> --body-file "$tmp_review"
```

Rules:

- Post exactly one comment per review run. Do not post a PR review (`gh pr review`, `gh api repos/OWNER/REPO/pulls/<number>/reviews`) and do not post inline/line-anchored comments — they create a resolvable conversation per finding and duplicate the summary.
- Every finding keeps its `path:line` in its `<details>` summary line, so nothing is lost by not anchoring it to the diff.

## Auth & fallback commands

```bash
command -v gh
gh auth status
```

Terminal fallback when `gh` is missing or unauthenticated, or when posting fails — print the full review with the reason:

```bash
tmp_review="$(mktemp -t deep-review.XXXXXX.md)"
# Write the full review markdown to "$tmp_review" first.
if ! command -v gh >/dev/null 2>&1; then
  printf 'GitHub posting skipped: gh is not installed.\n\n'; cat "$tmp_review"
elif ! gh auth status 2>/tmp/deep-review-gh.err; then
  printf 'GitHub posting skipped: gh auth failed.\n'; cat /tmp/deep-review-gh.err; printf '\n\n'; cat "$tmp_review"
fi
```

## Pitfalls to avoid

- Do not let thoroughness become vagueness — every finding still needs an exact location and a concrete fix.
- Do not collapse the Low tier into a count; collapse it into a `<details>`, but list each item.
- Do not report cosmetic or subjective style. If the only consequence is taste, drop it — unless a documented repo rule mandates it, in which case it is a Standards finding with the rule quoted.
- Do not let one axis cancel another: a clean Bugs axis says nothing about Standards or Spec.
- Do not run any tool with `--fix`/`--write`, and do not run global installs without asking.
- Do not post inline comments or a PR review — one summary comment is the entire GitHub output.
- Do not skip Phase 6 on a non-trivial PR; a suspiciously low count is usually under-reporting, not a clean PR.
- Do still say what is good. Even an exhaustive review benefits from noting solid patterns.
