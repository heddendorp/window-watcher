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
- `SAMPLE_INTERVAL_MS`, default `60000`
- `OUTDOOR_TREND_HOURS`, default `3`
- `OUTDOOR_TREND_DELTA_C`, default `0.3`
- `PORT`, used by the production Start server
- `APP_USERNAME`, default `window`
- `APP_PASSWORD`, required on Railway. If Railway env markers are present and this is unset, the app returns `503` instead of exposing private temperature data.
- `DATA_DIR`, optional explicit persistence directory
- `TADO_TOKEN_FILE`, optional explicit tado token file path
- `RAILWAY_VOLUME_MOUNT_PATH`, used as the default durable base path on Railway when present

## Architecture

- Browser code imports `src/window-watcher/functions.ts`, which defines TanStack Start server functions.
- Server functions dynamically import `src/window-watcher/server.ts`, which is marked `@tanstack/react-start/server-only`.
- `server.ts` owns tado token refresh, Open-Meteo reads, recommendation logic, and JSONL history persistence.
- The dashboard route uses TanStack Query with a 60 second refetch interval.
- Recharts powers the main chart; room sparklines are lightweight SVG segments so rising, falling, and neutral room changes can be colored per segment.

## Known Gotchas

- The production launcher `scripts/start-railway.mjs` imports the built server-only chunk and starts the background sampler before starting Nitro. This keeps one-minute sampling active while the Railway web service is running.
- `pnpm dev` currently starts Vite but requests fail inside Nitro with `Vite environment "ssr" is unavailable`. The production build and `NODE_ENV=production PORT=3000 pnpm start` path work. This appears to be in the generated TanStack Start/Nitro dev worker stack rather than the Window Watcher route code, because `pnpm run build` passes and the built server serves the app.
- The previous launchd plist was intentionally not carried over; the old implementation is preserved in the backup repo.
- Railway deploys the web process from `nixpacks.toml`. Attach a Railway volume and set `RAILWAY_VOLUME_MOUNT_PATH`; otherwise token/history persistence will be container-local.
- Railway cron exists, but its documented minimum frequency is five minutes. Keep the app as an always-on service for one-minute measurements.

## Validation

Run:

```bash
pnpm run check
pnpm run build
NODE_ENV=production PORT=3000 pnpm start
```

`check` and `build` passed after migration on 2026-06-25. The production-mode server was started and returned HTTP 200 for `/`.
