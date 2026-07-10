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

The dashboard was simplified on 2026-07-10 into a calm household instrument: the current recommendation is still primary, but the product avoids glassmorphism, decorative gradients, oversized radii, hover lifts, and internal implementation labels.

- Fonts: `Manrope` (`font-sans`, default UI) provides the complete text hierarchy; `IBM Plex Mono` (`font-mono`, helper class `mono-num`) is limited to temperatures, timestamps, and tabular measurements. Both are loaded via the Google Fonts `@import` at the top of `src/styles.css`.
- Color tokens live in `src/styles.css` as the existing `--ww-*` palette and semantic Material 3-style `--md-sys-*` surface/color roles, defined separately under `:root` and `.dark`. shadcn variables map to the semantic roles, while breeze teal, ember, and gold retain their product meanings.
- Surfaces use tonal separation, 8-12px radii, subtle borders, and no resting shadows. `.status-panel` uses a functional colored left border (`open` = breeze teal, `maybe` = gold, `closed` = ember) rather than an aurora or glow.
- `ThermalGauge` remains the signature instrument, but it is a flat threshold track with always-visible labels for outside temperature, the opening threshold, and forecast low. Do not move essential meaning back into hover-only tooltips.
- Chart/room accent colors are plain hex constants near the top of `src/routes/index.tsx` because Recharts needs literal color strings. If the palette changes, update both the CSS tokens and those constants together.
- Theme follows the OS/browser color-scheme only — there is no manual light/dark toggle in the UI (a `ThemeToggle` component existed briefly but was removed by request; do not re-add a manual toggle without checking first). An inline anti-flash script (`themeInitScript` in `src/routes/__root.tsx`) sets the `dark`/`light` class on `<html>` from `prefers-color-scheme` before hydration, and keeps a live `matchMedia` listener so the class updates immediately if the system theme changes while the tab is open.
- `src/components/Header.tsx`, `src/components/Footer.tsx`, and `src/routes/about.tsx` are leftover scaffold demo files, not wired into `__root.tsx` and not part of the product surface; they reference CSS variables (`--sea-ink`, `--page-wrap`, etc.) that no longer exist. They were intentionally left as-is (dead/unused) rather than restyled, since `/about` is not linked from the dashboard.
- Motion is limited to short color transitions and respects `prefers-reduced-motion` via a media query at the bottom of `src/styles.css`.

## Environment

Local-only files:

- `.tado-token.json` stores the tado OAuth refresh/access token and must remain uncommitted
- `data/temperature-history.jsonl` stores persistent temperature history and must remain uncommitted

Environment variables:

- `LOCATION_LABEL`, default `Untergiesing-Harlaching`
- `LATITUDE`, default `48.0956`
- `LONGITUDE`, default `11.5611`
- `TADO_HOME_ID`, optional override
- `TADO_ZONE_ID`, optional override to restrict rooms
- `COOLING_MARGIN_C`, default `2`
- `REQUEST_TIMEOUT_MS`, default `5000`
- `WEATHER_CACHE_MS`, default `240000`. Bright Sky current/forecast responses are reused briefly to avoid rate limits from dashboard refreshes and local background sampling.
- `WEATHER_RATE_LIMIT_BACKOFF_MS`, default `600000`. After a Bright Sky `429`, the server reuses cached or last recorded outdoor weather during this backoff window.
- `TADO_RATE_LIMIT_BACKOFF_MS`, default `600000`. After a tado `429`, the server pauses fresh tado calls and serves the last saved readings during this backoff window.
- `SAMPLE_INTERVAL_MS`, optional; defaults to `60000` locally and `600000` on Railway. The server reuses the last saved sample inside this interval, so dashboard refreshes do not trigger extra tado reads.
- `BACKGROUND_SAMPLER`, optional. Set to `false` for Railway Serverless/App Sleeping so the web service does not keep itself awake with periodic outbound tado/weather calls.
- `SAMPLE_TRIGGER_TOKEN`, secret bearer token required by `POST /api/sample` for Railway cron-triggered sampling.
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
- `TADO_TOKEN_JSON`, optional secret bootstrap for Railway first boot when no token file exists yet

## Architecture

