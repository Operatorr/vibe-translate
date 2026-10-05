---
name: visual-review
description: "Review a pull request's rendered UI using computer use. Use when asked for a visual PR review of layout, clipping, wrapping, spacing, component consistency, responsive behavior, or UX polish, with screenshot evidence and actionable fixes or redesign suggestions."
---

# Visual Review

Review the actual rendered experience introduced by a PR. Inspect it through computer use, explain what looks broken or unfinished and how it affects users, then connect the evidence to the implementation. A code-only review or a screenshot supplied in the PR does not complete this workflow.

Invocation:

```text
/visual-review https://github.com/OWNER/REPO/pull/123
$visual-review https://github.com/OWNER/REPO/pull/123
```

The PR URL is required; use one already present in the conversation or ask for it if missing. Optional context includes a preview URL, target pages, test account, supported devices, or design reference. Discover these from the PR and project before asking the user.

Review by default. Return the report in the conversation; a PR link alone does not authorize posting comments, submitting a review, editing code, or deploying changes. Follow explicit user instructions for those actions.

## 1. Resolve the PR and the experience to inspect

- Read repository instructions, PR metadata, the diff, and relevant component/style context using available connectors, CLI, or source tools. Record the PR head commit and base revision.
- Map UI changes to routes and entry points, including shared components and representative affected consumers. Use the PR intent to identify the main user journey. For shared styles, include an existing page that could regress.
- Find the PR preview through deployment checks or PR links and verify which revision it serves. If unavailable, run the PR head locally using the project's documented setup, in an isolated checkout/worktree when necessary to preserve existing work. Do not silently review the default branch or a stale preview.
- Identify the existing design conventions from nearby screens, components, tokens, or supplied designs. Use these as the baseline for consistency; do not impose a new aesthetic on the product.
- Build a compact coverage list of affected pages/components, relevant states, and viewport sizes. Account for every UI change by direct inspection, representative shared-component coverage, or a stated limitation. If the PR has no rendered UI impact, explain that instead of inventing a visual review.

**Ready when:** the target revision and affected experiences are identified and there is a runnable UI to inspect. If access, authentication, dependencies, or computer-use tools block inspection, report the specific blocker and request only what is needed. Continue useful source analysis, but label the visual review incomplete. Never claim a visual pass from code inspection alone.

## 2. Inspect through computer use

Use the available computer-use browser or app tools to open the running UI, navigate the relevant journey, scroll the full page, and operate the changed controls. Read the tool's usage instructions before driving it. Source, DOM, accessibility-tree, and computed-style inspection can help diagnose a finding; they do not substitute for viewing rendered screenshots.

Inspect at the product's supported viewport sizes. If unspecified, start with a normal desktop viewport (roughly 1440 × 900) and a narrow mobile viewport (roughly 390 × 844); include a constrained desktop/tablet width where navigation or toolbars start to compress. For desktop-only products, prioritize their supported minimum width rather than assuming mobile support. Record actual viewport dimensions and zoom; compare screenshots under matching conditions.

For each affected experience:

1. Let fonts, images, and data settle, then capture and inspect an overview. Scroll to inspect content below the fold and sticky/fixed elements.
2. Exercise relevant menus, tabs, dialogs, dropdowns, tooltips, forms, and navigation. Check keyboard focus where controls changed. Inspect hover, focus, selected, disabled, validation, loading, empty, error, and success states when applicable and reachable. Do not treat an unreachable state as checked.
3. Stress layout with realistic long labels, names, numbers, empty data, and dense content using existing fixtures or safe local/test data. Check browser zoom at 200% on changed text-heavy or control-heavy layouts. Use supported locales/themes when they are affected. Label any temporary browser overrides as synthetic; they demonstrate a layout risk, not necessarily a production occurrence.
4. Resize around observed failures or responsive transitions to determine when they occur. Recheck suspected clipping after loading completes so transient font/data changes are not misreported as settled layout defects.
5. Capture reproducible defects with a screenshot and enough surrounding context to locate the problem. Record the route, state, viewport, zoom, theme when relevant, and actions that reproduce it. Save evidence when tools support it and link the actual artifacts; do not invent screenshot paths or measurements.

Prefer local/test environments for interactions that mutate data. On a live site, stop before purchases, sends, deletes, or other consequential submissions unless already authorized; inspect non-submitting states and record the coverage gap.

### Visual inspection checklist

Apply these checks to the changed UI and its surroundings. Visible polish issues are in scope even when they would be too minor for a conventional code review.

