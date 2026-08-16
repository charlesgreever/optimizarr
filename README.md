# Optimizarr

Companion *arr app that inspects Radarr/Sonarr libraries and optimizes media (HEVC/AV1, tracks, stereo) with a review queue.

**PRD:** [issue #1](https://github.com/charlesgreever/optimizarr/issues/1)
**Plan:** [plans/optimizarr.md](plans/optimizarr.md)

## Phase 1

Secure app shell and first-run:

- Persistent SQLite data under `CONFIG_DIR` (default `./config`, `/config` in Docker)
- Arr-style login with argon2id and httpOnly sessions
- First-run creates the admin user and confirms preferred language
- Optimize APIs stay blocked until language is confirmed
- Optional local-address auth bypass
- Empty Movies / Series / Suggestions / Queue / Review / History pages
- Settings never echo secrets

## Run locally

```bash
npm install
npm test
npm run dev
```

API: `http://127.0.0.1:7373`  
UI (Vite): `http://127.0.0.1:5173`

```bash
npm run build
CONFIG_DIR=./config npm start
```

## Docker

```bash
docker compose up --build
```

Open `http://localhost:7373`. Files are written as `PUID`/`PGID` with `TZ` applied, same pattern as the other *arrs.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | Owner of `/config` |
| `TZ` | `America/New_York` | Container timezone |
| `CONFIG_DIR` | `/config` | Persistent DB and settings |
| `PORT` | `7373` | Listen port |
