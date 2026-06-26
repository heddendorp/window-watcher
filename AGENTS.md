# Window Watcher Project Context

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
- TanStack DB represented by the local history collection in `src/window-watcher/db.ts`
- TanStack Form/Table dependencies retained from the requested CLI add-ons; generated demo pages were removed because Window Watcher is the product surface
- Clerk TanStack React Start SDK for Google sign-in and session handling
- shadcn component setup via `components.json` and generated UI components
- Tailwind CSS 4
- Recharts for hoverable dashboard charts
- pnpm for package management
- Biome for formatting/linting
- Railway represented by `nixpacks.toml`
- shadcn UI components are generated in `src/components/ui`; prefer them for controls before adding custom UI primitives

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
- `server.ts` owns tado token refresh, Bright Sky DWD observation reads, Bright Sky/DWD forecast reads, recommendation logic, and JSONL history persistence.
- The production web service can run in Railway Serverless/App Sleeping mode with `BACKGROUND_SAMPLER=false`. In that mode, fresh samples are taken on dashboard requests instead of an always-on interval.
- `POST /api/sample` records one fresh sample for Railway cron. It requires `Authorization: Bearer $SAMPLE_TRIGGER_TOKEN` and must not be exposed without that secret.
- If tado is rate-limited or throws after weather was fetched, the sampler records an outside-only history row with `rooms: []`. These rows keep outdoor history complete for charts and trend analysis, but must not be treated as the current room dashboard status.
- The dashboard route uses TanStack Query with a 60 second refetch interval.
- Recharts powers the main chart and room sparklines. The sparklines use one smoothed line with a time-based SVG gradient for rising, falling, and neutral room changes.

## Known Gotchas

- The production launcher `scripts/start-railway.mjs` imports the built server-only chunk and starts the background sampler before starting Nitro. The sampler defaults to five minutes on Railway and one minute locally.
- `pnpm dev` uses the standard TanStack Start Vite dev server. The explicit `nitro/vite` plugin is loaded only for `vite build`; loading it during `vite dev` caused Nitro's dev worker to fail with `Vite environment "ssr" is unavailable` on this dependency set.
- The previous launchd plist was intentionally not carried over; the old implementation is preserved in the backup repo.
- Railway deploys the web process from `nixpacks.toml`. Attach a Railway volume and set `RAILWAY_VOLUME_MOUNT_PATH`; otherwise token/history persistence will be container-local.
- Railway cron exists, but its documented minimum frequency is five minutes. Keep the app as an always-on web service so the dashboard remains available; Railway production sampling is configured at ten minutes.
- Railway's "Login with Railway" is for authenticating Railway users/resources, not for locking this dashboard to one Google account. Clerk is the chosen app auth provider; configure Google sign-in in Clerk and set the Clerk variables on Railway.
- The public GitHub repository must never include `.env`, `.tado-token.json`, `data/temperature-history.jsonl`, Clerk secrets, tado tokens, or Railway tokens.

## Validation

Run:

```bash
pnpm run check
pnpm run build
NODE_ENV=production PORT=3000 pnpm start
```

`check` and `build` passed after migration on 2026-06-25. The production-mode server was started and returned HTTP 200 for `/`.