- Browser code imports `src/window-watcher/functions.ts`, which defines TanStack Start server functions.
- Clerk is wired through `src/start.ts` with conditional `clerkMiddleware()` and `src/routes/__root.tsx` with conditional `ClerkProvider`. Auth is off by default, including on Railway, until `VITE_WINDOW_WATCHER_AUTH=true` or `WINDOW_WATCHER_AUTH=true` is set with valid Clerk keys.
- The route can render a sign-in prompt publicly, but `getDashboardData` enforces authentication and a verified Google OAuth account matching `AUTHORIZED_EMAIL` before importing the private temperature server module.
- Server functions dynamically import `src/window-watcher/server.ts`, which is marked `@tanstack/react-start/server-only`.
- `server.ts` owns tado token refresh, Bright Sky DWD observation reads, Bright Sky/DWD forecast reads, rebound-aware recommendation logic, and JSONL history persistence.
- Recommendations use per-room thermal-mass estimates from a slow EMA, expected rebound, observed cooling-rate/open-offset history, and 60-120 minute open-vs-closed predictions instead of only a fixed indoor/outdoor temperature gap. The open-window model uses a time-weighted outdoor forecast across the horizon; it must not treat the final forecast point as representative of the full window.
- A future "open later" recommendation requires a continuous forecast opportunity of at least `MIN_FORECAST_COOLING_WINDOW_MINUTES`; a single qualifying point at the forecast boundary is insufficient.
- The production web service can run in Railway Serverless/App Sleeping mode with `BACKGROUND_SAMPLER=false`. In that mode, fresh samples are taken on dashboard requests instead of an always-on interval.
- `POST /api/sample` records one fresh sample for Railway cron. It requires `Authorization: Bearer $SAMPLE_TRIGGER_TOKEN` and must not be exposed without that secret.
- If tado is rate-limited or throws after weather was fetched, the sampler records an outside-only history row with `rooms: []`. These rows keep outdoor history complete for charts and trend analysis, but must not be treated as the current room dashboard status.
- The dashboard route uses TanStack Query with a 60 second refetch interval.
- Recharts powers the main chart and room sparklines. The sparklines use one smoothed line with a time-based SVG gradient for rising, falling, and neutral room changes.
- The main chart's forecast segment must run from the beginning of the hour containing `status.checkedAt - 30min` until two hours later. The dashed forecast starts from forecast data, not the recorded outside measurement.
- Production builds run `scripts/write-app-version.mjs` before `vite build`, generating ignored `public/app-version.json`. The client polls this file in production and reloads automatically when the version changes so installed PWA sessions pick up new deployments.
- The Railway web service `Window watcher` is explicitly connected to GitHub source `heddendorp/window-watcher` on branch `main`; pushes to `main` should create a Railway deployment automatically. If it stops working, re-run `railway service source connect --repo heddendorp/window-watcher --branch main --service "Window watcher" --environment production --json`.
- The Railway GitHub source connection was re-applied on 2026-07-01 after CLI-only deploys were not following `main` pushes.
- `.github/workflows/deploy-railway.yml` is a GitHub Actions fallback for push-to-main deploys. It requires a repository secret named `RAILWAY_TOKEN` containing a Railway project token for the production environment; without that secret the workflow skips deployment with a notice.

## Known Gotchas

- Pnpm 11 reads `onlyBuiltDependencies` from `pnpm-workspace.yaml`, not the legacy `pnpm` field in `package.json`. Use Corepack or the pinned package-manager version so installs do not fall back to an incompatible pnpm 10 store.
- The production launcher `scripts/start-railway.mjs` imports the built server-only chunk and starts the background sampler before starting Nitro. The sampler defaults to ten minutes on Railway and one minute locally.
- The Railway web service defaults the in-process background sampler off unless `BACKGROUND_SAMPLER=true` is explicitly set. Keep production sampling owned by the separate Railway cron sampler service; if the web service starts logging `[window-watcher:cron]`, check `BACKGROUND_SAMPLER` first.
- `pnpm dev` uses the standard TanStack Start Vite dev server. The explicit `nitro/vite` plugin is loaded only for `vite build`; loading it during `vite dev` caused Nitro's dev worker to fail with `Vite environment "ssr" is unavailable` on this dependency set.
- The previous launchd plist was intentionally not carried over; the old implementation is preserved in the backup repo.
- Railway deploys the web process from `nixpacks.toml`. Attach a Railway volume and set `RAILWAY_VOLUME_MOUNT_PATH`; otherwise token/history persistence will be container-local.
- The Railway sampler service is separate from the web service. It uses the `curlimages/curl` image plus a ten-minute cron to call `POST /api/sample`; do not connect that sampler service to the GitHub repo.
- Use the web service ID `42cf18f5-12d3-4e81-93f1-a15a9f2bc408` and project ID `f584dbe5-aff5-4282-b423-0e7a874e9028` for CI deploys. Do not put Railway tokens in the repository; keep them only in GitHub/Railway secret storage.
- Railway cron exists, but its documented minimum frequency is five minutes. Keep the app as an always-on web service so the dashboard remains available; Railway production sampling is configured at ten minutes.
- Railway's "Login with Railway" is for authenticating Railway users/resources, not for locking this dashboard to one Google account. Clerk is the chosen app auth provider; configure Google sign-in in Clerk and set the Clerk variables on Railway.
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
