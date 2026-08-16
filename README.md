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

## Deploy on ubuntuserver (match Arr paths)

`compose.yaml` is written for the same host as Radarr/Sonarr:

- Docker network `arr_net` (so you can use `http://radarr:7878` and `http://sonarr:8989`)
- NAS mount `/mnt/nas:/mnt/nas` (same path the Arrs report)
- Config at `/home/cgreever/appdata/arr/optimizarr/config`
- `PUID`/`PGID` `1000`, `TZ=America/New_York`
- ffmpeg in the image for remux/transcode

```bash
# on ubuntuserver, from a clone or copied stack dir
docker compose up -d --build
```

Open `http://192.168.1.10:7373`. In Settings, add:

- Radarr URL `http://radarr:7878` (or `http://192.168.1.10:7878`)
- Sonarr URL `http://sonarr:8989`

If a movie shows a volume/mount error, the container cannot see the path Radarr stored. The `/mnt/nas` bind above is what makes those paths match.

To use the NVIDIA GPU (same idea as Frigate), uncomment `runtime: nvidia` in `compose.yaml`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | Owner of `/config` and files Optimizarr writes |
| `TZ` | `America/New_York` | Container timezone |
| `CONFIG_DIR` | `/config` | Persistent DB and settings |
| `PORT` | `7373` | Listen port |
