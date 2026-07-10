# Window Watcher full-application review — 2026-07-10

## Executive summary

The application builds and starts successfully after the dependency refresh, but the review found five high-severity issues in the security and recommendation paths. The most important are the fail-open production-auth default and stale room readings being presented as fresh after sampling failures. The recommendation model can also tell the user to open windows while the outdoor air is warmer, and its learned open-window coefficients are derived from history that contains no window-open state.

No Angular package is present, directly or transitively. The repository is React 19 + TanStack Start.

### Severity count

| Severity | Open findings |
| --- | ---: |
| High | 5 |
| Medium | 10 |
| Low | 4 |

## Dependency-refresh result

- Synced `main` to `origin/main` at `79614dff05138f0e2fb48dd60baa3e870eab6484` before changing files.
- Updated all policy-approved direct packages, including React 19.2.7, TanStack Start/Router/Query/DB, Tailwind CSS 4.3.2, Recharts 3.9.2, Radix UI 1.6.2, Biome 2.5.3, TypeScript 7.0.2, Vite 8.1.4, Vitest 4.1.10, jsdom 29.1.1, and the latest policy-approved Nitro nightly.
- Kept `@types/node` on the newest Node 24 line because Node 24 is the deployed LTS runtime. Local, Railway, and GitHub Actions now all target Node 24. See the [official Node release table](https://nodejs.org/en/about/previous-releases).
- Pinned pnpm 11.11.0 in `package.json`, moved `onlyBuiltDependencies` to `pnpm-workspace.yaml`, and replaced floating `latest` manifest entries with explicit semver ranges.
- Updated `actions/checkout` to v7, `actions/setup-node` to v6, and pinned Railway CLI 5.26.0.
- Removed five unused scaffold dependencies: `@faker-js/faker`, `@tanstack/match-sorter-utils`, `@tanstack/react-form`, `@tanstack/react-table`, and the redundant direct `@tanstack/router-plugin`.
- Migrated the Biome configuration and added a real `typecheck` command. TypeScript initially exposed 26 hidden errors because the Vite build is transpile-only; those compatibility errors are fixed.
- Two just-published versions were held back by pnpm's supply-chain policy: `@clerk/tanstack-react-start` 1.4.16 (installed 1.4.15) and `lucide-react` 1.24.0 (installed 1.23.0). This review did not bypass the quarantine.

## High-severity findings

### H1. Production dashboard authentication fails open

Evidence: `src/window-watcher/functions.ts:6-10,28-32`; `src/routes/index.tsx:64`; `src/start.ts:8-25`.

`getDashboardData` enforces Clerk only when either auth flag is exactly `"true"`. A missing, misspelled, or accidentally removed production flag therefore exposes household temperature history and recommendations through a directly callable server-function endpoint. The UI also defaults to the unauthenticated dashboard. This is especially risky because the product describes itself as private and the server function is the actual data boundary.

Recommendation: fail closed on Railway/production. Require authentication by default whenever deployed, allow an explicit local-only opt-out, and refuse startup when browser/server auth configuration disagrees.

### H2. Failed or rate-limited samples can be presented as fresh and successful

Evidence: `src/window-watcher/server.ts:1731-1738,1812-1830,1857-1887`; `src/routes/api/sample.ts:16-31`.

When tado returns 429, the sampler appends an outside-only row. `getCoolingStatus` checks the timestamp of that newest row but builds the dashboard from the older full-room row with `stale: false`. If a fresh attempt returns `null`, the final fallback is also forced to `stale: false`. For non-429 errors, `sampleCoolingStatus` returns a stale fallback object; the cron route treats any object as a successful, non-skipped sample and reports its synthetic current `checkedAt`.

Impact: the central decision surface and cron monitoring can claim old room measurements are fresh. A user may act on the wrong recommendation without seeing the stale warning.

Recommendation: carry an explicit result type such as `fresh | stale | rate_limited | failed`; compare the latest full-room timestamp rather than the latest row; never override an old full-room row to fresh; and make `/api/sample` return a non-success or explicit stale/skipped response when nothing new was recorded.

### H3. Falling-weather fallback recommends opening while outside is warmer

Evidence: `src/window-watcher/server.ts:1146-1164,1325-1358`.

Both the room and global fallback paths use `room.temperatureC + 1` as the opening limit when outdoor temperature is falling. For example, with a 25.0 C room, 25.5 C outside, no rebound, and no predicted open benefit, the code still returns “Open” because 25.5 is below the 26.0 C fallback limit. Opening then heats the room, contradicting the product's cooling purpose and overriding the earlier predictive comparison.

Recommendation: a falling trend may justify “wait/open soon,” but never “open now” while outside is warmer unless a separately validated model proves a benefit. Cap any immediate-open threshold at the room temperature, ideally below it by the configured useful-benefit margin.

### H4. The learned open-window model has no window-state evidence

Evidence: `src/window-watcher/server.ts:916-963`.

`estimateObservedCoolingRate` treats any cooling interval with cooler outdoor air as evidence for an open-window cooling rate. `estimateLearnedOpenOffset` treats nearly stable indoor temperature with an outdoor gap as the open-window floor. The history records temperatures but never records whether a window was open. Most qualifying intervals may therefore be closed-window thermal behavior, not open-window behavior.

Impact: the learned rate/floor can systematically understate or overstate the benefit of opening and then drive the primary recommendation branches.

Recommendation: do not label these values as learned open-window behavior without a window-state signal. Add explicit open/closed feedback, a contact sensor, or controlled-event detection with confidence bounds. Until then, use conservative model defaults and expose confidence/sample counts.

### H5. OAuth refresh tokens are sent in the request URL

Evidence: `src/window-watcher/server.ts:440-450`.

The refresh request constructs a query string containing `refresh_token` and sends it with POST. HTTPS protects transport, but URLs are commonly captured by proxy, platform, diagnostic, and provider logs. Refresh tokens are long-lived credentials and should not appear in URLs.

Recommendation: send the OAuth fields in an `application/x-www-form-urlencoded` request body, as the device-code request already does. Validate that both access and refresh token responses contain the required values before persisting them.

## Medium-severity findings

### M1. Valid zero-degree values are treated as missing

Evidence: `src/window-watcher/server.ts:816,1604,1667`; also `src/window-watcher/server.ts:1660` for a zero margin.

Truthiness checks reject `0 C`, so forecast summaries disappear at exactly freezing and both history fallback builders refuse otherwise valid outdoor data. Use nullish checks (`== null`) rather than falsy checks; use `??` for numeric configuration fallback.

### M2. Cooling-window end detection can select a point before the window starts

Evidence: `src/window-watcher/server.ts:1049-1061`; displayed at `src/routes/index.tsx:449-456`.

`coolingWindowEndsAt` searches from the first forecast point for a too-warm condition. If air is too warm now, cools later, and warms again, the first point is incorrectly returned as the end. Search only after `coolingWindowStartsAt` and detect the later transition back across the threshold.

### M3. History storage grows forever and every limited read loads the whole file

Evidence: `src/window-watcher/server.ts:1501-1529,1586-1593`.

JSONL is append-only with no retention or compaction. `readHistory(limit)` reads and splits the entire file before slicing the tail. At ten-minute sampling, the file will grow continuously and every dashboard request will eventually pay increasing I/O and memory cost.

Recommendation: implement retention/rotation or move to SQLite; for JSONL, tail-read bounded bytes and compact atomically. Add file locking if multiple service instances can share the volume.

### M4. One malformed JSONL row can take down history and dashboard reads

Evidence: `src/window-watcher/server.ts:1586-1593`.

Every line is parsed without per-line recovery. A partial final append or a single corrupt row throws the entire read. Skip/quarantine malformed rows with an error counter, while treating a malformed final line as recoverable.

### M5. Numeric environment configuration is not validated

Evidence: `src/window-watcher/server.ts:56-92,1899-1901`.

All numeric settings are parsed with `Number` and no finite/range checks. Invalid or negative values can produce bad coordinates, `AbortSignal.timeout` errors, unstable thermal math, or a near-zero interval loop. Validate the environment once at startup with Zod and reject invalid deployments with actionable messages.

### M6. The dashboard's GET server function has persistent side effects

Evidence: `src/window-watcher/functions.ts:6-10`; `src/window-watcher/server.ts:1904-1913`.

Calling `getDashboardData` can start the background sampler, contact providers, and append history. GET requests are expected to be safe and can be retried, prefetched, or cached. Separate read-only dashboard retrieval from a POST sampling action, or make sampling exclusively cron/background-owned.

### M7. No security headers are configured

Runtime evidence: production-mode responses for `/` and `/about` contained only `content-type`, date/connection, and transfer headers. There was no CSP, `X-Content-Type-Options`, frame protection, referrer policy, or HSTS.

Recommendation: add a deployment-level or Start middleware header policy. The inline theme bootstrap will need a nonce/hash before a strict CSP can be enabled. The authenticated data RPC should use `Cache-Control: no-store`.

### M8. There are no tests, and deployment runs no quality gate

Evidence: `pnpm test` exits 1 with “No test files found”; `.github/workflows/deploy-railway.yml:13-49`; `nixpacks.toml:4-5`.

The deploy workflow sends code directly to Railway, and the Railway build runs only install/build. Neither path runs Biome, TypeScript, unit tests, or recommendation fixtures. Add tests for auth defaults, zero-degree fallback, rate-limit freshness, prediction branches, history corruption, and sample-route status; gate deployment on `check`, `typecheck`, `test`, and `build`.

### M9. Auth verification is a remote Clerk lookup on every refresh, and blocked users lack recovery UI

Evidence: `src/window-watcher/functions.ts:49-66`; `src/routes/index.tsx:99-130`.

The one-minute dashboard query calls `clerkClient().users.getUser` every time, adding latency and a rate-limit dependency. React Query can also retry deterministic authorization failures. If the signed-in Google account is not allowed, the generic error card does not render `UserButton`, so the user cannot sign out/switch accounts from that screen.

Recommendation: cache the authorized Clerk user ID/email decision for a short period or use trustworthy session claims; disable retries for 401/403/config errors; show a clear blocked-account explanation plus sign-out/switch-account action.

### M10. Displayed sampling freshness is hardcoded and can disagree with the server

Evidence: `src/routes/index.tsx:61,278-299,355,653-664,1541`; server interval is configurable at `src/window-watcher/server.ts:25-26,63-65`.

The progress bar and tooltip always assume ten minutes, while local sampling defaults to one minute and `SAMPLE_INTERVAL_MS` can override either. Stale status also sets `checkedAt` to now, so the hero can say “updated now” while the measurement badge references an old `lastFreshAt`.

Recommendation: include the effective interval in `DashboardData`, drive progress/labels from it, and label the hero with the actual measurement time when stale.

## Low-severity findings

### L1. Local reconnect does not fully honor tado slowdown or reset topology

Evidence: `src/window-watcher/server.ts:348-373,365-371` and reconnect success at `src/window-watcher/server.ts:335-344`.

The server increases `flow.intervalSeconds` on `slow_down`, but the response does not return the new interval, so the browser keeps polling at the original rate. Successful reconnect clears only `statusCache`; an old account/home topology can remain cached for up to an hour.

### L2. Scaffold/demo remnants remain public and increase maintenance surface

Evidence: `src/routes/about.tsx`, generated `/about` route in `src/routeTree.gen.ts`, unused `src/components/Header.tsx` and `Footer.tsx`, and stale `.cta.json` add-ons.

`/about` is directly reachable and presents starter copy with obsolete CSS variables. Remove the route and dead components/config, or make them intentional product surfaces. The production build also warns about a client chunk above 500 kB; removing remnants and code-splitting Clerk/charts should be measured.

### L3. Charts lack an accessible text/table equivalent

Evidence: Recharts-only trend and sparkline rendering at `src/routes/index.tsx:523-642,1089-1144`.

The summary numbers are readable, but historical trend data is available only through pointer hover. Add an accessible data table or concise trend summary and make gauge/tooltip markers keyboard-focusable.

### L4. Unsupported methods on `/api/sample` fall through to HTML

Runtime evidence: unauthenticated `POST /api/sample` correctly returned 401, but `GET /api/sample` returned the application HTML with 200 rather than 405.

Return an explicit 405 with `Allow: POST` for unsupported methods so monitoring and clients cannot mistake the route response.

## Verified positives

- `pnpm audit` reported no known vulnerabilities.
- Secrets/history files are ignored and not tracked; the client build contained no tado token, sample token, authorized email, provider URL, or history-file string.
- `server.ts` is marked server-only, and sensitive provider access stays behind server functions/routes.
- The sample endpoint fails closed when `SAMPLE_TRIGGER_TOKEN` is absent or wrong; the production runtime check returned 401.
- CSRF middleware covers TanStack server functions, and local reconnect is blocked in production.
- In-process sampling is serialized with `sampleInFlight`, token refresh is serialized with `refreshInFlight`, and Railway background sampling defaults off.
- Weather/tado backoff and outside-only history preserve useful data during provider rate limits; the freshness labeling around those rows is the defect, not the fallback concept itself.
- Production build and startup succeed after the dependency migration.

## Review coverage

| Area | Files/behavior inspected |
| --- | --- |
| Framework and execution boundaries | `src/start.ts`, `src/router.tsx`, `src/routes/__root.tsx`, generated route tree, Vite/Nitro configuration |
| Authentication and authorization | Clerk middleware/provider, server-function auth, verified Google email allowlist, local reconnect endpoints |
| API surface | Dashboard server functions, `/api/sample`, method handling, CSRF and bearer token behavior |
| Provider integrations | tado device/refresh flows, topology/room reads, Bright Sky observation/forecast reads, caches and backoff |
| Core recommendation logic | outdoor trend, forecast threshold, thermal mass, rebound, open/closed predictions, room/global verdict branches |
| Persistence and resilience | token bootstrap/write, JSONL append/read/fallback, outside-only rows, stale/cached status behavior |
| Client behavior | auth/error/loading states, refresh/version polling, freshness UI, reconnect polling, charts, forecasts, room cards |
| UI/accessibility | generated primitives, keyboard/tooltip behavior, chart accessibility, theme/reduced motion, dead demo route |
| Operations | Railway launcher, Nixpacks, GitHub deployment workflow, app-version generation, documentation/environment template |
| Dependencies and validation | direct dependency usage, package-manager/runtime alignment, audit, Biome, TypeScript, tests, production build/start |

## Validation snapshot

- `pnpm run check`: pass
- `pnpm run typecheck`: pass
- `pnpm run build`: pass, with a client chunk-size warning
- `pnpm audit --audit-level=low`: pass, no known vulnerabilities
- `pnpm test`: fail because the repository contains no test files
- Production-mode smoke test with background sampling disabled: `/`, `/about`, and `/app-version.json` returned 200; unauthorized `POST /api/sample` returned 401; unsupported `GET /api/sample` returned HTML 200
