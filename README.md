# Window Watcher

Window Watcher compares tado room temperatures with nearby outdoor weather for Untergiesing-Harlaching/Giesing so you can decide whether opening the windows will cool the flat. It records readings to a local JSONL history file, shows hoverable trend charts, and bases the recommendation on the outdoor temperature trend.

## Run Locally

```bash
pnpm install
pnpm dev
```

The app runs on [http://localhost:3000](http://localhost:3000) using the standard TanStack Start Vite dev server with Vite reload/HMR.

## Environment

Copy `.env.example` to `.env` if you want to override the defaults.

Important local files:

- `.tado-token.json`: local tado OAuth token, ignored by git
- `data/temperature-history.jsonl`: persistent temperature history, ignored by git
- `SAMPLE_INTERVAL_MS`: optional sampler override; defaults to one minute locally and five minutes on Railway.

Authentication:

- Locally, auth is inactive by default so the dashboard can run without Clerk keys.
- On Railway, Clerk auth is active automatically because Railway environment markers are present.
- Enable Google as a social connection in Clerk.
- Set `VITE_WINDOW_WATCHER_AUTH=true`, `VITE_CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`.
- Set `AUTHORIZED_EMAIL` to the single Google account that may access the dashboard.
- The server function refuses to return temperature data unless the signed-in Clerk user has a verified Google OAuth account with that email.
- Set `WINDOW_WATCHER_AUTH=true` only if you want the server to enforce Clerk auth locally too.

## Commands

```bash
pnpm run check
pnpm run build
pnpm run start
```

## Deploy

Railway is represented by `nixpacks.toml`. The service should run as an always-on web service so the dashboard remains available; production sampling defaults to every five minutes on Railway.

Railway setup:

1. Deploy from the public GitHub repo.
2. Add `VITE_WINDOW_WATCHER_AUTH=true`, `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `AUTHORIZED_EMAIL` as Railway variables.
3. In Clerk, enable Google sign-in and add the Railway production domain to the allowed production URLs/redirect configuration for the Clerk application.
4. Add the location/tado variables from `.env.example` as needed.
5. Attach a Railway volume and set `RAILWAY_VOLUME_MOUNT_PATH` to the mount path. The app stores `temperature-history.jsonl` and `.tado-token.json` below that path. For first boot, set `TADO_TOKEN_JSON` as a secret Railway variable with the local tado token JSON; after the first refresh, the volume-backed token file keeps future updates.
6. Start command is `pnpm run start`. For Railway Serverless/App Sleeping, set `BACKGROUND_SAMPLER=false` on the web service and use the `POST /api/sample` cron service to record samples.

Railway does not replace app-level auth here. Its "Login with Railway" feature is for letting applications authenticate Railway users and access Railway resources, while this dashboard needs Google sign-in for one private user. Clerk is the cleaner fit and is also one of Railway's documented frontend-auth options.

The app uses generated shadcn UI components for controls, including the chart range buttons. It reads Bright Sky DWD observations for current outdoor temperature and Bright Sky/DWD forecast data so it can show when a useful cooling window is expected soon.
