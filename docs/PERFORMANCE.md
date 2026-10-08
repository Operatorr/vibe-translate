# Performance pass — 2026-10-08

Implemented against baseline commit `41a538e`. No production deployment, shared personalized server cache, or paid provider calls were made.

## Measurement method

The initial development inspection separated Vite modules from application requests. Landing had 93 resource entries and 6.92 MB of decoded resources, but only one session API request. The product's genuine waste was six API requests, an entire 2,000-Segment thread, and sharing metadata fetched before the popover opened. Its Segment response alone decoded to 1,307,787 bytes. Development paint timings described the loading shell, not useful translation content.

For the controlled comparison, the original and changed **production frontend builds** used the same local Worker, disposable authenticated account, local Neon database, and gzip-serving proxy. Three fresh desktop Chrome contexts per build used 1280×800, reduced motion, no CPU/network throttling, three Characters, twelve original Threads, and 6,090 Segments (three 2,000-row Threads plus nine ten-row Threads). A separate 120-row fixture tested microsecond/UUID cursor ties. Fixtures were removed afterward.

The old frontend used the **updated backend** in this comparison to isolate frontend loading/rendering changes. Original/new SQL plans and unchanged-user writes were checked separately. This is not a before/after deployed backend latency comparison. Useful content is the first rendered target text plus a subsequent animation frame, rather than Load, DOMContentLoaded, or a loading-shell paint. Click-to-content numbers include browser automation/actionability overhead; they are not INP.

Raw [browser runs and waterfalls](./performance/browser.json), [query plans](./performance/query-plans.json), and [functional verification](./performance/verification.json) accompany this report. IDs are redacted. ResourceTiming is sampled through useful content; it excludes service-worker background precaching and is not a total PWA installation transfer measurement.

## Before / after evidence

Medians of three controlled production frontend runs unless stated otherwise:

| Measure                                           |                Before |                   After |
| ------------------------------------------------- | --------------------: | ----------------------: |
| Useful long-thread content                        |              5,840 ms |                1,444 ms |
| Initial API requests, including session           |                     6 |                       2 |
| API decoded bytes                                 |             1,310,906 |                  35,876 |
| Total resource transfer through useful content    |             308,772 B |               234,527 B |
| Resource entries through useful content           |                    10 |                      16 |
| Total decoded resource bytes                      |           2,155,104 B |               815,065 B |
| Initially rendered Segments                       |                 2,000 |                      50 |
| DOM elements                                      |                92,272 |                   2,583 |
| Initial main-thread long tasks                    | 2/run; maximum 685 ms | 0/run in sampled window |
| FCP                                               |                260 ms |                  212 ms |
| LCP at sampled content readiness                  |              6,548 ms |                1,472 ms |
| CLS at sampled content readiness                  |               0.02455 |                 0.02461 |
| Main entry, minified / gzip (build output)        |    722.55 / 220.90 kB |      351.56 / 111.09 kB |
| Full history vs bounded SQL rows returned         |                 2,000 |     51 (50 + lookahead) |
| SQL execution, one local warm-buffer plan         |              2.403 ms |                0.086 ms |
| SQL shared buffer hits, same plans                |                   436 |                       8 |
| IndexedDB writes in 100-update regression probe   |                   103 |                       1 |
| Existing-user profile writes per unchanged lookup |                     1 |                       0 |

More resource requests now load smaller route chunks. The unchanged CLS result does not establish an improvement. LCP/CLS are lab snapshots, not field Core Web Vitals. SQL results exclude network/connection latency and use synthetic local data with warm buffers. Fixture text is highly repetitive, so gzip transfer reductions should not be extrapolated to real corpora.

| Interaction                     | Before median | After median | After API requests |
| ------------------------------- | ------------: | -----------: | -----------------: |
| Select an uncached short Thread |      9,464 ms |     1,068 ms |                  1 |
| Return to loaded long Thread    |      5,680 ms |        63 ms |                  0 |
| First visit to second Character |     15,874 ms |     1,161 ms |                  1 |
| Return to first Character       |     13,345 ms |        75 ms |                  0 |
| Navigate to pricing             |        289 ms |        74 ms |                  0 |
| Monthly / annual tabs           |        115 ms |        73 ms |                  0 |
| Return from pricing to app      |      1,030 ms |        67 ms |                  0 |

The old 2,000-card tree delayed event processing and unmounting. Some slow old scenarios also exceeded the existing 30-second freshness window and refetched data; raw waterfalls retain these calls. The new return scenarios stayed inside that window. These are complete measured navigation sequences, not a claim that warm queries never refresh.

## Causes and implemented changes

