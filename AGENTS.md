# AGENTS.md

Map, not manual. This file is the table of contents; the deep knowledge lives in the linked docs. Read the doc relevant to your task rather than loading everything.

## Knowledge base

- [ARCHITECTURE.md](./ARCHITECTURE.md) — top-level map; start here.
- [CONTEXT.md](./CONTEXT.md) — domain glossary (Character, Thread, Segment, Vibe, Credits, BYOK, …).
- [docs/PRODUCT.md](./docs/PRODUCT.md) — what the product is, who it's for, the wedge.
- [docs/FRONTEND.md](./docs/FRONTEND.md) — React SPA: routing, providers, data flow, offline.
- [docs/DESIGN.md](./docs/DESIGN.md) — design system, vibe slider, hover-align, Explain panel.
- [docs/BACKEND.md](./docs/BACKEND.md) — Hono worker, `_lib` modules, auth, tiers, request flows.
- [docs/API.md](./docs/API.md) — HTTP surface and route guards.
- [docs/DATABASE.md](./docs/DATABASE.md) — Postgres schema, pgvector, tables.
- [docs/CLOUDFLARE.md](./docs/CLOUDFLARE.md) — worker, bindings, routing, edge controls.
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — environments, secrets, migrations, deploy, rollback.
- [docs/SECURITY.md](./docs/SECURITY.md) — auth, data scoping, abuse protection, BYOK, webhooks.
- [docs/adr/](./docs/adr) — architecture decision records (the *why* behind the model).

## Working in this repo

- Local dev runs via `pnpm dev:full` (Wrangler worker + Vite). The user usually has it running already — use the running server for localhost verification rather than starting another.
- `pnpm build` = `tsc --noEmit && vite build`. `pnpm lint` = ESLint. Run both before considering a change done.
- Domain model is **Character → Thread → Segment**. The six **Vibe stop** IDs are a contract shared by the DB enum, `api/_lib/schemas.ts → VIBE_STOPS`, and the client preset table — change all three together.
- Validate every API input with Zod at the boundary. Never import `api/_lib/*` from `app/` or vice versa.

<!-- context7 -->
Use the `ctx7` CLI to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer -- your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

### Steps

1. Resolve library: `npx ctx7@latest library <name> "<user's question>"` -- use the official library name with proper punctuation (e.g., "Next.js" not "nextjs", "Customer.io" not "customerio", "Three.js" not "threejs")
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question)
3. Fetch docs: `npx ctx7@latest docs <libraryId> "<user's question>"`
4. If you weren't satisfied with the answer, re-run the same command with `--research`. This retries with sandboxed agents that git-pull the actual source repos plus a live web search, then synthesizes a fresh answer. More costly than the default
5. Answer using the fetched documentation

You MUST call `library` first to get a valid ID unless the user provides one directly in `/org/project` format. Use the user's full question as the query -- specific and detailed queries return better results than vague single words. Do not run more than 3 commands per question. Do not include sensitive information (API keys, passwords, credentials) in queries.

For version-specific docs, use `/org/project/version` from the `library` output (e.g., `/vercel/next.js/v14.3.0`).

If a command fails with a quota error, inform the user and suggest `npx ctx7@latest login` or setting `CONTEXT7_API_KEY` env var for higher limits. Do not silently fall back to training data.

Run Context7 CLI requests outside Codex's default sandbox. If a Context7 CLI command fails with DNS or network errors such as ENOTFOUND, host resolution failures, or fetch failed, rerun it outside the sandbox instead of retrying inside the sandbox.
<!-- context7 -->
