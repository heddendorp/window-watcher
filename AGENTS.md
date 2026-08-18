# Window Watcher Project Context

## Agent Maintenance

Keep this file current. When future work uncovers important project context, operational details, deployment changes, environment requirements, recurring gotchas, or decisions that would help the next agent, add them to this file in the relevant section before finishing the task.

Do not record secret values here. It is fine to document secret names, where they are configured, and how they are used, but never include `.env` values, tado token contents, Clerk secrets, Railway tokens, or sample trigger tokens.

## Scaffold

The current application was rearchitected from the previous local Node/static app into a TanStack Start project on 2026-06-25.

Backup of the pre-migration implementation:

`/Users/hedde/Documents/Window watcher backup 20260625-091817`

The exact TanStack CLI command used in the scratch directory was:

```bash
npx @tanstack/cli@latest create my-tanstack-app --agent --package-manager pnpm --tailwind --deployment railway --add-ons form,shadcn,table,tanstack-query
```

Scratch scaffold path:

`/tmp/window-watcher-tanstack-scaffold-20260625-091824/my-tanstack-app`

Interactive selections made during scaffolding:

- React
- Biome toolchain
- File router
- Include generated demo/example pages: yes initially, then removed from this app after migration because they failed the generated Biome policy and were not product routes
- Railway deployment target

The CLI reported that `--tailwind` is deprecated/ignored because Tailwind is enabled by default in TanStack Start scaffolds. It also reported `Agent skills: no` despite the requested `--agent` flag; TanStack Intent was installed manually afterward.

## TanStack Intent

Commands run after scaffolding:

```bash
npx @tanstack/intent@latest install
npx @tanstack/intent@latest list
pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core @tanstack/start-client-core#start-core/server-routes @tanstack/start-client-core#start-core/server-functions @tanstack/start-client-core#start-core/deployment @tanstack/router-core#router-core @tanstack/router-core#router-core/data-loading @tanstack/router-core#router-core/type-safety
```

Before substantial TanStack changes, run:

```bash
pnpm dlx @tanstack/intent@latest list
```

Then load the most specific matching package skill before editing.

<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

## Current Stack

- React 19
- TanStack Start
- TanStack Router file routes
- TanStack Query for dashboard refresh
- JSONL-backed temperature history, read on the server and rendered directly by the dashboard
- Generated form/table demo pages and their unused dependencies were removed because Window Watcher is the only product surface
- Clerk TanStack React Start SDK for Google sign-in and session handling
- shadcn component setup via `components.json` and generated UI components
- Tailwind CSS 4
- Recharts for hoverable dashboard charts
- Node.js 24 LTS for local, CI, and Railway builds
- pnpm 11.11.0 for package management, pinned through `packageManager` in `package.json`
- Biome for formatting/linting
- Railway represented by `nixpacks.toml`
- shadcn UI components are generated in `src/components/ui`; prefer them for controls before adding custom UI primitives

## Design System

The dashboard was simplified on 2026-07-10 into a calm household instrument and made chart-first on 2026-08-05. The temperature plot is the primary landing view, followed by a compact recommendation strip and room cards. The product avoids glassmorphism, decorative gradients, oversized radii, hover lifts, and internal implementation labels.