- **Serial initial reads:** `/api/app/bootstrap` returns the safe current-user view, Characters, selected Character's Threads, and the newest Thread's 50-row page. One existing-user lookup plus one scoped SQL snapshot replaces the browser's `/me`, Characters, Threads, Segments, and eager sharing calls. First visits to another Character also load its roster and head page together; roster refreshes use the smaller existing endpoint.
- **Unbounded history and rendering:** `/api/segments/page` validates a strict `(created_at, id)` backward cursor, selects 51 rows, and preserves PostgreSQL microseconds in the cursor. The UI loads 50 at a time, blocks overlapping pagination, and offers an explicit error retry. Create/retry merges retain older pages and cursors. Complete Markdown copy/download fetches history only when requested.
- **Wrong access path for bounded reads:** migration `0008` adds `(user_id, thread_id, created_at DESC, id DESC)`. The measured new plan uses `segments_user_thread_created_id_idx`, rather than scanning/filtering the corpus and sorting the whole Thread. Existing indexes were retained; the user/time prefix alone cannot provide Thread-scoped tie-breaker ordering.
- **Profile writes on every data request:** existing users are read without writes; email synchronization occurs only when the authenticated value changes. First provisioning inserts the signup balance and ledger atomically. Six concurrent real database requests produced one grant, and six subsequent reads left the user's transaction version unchanged.
- **Duplicate/cancelled lifecycle work:** nested consumers share Query's bootstrap/domain keys. Abort signals reach read fetches; a microtask cancellation check avoids launching StrictMode's detached request. Bootstrap only seeds missing keys, so stale snapshots cannot restore mutated data. The provider hierarchy was already stable and did not need replacement.
- **Cancellation during session hydration:** clearing every Query entry stranded an already mounted public resolver after its fetch was aborted. Account switching now removes personalized entries and mutation records while preserving only explicitly public share and diagnostics reads. Public sharing remains nonpersistent, immediately stale, and server-authorized by its capability token.
- **Late mutation ownership:** cache callbacks capture the account at mutation start, even if observer options change while a request is pending. Async cancellation checkpoints recheck ownership before writing. Sign-out/account switching cannot seed the next account with an old success or rollback.
- **Repeated IndexedDB serialization:** only persisted-data success/removal events schedule work. A 250-ms burst is written once; hidden/pagehide events flush pending work. Queued writes and deletion remain serialized with generation checks. Legacy account-owned history remains readable offline during the pagination upgrade.
- **Whole-feature entry bundle:** automatic route splitting and separating pricing from landing move feature implementations off the root entry. The lazy Three.js chunk remains large. Installed-PWA precaching still deliberately downloads all route assets for offline completeness.
- **Unnecessary reads and retries:** sharing status loads on popover open, with explicit loading/error/retry behavior. Character creation merges its response without immediate redundant invalidation. Permanent 4xx query errors do not automatically retry; transient failures get at most one retry, with bootstrap/explain/public-share exceptions.

HTTP requests are not database operations. From handler code and query mocks, the original existing-user initial sequence executed ten application SQL statements, including five profile upserts; bootstrap executes two statements and no unchanged-profile writes. Authentication can add database work when its existing five-minute signed session cache misses. The bootstrap SQL also executes count subplans for the roster; one SQL statement is not one unit of database work. The local bootstrap plan took 0.981 ms with 92 buffer hits; a cursor-page plan used the new index and returned 51 rows in 0.093 ms. Both local indexes were valid. No production database trace was captured.

## Cache ownership and correctness

| Boundary                           | Owner and freshness                                                        | Updates / invalidation / failures                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Characters, Threads, Segment pages | Browser Query; active account; 30 seconds                                  | Mutation responses merge into loaded lists; deletes/archives remove child history/shares. Stale reads refresh on mount. No focus refetch.                                                                |
| Current-user view                  | Browser Query; active account; 60 seconds                                  | Profile mutations replace it; generation/retry invalidates credits. Every server data request still authenticates independently.                                                                         |
| Bootstrap                          | Browser transport only; immediately stale, `gcTime: 0`, no automatic retry | Seeds missing domain keys only; cancelled responses cannot seed. Failures fall back to individual reads and existing UI retry.                                                                           |
| Sharing status                     | Browser Query; active account + Thread; five minutes; loaded on open       | Enable/revoke cancel older reads and replace status directly. Error offers explicit retry.                                                                                                               |
| Public share                       | Browser Query; capability token; stale/gc zero; no automatic retry         | No IndexedDB persistence; each new visit resolves again. Server revocation returns 404. Hydration preserves the active public read.                                                                      |
| Explain                            | Existing browser Segment key, infinite freshness; no automatic retry       | Retry removes the old explanation. Existing persisted server Explain/version/cache semantics retained; provider work is not restarted merely by quick panel closure.                                     |
| Offline data                       | IndexedDB; confirmed account; original Query timestamps                    | Only Characters, Threads, Segment pages, activity. Account switch/sign-out discards old owner's data. A settled session error can use the last confirmed owner. Failed writes are logged; no retry loop. |
| Authentication                     | Existing Better Auth signed cookie cache, five minutes                     | Unchanged server session validation/revocation policy. No module-level current-user cache.                                                                                                               |

