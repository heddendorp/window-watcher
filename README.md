# Window Watcher

Window Watcher compares tado room temperatures with nearby outdoor weather for Untergiesing-Harlaching/Giesing so you can decide whether opening the windows will cool the flat. It records readings to a local JSONL history file, shows hoverable trend charts, and bases the recommendation on the outdoor temperature trend.

## Run Locally

```bash
pnpm install
pnpm run build
NODE_ENV=production PORT=3000 pnpm start
```

The app runs on [http://localhost:3000](http://localhost:3000).

Note: the generated TanStack Start dev server currently starts but returns Nitro's `Vite environment "ssr" is unavailable` for page requests in this workspace. Use the production-mode command above until that generated dev-worker issue is resolved.

## Environment

Copy `.env.example` to `.env` if you want to override the defaults.

Important local files:

- `.tado-token.json`: local tado OAuth token, ignored by git
- `data/temperature-history.jsonl`: persistent temperature history, ignored by git

Authentication:

- Set `APP_USERNAME`, default `window`
- Set `APP_PASSWORD` to a strong password before exposing the app
- On Railway, requests fail closed with `503` if `APP_PASSWORD` is missing

## Commands

```bash
pnpm run check
pnpm run build
pnpm run start
```

## Deploy

Railway is represented by `nixpacks.toml`. The service should run as an always-on web service because Window Watcher records every minute; Railway cron jobs currently have a five-minute minimum and are better suited only if lower-resolution sampling is acceptable.

Railway setup:

1. Deploy from the public GitHub repo.
2. Add `APP_PASSWORD`, and optionally `APP_USERNAME`.
3. Add the location/tado variables from `.env.example` as needed.
4. Attach a Railway volume and set `RAILWAY_VOLUME_MOUNT_PATH` to the mount path. The app stores `temperature-history.jsonl` and `.tado-token.json` below that path.
5. Start command is `pnpm run start`, which launches the built server and starts the background sampler immediately.

The app uses generated shadcn UI components for controls, including the chart range buttons.