| Area | Look for |
| --- | --- |
| Text integrity | Labels cut from `labeltext` to `labelte`; clipped glyphs or descenders; accidental ellipsis; hidden overflow; text under icons; awkward or unintended wrapping in buttons, tabs, badges, and navigation. Distinguish deliberate truncation with a usable way to read the full value from lost information. |
| Control consistency | Sibling buttons with inconsistent height, padding, radius, font, or icon sizing; mismatched input/select heights; off-center labels and icons; loading indicators changing control dimensions. Respect intentional primary/secondary and size variants. |
| Spacing and alignment | Uneven gaps, baselines, gutters, card padding, and section rhythm; toolbar actions drifting off alignment; a right-aligned button whose right inset is visibly excessive relative to the bar's vertical inset or established spacing pattern. Judge optical balance and local conventions, not a universal equal-padding rule. |
| Responsive layout | Collisions, squeezed controls, unexpected horizontal scroll, broken grid transitions, overlapping columns, detached labels, inaccessible offscreen actions, and sticky headers/footers covering content. Intentional table scrolling should remain usable. |
| Hierarchy and readability | Competing primary actions, unclear grouping, weak heading hierarchy, dense or excessively empty regions, hard-to-scan forms/tables, poor line length, inconsistent type styles, and low apparent contrast. Do not claim measured contrast compliance from a screenshot alone. |
| Interaction states | Clipped menus/tooltips, wrong stacking order, misplaced popovers, dialogs overflowing the viewport, missing or obscured focus indicators, ambiguous selected/disabled states, errors separated from their fields, and layout jumps during loading. |
| Assets and finish | Distorted or blurry images, broken assets, inconsistent icon weight, awkward crops, unintended borders/shadows, inconsistent colors, misaligned dividers, unfinished placeholders, and state-specific visual artifacts. |
| UX clarity | Ambiguous labels, unclear next steps, hidden essential actions, competing controls, poor feedback, confusing empty states, and unnecessary friction in the changed journey. Tie recommendations to a specific user task. |

**Done when:** each coverage item has been inspected or marked unverified with a reason, including relevant responsive and interaction states. Do not stop after the first visible defect.

## 3. Verify and diagnose findings

- Reproduce each suspected defect. Where practical, compare the PR head with the base or existing equivalent component using the same data, state, viewport, and zoom. Distinguish PR-introduced issues from pre-existing issues; if attribution cannot be verified, say so.
- Trace confirmed symptoms to relevant code: component variants, flex/grid sizing, shrink behavior, fixed dimensions, line-height, overflow rules, breakpoints, spacing tokens, or positioning. Cite head-revision file/line locations when verified. If the cause is uncertain, retain the observed defect and label the cause as a hypothesis.
- Recommend the smallest coherent fix that fits the design system. Avoid reflexive `overflow: hidden`, fixed heights, or `white-space: nowrap` fixes that merely move the problem elsewhere; state how the fix should behave under narrow widths and long content.
- Group duplicate symptoms with the same root cause while listing affected locations. Keep distinct actionable findings; do not impose a finding quota or omit visible polish defects solely for being low severity.
- Separate **confirmed defects** from **UX/design recommendations**. A subjective recommendation needs an observed friction point, a concrete proposed change, and the expected benefit or tradeoff. Offer a focused redesign when a local CSS adjustment cannot resolve the hierarchy or workflow problem. Do not present taste as a regression or block merging for personal preference.

Prioritize by user impact:

- **High:** essential content/action is unreadable, hidden, or unusable in a supported state, or layout blocks the main task.
- **Medium:** a reproducible visual defect materially hurts readability, interaction, or orientation, but the task remains possible.
- **Low:** visible inconsistency or lack of polish with limited task impact, such as uneven button heights or spacing.

## 4. Deliver the visual review

Lead with a short assessment of the inspected UI. Include:

- **Target and coverage:** PR link, head revision, preview/local URL, pages, viewports, zoom, and relevant states inspected. Identify any revision uncertainty and unverified areas. Keep coverage compact, using a table when helpful.
- **Confirmed defects, ordered by impact:** priority and title; route/component and reproduction steps; screenshot reference; observed versus expected appearance and user impact; verified code location and likely cause; concrete fix; and a visual acceptance check. State whether each issue is introduced, pre-existing, or unattributed.
- **UX/design recommendations:** separate, prioritized proposals grounded in the inspected page. Explain what to change and why; distinguish a small polish adjustment from an optional redesign.
- **Limitations:** unavailable baselines, blocked states, unsupported measurements, or other gaps that limit confidence.

Example acceptance check: “At 390px and 1024px widths, all three toolbar labels remain readable, buttons share the intended height, and the action group neither overlaps nor causes page-level horizontal scrolling.”

If no defects are found, say “No visual defects found in the inspected pages and states” and retain the coverage and limitations. Do not imply the entire product passed or invent recommendations to fill a section.

If the user also requests fixes, implement them within the authorized scope and repeat computer-use inspection of the affected states before claiming resolution. A passing build alone does not establish that a visual defect is fixed.