No new shared database result cache was added. Existing translation, Explain, model-registry, and provider behavior retains its previous ownership and freshness rules.

## Coverage and verification

- Measured cold app loads; Thread/Character detail navigation and returns; pricing navigation and monthly/annual tabs.
- Browser checked older-page loading (50 → 100, one request, no duplicate IDs), complete 2,000-row Markdown export, Character PATCH without a follow-up list GET, sharing creation/status/revocation, 500-row public resolver, and three real pages spanning 120 same-timestamp rows without loss or duplication.
- Browser checked mobile Character → Thread → workspace and back, with no horizontal overflow; production offline reload showed 50 persisted rows with no runtime errors.
- Smoke checked landing, pricing, legal, changelog, invite, diagnostics, invalid public link, and sign-in. Sign-up, forgotten-password, reset-token, and expired-link views also passed; command-palette filtering and keyboard Vibe changes issued no API requests. Command-palette/search, vibe presets, temperature, token alignment, provider gates, onboarding, credit accounting, and TTS cancellation were inspected. Existing automated coverage includes alignment/presets, Character forms, translation/retry credit ordering, and PWA installation/cache integrity. There is no live feed/subscription mechanism to batch in this application.
- New regressions exercise real nested StrictMode callers, first-visit roster/head reuse, cancelled bootstrap seeding, observer ownership changes, success/error rollbacks, account changes during async cancellation, timestamp cursor boundaries, persistence burst coalescing, active public-query hydration, and an actually blocked IndexedDB write during sign-out.
- `pnpm test`: **279 passed, one opt-in integration test skipped**, across 32 files. The real provisioning test is explicitly opt-in and skipped by the normal suite.
- `pnpm build` and `pnpm lint` pass. Worker dry run passes (2,847.96 KiB / 513.21 KiB gzip upload); no deployment. The existing large lazy Three.js chunk warning remains.
- Real integration: `RUN_LOCAL_DB_PERF=1 node --env-file=.env --env-file=.dev.vars node_modules/vitest/vitest.mjs run api/_lib/__tests__/users-integration.test.ts` passed against Local, with fixture cleanup.

The local database was initially empty. Sharing verification exposed its missing **existing** `0005` live-link unique index; restoring that index fixed the local 500 and allowed revocation testing. This is environment drift, not a new sharing schema change. T3 preview became explicitly unavailable during the pass, so final verification used isolated headless Chrome; Playwright was installed outside this repository.

## Database deployment

Apply [0008_segment_pagination.sql](../db/migrations/0008_segment_pagination.sql) separately to each intended database **outside a transaction**. It uses `CREATE INDEX CONCURRENTLY` and leaves existing indexes intact. Only Local was changed during this pass. Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for selecting the Production database; do not reuse Local credentials.

After application, inspect `pg_index.indisvalid` for `segments_user_thread_created_id_idx` and run `EXPLAIN (ANALYZE, BUFFERS)` for both the first and cursor pages with representative production cardinalities. If a prior concurrent build left an invalid index, `IF NOT EXISTS` does not repair it; remove/rebuild that invalid index with the environment's normal operational procedure. Confirm migration `0005` and the rest of the existing migration history are applied as well. No data backfill is needed.

## Remaining work, in priority order

1. Measure deployed Worker/Hyperdrive timings, provider latency, field Web Vitals/INP, real mobile devices, normal-motion landing/WebGL, and concurrent realistic account workloads. Local connection latency varied substantially; these fixtures establish waste removal, not whole-application performance.
2. Bound/window public shared Threads and very long sessions after many **Load older** clicks. Public pages still render up to 500 rows; authenticated loaded pages and persisted history can grow. Infinite-query stale refreshes reread loaded pages; measure before choosing page retention or virtualization, preserving offline history and export behavior.
3. Profile large Character/Thread rosters and correlated Segment counts; verify pgvector retrieval plans with populated embeddings. Translation-memory search, live AI translation/retry/Explain, microphone transcription, ElevenLabs, checkout, BYOK, Google OAuth, and email were not exercised against paid/external providers. Their existing tests passed; provider/production latency remains unmeasured. No speculative new indexes or broad caches were added there.
4. Evaluate staged PWA asset precaching and the large lazy Three.js chunk if total installation bytes compete with useful content on slow devices. Current route splitting improves critical execution while preserving the existing full offline shell contract.