- Fonts: `Manrope` (`font-sans`, default UI) provides the complete text hierarchy; `IBM Plex Mono` (`font-mono`, helper class `mono-num`) is limited to temperatures, timestamps, and tabular measurements. Both are loaded via the Google Fonts `@import` at the top of `src/styles.css`.
- Color tokens live in `src/styles.css` as the existing `--ww-*` palette and semantic Material 3-style `--md-sys-*` surface/color roles, defined separately under `:root` and `.dark`. shadcn variables map to the semantic roles, while breeze teal, ember, and gold retain their product meanings.
- Surfaces use tonal separation, 8-12px radii, subtle borders, and no resting shadows. `.decision-strip` uses a functional colored left border (`open` = breeze teal, `maybe` = gold, `closed` = ember) rather than an aurora or glow.
- Keep the page header compact and the temperature plot above the recommendation. The chart header must show the last successful room check and an honest countdown to the next expected check. Call this a "check", not a "measurement", because Tado can return the same sensor observation more than once.
- Chart/room accent colors are plain hex constants near the top of `src/routes/index.tsx` because Recharts needs literal color strings. If the palette changes, update both the CSS tokens and those constants together.
- Theme follows the OS/browser color-scheme only — there is no manual light/dark toggle in the UI (a `ThemeToggle` component existed briefly but was removed by request; do not re-add a manual toggle without checking first). An inline anti-flash script (`themeInitScript` in `src/routes/__root.tsx`) sets the `dark`/`light` class on `<html>` from `prefers-color-scheme` before hydration, and keeps a live `matchMedia` listener so the class updates immediately if the system theme changes while the tab is open.
- `src/components/Header.tsx`, `src/components/Footer.tsx`, and `src/routes/about.tsx` are leftover scaffold demo files, not wired into `__root.tsx` and not part of the product surface; they reference CSS variables (`--sea-ink`, `--page-wrap`, etc.) that no longer exist. They were intentionally left as-is (dead/unused) rather than restyled, since `/about` is not linked from the dashboard.
- Motion is limited to short color transitions and respects `prefers-reduced-motion` via a media query at the bottom of `src/styles.css`.

## Environment

Local-only files:

- `data/.tado-token.json` stores the local tado OAuth refresh/access token and must remain uncommitted; the root `.tado-token.json` is only a legacy fallback
- `data/temperature-history.jsonl` stores persistent temperature history and must remain uncommitted

Environment variables:

- `LOCATION_LABEL`, default `Untergiesing-Harlaching`
- `LATITUDE`, default `48.0956`
- `LONGITUDE`, default `11.5611`
- `TADO_HOME_ID`, optional locally but required on Railway. It pins the household identity and is the authorization boundary for production tado reconnects when Clerk auth is disabled.
- `TADO_ZONE_ID`, optional override to restrict rooms
- `COOLING_MARGIN_C`, default `2`
- `REQUEST_TIMEOUT_MS`, default `5000`
- `WEATHER_CACHE_MS`, default `240000`. Bright Sky current/forecast responses are reused briefly to avoid rate limits from dashboard refreshes and local background sampling.
- `WEATHER_RATE_LIMIT_BACKOFF_MS`, default `600000`. After a Bright Sky `429`, the server pauses fresh Bright Sky calls during this backoff window and reports the current outdoor value as unavailable rather than reusing an expired observation.
- `DWD_OBSERVATION_MAX_AGE_MS`, default `5400000` (90 minutes, bounded to 30-120 minutes). Maximum age for an observation used by the direct DWD fallback.
- `DWD_MINIMUM_STATIONS`, default and minimum `2`. Number of distinct nearby DWD stations that must agree before the fallback reports a current value.
- `DWD_MAXIMUM_SPREAD_C`, default `3` (bounded to `0.5-5`). Maximum temperature spread within the agreeing DWD station cluster.
- `TADO_RATE_LIMIT_BACKOFF_MS`, default `600000`. After a tado `429`, the server pauses fresh tado calls and serves the last saved readings during this backoff window.
- `TADO_OBSERVATION_MAX_AGE_MS`, default `1800000` (30 minutes, bounded to 20-60 minutes). A bulk Tado room observation older than this fails the fresh sample so stale sensor data cannot generate a current recommendation.
- `SAMPLE_INTERVAL_MS`, optional; defaults to `60000` locally and `600000` on Railway. The server reuses the last saved sample inside this interval, so dashboard refreshes do not trigger extra tado reads.
- `BACKGROUND_SAMPLER`, optional. Keep it `false` on Railway because the separate cron sampler owns production checks; the web service itself remains always on.
- `SAMPLE_TRIGGER_TOKEN`, secret bearer token required by `POST /api/sample` for Railway cron-triggered sampling. Production stores it once as a sealed Railway shared variable referenced by both services.
- `OUTDOOR_TREND_HOURS`, default `3`
- `OUTDOOR_TREND_DELTA_C`, default `0.3`
- `THERMAL_MASS_TAU_HOURS`, default `8`. Controls the slow EMA used as the per-room stored-heat proxy for rebound-aware recommendations.
- `REBOUND_FACTOR`, default `0.7`. Multiplies positive `massTemp - indoorTemp` to estimate post-close rebound.
- `PREDICTION_HORIZON_MINUTES`, default `90`. Horizon for comparing open-window vs closed-window room predictions.
- `MIN_PREDICTED_OPEN_BENEFIT_C`, default `0.3`. Minimum predicted open-vs-closed improvement before the app treats opening as meaningfully useful.
- `MIN_FORECAST_COOLING_WINDOW_MINUTES`, default `30`. Minimum continuous forecast interval below the useful-cooling threshold before the app recommends opening later.
- `TARGET_MAX_C`, default `22.5`. Settled-temperature target used for close-soon recommendations.
- `PORT`, used by the production Start server
- `VITE_CLERK_PUBLISHABLE_KEY`, Clerk public browser key. Required on Railway for the browser sign-in UI.
- `CLERK_SECRET_KEY`, Clerk server key. Never commit it.
- `AUTHORIZED_EMAIL`, the only verified Google OAuth email allowed to read dashboard data
- `VITE_WINDOW_WATCHER_AUTH`, public browser flag. Set to `true` only when Clerk keys are configured and the browser sign-in UI should be active.
- `WINDOW_WATCHER_AUTH`, optional server flag. Set to `true` only when Clerk keys are configured and the server should enforce Clerk auth.
- `DATA_DIR`, optional explicit persistence directory
- `TADO_TOKEN_FILE`, optional explicit tado token file path
- `RAILWAY_VOLUME_MOUNT_PATH`, used as the default durable base path on Railway when present
- `TADO_TOKEN_JSON`, optional one-time bootstrap only when no volume token exists. Remove it after the volume token is proven; a stale bootstrap must not survive as a hidden fallback.
- `WINDOW_WATCHER_BUILD_SHA`, deployment metadata set by the GitHub Actions workflow before CLI uploads. `scripts/write-app-version.mjs` uses it when Railway does not supply `RAILWAY_GIT_COMMIT_SHA`; do not manage it manually.

## Architecture

