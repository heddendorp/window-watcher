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

- Clerk handles sign-in. Enable Google as a social connection in Clerk.
- Set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
- Set `AUTHORIZED_EMAIL` to the single Google account that may access the dashboard.
- The server function refuses to return temperature data unless the signed-in Clerk user has a verified Google OAuth account with that email.

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
2. Add `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `AUTHORIZED_EMAIL` as Railway variables.
3. In Clerk, enable Google sign-in and add the Railway production domain to the allowed production URLs/redirect configuration for the Clerk application.
4. Add the location/tado variables from `.env.example` as needed.
5. Attach a Railway volume and set `RAILWAY_VOLUME_MOUNT_PATH` to the mount path. The app stores `temperature-history.jsonl` and `.tado-token.json` below that path.
6. Start command is `pnpm run start`, which launches the built server and starts the background sampler immediately.

Railway does not replace app-level auth here. Its "Login with Railway" feature is for letting applications authenticate Railway users and access Railway resources, while this dashboard needs Google sign-in for one private user. Clerk is the cleaner fit and is also one of Railway's documented frontend-auth options.

The app uses generated shadcn UI components for controls, including the chart range buttons.