- Browser code imports `src/window-watcher/functions.ts`, which defines TanStack Start server functions.
- Clerk is wired through `src/start.ts` with conditional `clerkMiddleware()` and `src/routes/__root.tsx` with conditional `ClerkProvider`. Auth is off by default, including on Railway, until `VITE_WINDOW_WATCHER_AUTH=true` or `WINDOW_WATCHER_AUTH=true` is set with valid Clerk keys.
- When auth flags are enabled, the route renders a sign-in prompt and `getDashboardData` enforces a verified Google OAuth account matching `AUTHORIZED_EMAIL` before importing the private temperature server module. With the flags off, dashboard reads remain public, while reconnect writes are still constrained by exact tado-home proof.
- Server functions dynamically import `src/window-watcher/server.ts`, which is marked `@tanstack/react-start/server-only`.
- `server.ts` owns tado token refresh, Bright Sky and direct DWD Open Data observation reads, Bright Sky/DWD forecast reads, rebound-aware recommendation logic, and JSONL history persistence.
- Room reads use Tado's single `/homes/{homeId}/zoneStates` response rather than one state request per zone. Preserve each `insideTemperature.timestamp` as `room.observedAt`; `checkedAt` remains the time Window Watcher queried Tado. Charts, sparklines, and learned room trends use and deduplicate the real observation timestamps so repeated cloud responses are never presented as new measurements. A missing or stale non-hot-water room fails the whole fresh check so recommendations never silently omit a room.
- Recommendations use per-room thermal-mass estimates from a slow EMA, expected rebound, observed cooling-rate/open-offset history, and 60-120 minute open-vs-closed predictions instead of only a fixed indoor/outdoor temperature gap. The open-window model uses a time-weighted outdoor forecast across the horizon; it must not treat the final forecast point as representative of the full window.
- The current outdoor temperature may come from Bright Sky's dedicated `/current_weather` response or the strict direct DWD fallback. The fallback discovers nearby stations from DWD's synoptic station list, reads their plain-text POI observation files, and requires at least two distinct observations within `DWD_OBSERVATION_MAX_AGE_MS` that form a cluster no wider than `DWD_MAXIMUM_SPREAD_C`. Hourly Bright Sky `/weather` values, forecasts, stale observations, cached values past `WEATHER_CACHE_MS`, and saved history must never be presented as "Outside now". When neither source qualifies, record the room readings with no outdoor value and show no window recommendation.
- `readHistory` sanitizes rows written by the retired `Bright Sky DWD hourly observation` fallback: it preserves room temperatures but removes the invalid outdoor value and every comparison, prediction, or recommendation derived from it.
- A future "open later" recommendation requires a continuous forecast opportunity of at least `MIN_FORECAST_COOLING_WINDOW_MINUTES`; a single qualifying point at the forecast boundary is insufficient.
- Keep the production web service always on with Railway App Sleeping disabled. `BACKGROUND_SAMPLER=false` prevents a duplicate in-process interval; fresh scheduled samples come from the separate Railway cron service and dashboard requests can still sample when due.
- `POST /api/sample` records one fresh sample for Railway cron. It requires `Authorization: Bearer $SAMPLE_TRIGGER_TOKEN` and must not be exposed without that secret.
- Sampling outcomes are typed as `rate_limited`, `tado_auth_invalid`, `provider_unavailable`, or `internal_error`. The API remains fail-closed when no fresh value exists. The Railway cron treats only the known no-data outcomes (plus the retired `stale_fallback` during rollout compatibility) as a completed check; transport failures, `401`, internal errors, edge-generated errors, malformed `200` responses, and unexpected bodies remain failed deployments. `scripts/railway-sampler-command.txt` is the canonical Railway command checked by CI. Keep its connect/overall timeouts and do not replace its response validation with `curl -f` or `|| true`.
- If tado is rate-limited or throws after weather was fetched, the sampler records an outside-only history row with `rooms: []`. These rows keep outdoor history complete for charts and trend analysis, but must not be treated as the current room dashboard status.
- Bright Sky's best-effort `/current_weather` response is fetched independently from `/weather`. When the current endpoint has no value, the server tries the strict direct DWD consensus and preserves any successful forecast response. If that consensus is also unavailable, it records fresh room readings with `outside.temperatureC` absent. `POST /api/sample` returns that successful partial sample with `outsideC: null`; failed fresh checks return a typed no-data reason.
- The dashboard route uses TanStack Query with a 60 second refetch interval.
- Mobile browsers can suspend a dashboard request while the tab or installed PWA is backgrounded. Dashboard queries pass TanStack Query's abort signal through the Start server function, time out after 30 seconds, and explicitly cancel/restart on `pageshow`, visible `visibilitychange`, focus, and network reconnect. Preserve those wake handlers; TanStack Query's default focus behavior reuses an in-flight request and can otherwise leave a resumed phone waiting on a request that will never settle.
- When tado authorization is invalid, the production dashboard exposes the device reconnect flow. With Clerk enabled, both server functions re-authorize the configured Google account. Without Clerk, a rotated 256-bit `HttpOnly`, `Secure`, `SameSite=Strict`, host-only cookie binds the short-lived flow to the initiating browser, and the approved candidate token is accepted only after a direct tado `/me` call proves access to the exact server-configured `TADO_HOME_ID`. Poll timing is enforced server-side and starts are globally bounded. Token refresh and reconnect installation share one mutation lock; the replacement is written atomically with mode `0600` to the Railway volume. No device, access, refresh token, or observed home list is returned to the browser. Anyone who belongs to the configured tado home is intentionally trusted to reconnect it; unauthenticated callers can at worst consume the bounded reconnect-start allowance.
- `DashboardData.sampling` exposes the configured check interval and the next expected wall-clock boundary. Derive that boundary from the last successful room check so a missed run remains visibly due instead of silently advancing the clock.
- Recharts powers the main chart and room sparklines. The sparklines keep a neutral smoothed line and use a time-based SVG area fill: red for rising intervals, green for falling intervals, and a faint neutral fill for unchanged intervals.
- The main chart's forecast segment must run from the beginning of the hour containing `status.checkedAt - 30min` until two hours later. The dashed forecast starts from forecast data, not the recorded outside measurement.
- Production builds run `scripts/write-app-version.mjs` before `vite build`, generating ignored `public/app-version.json`. The client polls this file in production and reloads automatically when the version changes so installed PWA sessions pick up new deployments.
- The Railway web service `Window watcher` is explicitly connected to GitHub source `heddendorp/window-watcher` on branch `main`; pushes to `main` should create a Railway deployment automatically. If it stops working, re-run `railway service source connect --repo heddendorp/window-watcher --branch main --service "Window watcher" --environment production --json`.
- The Railway GitHub source connection was re-applied on 2026-07-01 after CLI-only deploys were not following `main` pushes.
- `.github/workflows/deploy-railway.yml` is the durable push-to-main deployment path. The repository secret `RAILWAY_TOKEN` contains a project token scoped to this project's production environment. The workflow fails if that secret is absent or critical Railway topology differs from the checked configuration, writes `WINDOW_WATCHER_BUILD_SHA` without triggering an extra deploy, waits for Railway to finish, and verifies that production `/app-version.json` matches the triggering GitHub SHA before succeeding.

## Known Gotchas

- Pnpm 11 reads `onlyBuiltDependencies` from `pnpm-workspace.yaml`, not the legacy `pnpm` field in `package.json`. Use Corepack or the pinned package-manager version so installs do not fall back to an incompatible pnpm 10 store.
- The production launcher `scripts/start-railway.mjs` imports the built server-only chunk and starts the background sampler before starting Nitro. TanStack may expose that chunk's functions under `server_exports` instead of as direct module exports, so the launcher supports both shapes. The sampler defaults to ten minutes on Railway and one minute locally.
- The Railway web service defaults the in-process background sampler off unless `BACKGROUND_SAMPLER=true` is explicitly set. Keep production sampling owned by the separate Railway cron sampler service. Calls from that external service execute inside the web process and intentionally produce `[window-watcher:cron]` logs there, so the log label alone does not prove that the in-process interval is active; correlate it with sampler invocations and check `BACKGROUND_SAMPLER`.
- Bright Sky's `/current_weather` endpoint is a best-effort view over SYNOP observations from the preceding 90 minutes and can return `404` for a location when nearby observations are delayed, even while `/weather` still returns an hourly observation and forecast. Treat that 404 as a provider-data gap rather than an invalid endpoint, but never substitute an hourly observation for the missing current value.
- Tado devices measure internally once a minute, but that does not expose one-minute cloud history. Tado says current values are uploaded on a meaningful temperature/humidity change and otherwise at least every 20 minutes. A live production `dayReport` check on 2026-08-05 returned mostly 15-minute points, so never manufacture ten one-minute samples or promise that resolution. The ten-minute sampler may receive an unchanged timestamp; keep one chart point for that observation.
- Bright Sky and DWD WarnWetter can reflect the same underlying DWD station gap. On 2026-07-13, Munich-area DWD POI files published newer timestamp rows whose temperature fields were blank, while the latest actual readings were already stale. The direct fallback must also return unavailable in that case; it is resilience against Bright Sky-specific outages or import lag, not a way to manufacture data DWD does not have. DWD's station list also contains duplicates and stations without POI files, so the implementation deduplicates station codes and tolerates individual `404` responses.
- Railway's native GitHub source trigger has intermittently missed `main` pushes even while the source appears connected. Keep the GitHub Actions deployment workflow and its production-version verification working; do not rely on the native trigger as the only deployment path.
- A web deployment created by GitHub Actions through `railway up` has `.meta.repo: null` even while the service remains connected to `heddendorp/window-watcher`. Do not use the latest deployment artifact's `meta.repo` as a source-connection assertion in CI; inspect the live service source configuration instead. The workflow still verifies the manifest topology before upload and proves the exact commit afterward through `/app-version.json`.
- The GitHub Actions `RAILWAY_TOKEN` is a project token. It can run commands with explicit project/environment/service selectors, but it cannot use the account-level `railway link` or `railway environment config` flow. Keep CI topology checks on project-token-compatible `deployment list` and `variable list` calls; sealed shared-variable values are redacted there, so CI can prove the trigger variable exists while live/manual checks prove both services reference the same sealed value.
- Railway crash emails can refer to the deployment being superseded rather than the replacement deployment. During the 2026-08-05 rollout, Railway stopped the old `pnpm run start` container, which logged `[ELIFECYCLE] Command failed.`, while the replacement was already `SUCCESS` and serving the new commit. Before restarting from an email, compare its deployment ID and creation time with `railway deployment list`, `/app-version.json`, and the public HTTP response; never restart a `REMOVED` deployment when the current deployment is healthy.
- A 2026-08-10 sampler crash storm was caused by an invalid tado refresh token: the app correctly returned a fail-closed `503`, while `curl -f` turned every ten-minute invocation into a Railway `CRASHED` deployment and notification. Restore authorization through the deployed reconnect panel; do not paste tokens into logs or Git. The sampler now validates the JSON outcome and treats only known no-data reasons as a completed run, while the deployment workflow checks the exact command and critical web/sampler topology for drift.
- `pnpm dev` uses the standard TanStack Start Vite dev server. The explicit `nitro/vite` plugin is loaded only for `vite build`; loading it during `vite dev` caused Nitro's dev worker to fail with `Vite environment "ssr" is unavailable` on this dependency set.
- The previous launchd plist was intentionally not carried over; the old implementation is preserved in the backup repo.
- Railway deploys the web process from `nixpacks.toml`. Attach a Railway volume and set `RAILWAY_VOLUME_MOUNT_PATH`; otherwise token/history persistence will be container-local.
- The Railway sampler service is separate from the web service. It uses the `curlimages/curl` image plus a ten-minute cron to call `POST /api/sample`; do not connect that sampler service to the GitHub repo.
- After changing the sampler service through Railway's generic service-update API, read back `multiRegionConfig`; on 2026-08-10 that API defaulted the image service to `sfo`. The sampler belongs in `europe-west4-drams3a` with one replica, matching the web service and the CI topology assertion.
- Use the web service ID `42cf18f5-12d3-4e81-93f1-a15a9f2bc408` and project ID `f584dbe5-aff5-4282-b423-0e7a874e9028` for CI deploys. Do not put Railway tokens in the repository; keep them only in GitHub/Railway secret storage.
- Railway cron exists, but its documented minimum frequency is five minutes. Keep the app as an always-on web service so the dashboard remains available; Railway production sampling is configured at ten minutes.
- Railway's "Login with Railway" is for authenticating Railway users/resources, not for locking this dashboard to one Google account. Clerk is the optional app auth provider when the dashboard itself should be private; configure Google sign-in and the Clerk variables before enabling either auth flag.
- The public GitHub repository must never include `.env`, `.tado-token.json`, `data/temperature-history.jsonl`, Clerk secrets, tado tokens, or Railway tokens.

## Validation

Run:

```bash
pnpm run check
pnpm run typecheck
pnpm run build
NODE_ENV=production PORT=3000 pnpm start
```

`check` and `build` passed after migration on 2026-06-25. The production-mode server was started and returned HTTP 200 for `/`.
