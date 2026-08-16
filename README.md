# Optimizarr

Optimizarr is a companion container for Radarr and Sonarr. It inspects the same library those apps already know, suggests smaller HEVC (or AV1) files and cleaner tracks, and writes a sidecar you Keep or Discard before the library file changes.

**PRD:** [issue #1](https://github.com/charlesgreever/optimizarr/issues/1)
**Plan:** [plans/optimizarr.md](plans/optimizarr.md)
**Engineering standard:** [ENGINEERING_STANDARDS.md](ENGINEERING_STANDARDS.md)
**Prose standard:** [CODING_STANDARDS.md](CODING_STANDARDS.md) (The Elements of Agent Style)

## What it does

- Syncs movies from Radarr and episodes from Sonarr over their APIs
- Opens the network path each Arr reports (same mount as Radarr/Sonarr)
- Flags files over the GB-per-hour cap, extra languages, and missing AAC stereo
- Encodes with the GPU you pass in (NVIDIA NVENC or VAAPI); a hardware failure fails the job
- Writes the result to a review folder outside the library; Keep replaces the original

## Run locally

```bash
npm install
npm test
npm run dev
```

API listens on `http://127.0.0.1:7373`. The Vite UI listens on `http://127.0.0.1:5173`.

```bash
npm run build
CONFIG_DIR=./config npm start
```

## Deploy on ubuntuserver

`compose.yaml` matches the Arr stack on this host:

- Docker network `arr_net` (use `http://radarr:7878` and `http://sonarr:8989`)
- NAS bind `/mnt/nas:/mnt/nas` (same path the Arrs store)
- Config at `/home/cgreever/appdata/arr/optimizarr/config`
- `PUID`/`PGID` `1000`, `TZ=America/New_York`
- ffmpeg in the image

```bash
docker compose up -d --build
```

Open `http://192.168.1.10:7373`. In Settings, add Radarr at `http://radarr:7878` and Sonarr at `http://sonarr:8989`.

If a title shows a volume/mount error, the container cannot read the path Radarr stored. The `/mnt/nas` bind is what makes those paths match.

To use the NVIDIA GPU, uncomment `runtime: nvidia` in `compose.yaml`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | Owner of `/config` and files Optimizarr writes |
| `TZ` | `America/New_York` | Container timezone |
| `CONFIG_DIR` | `/config` | Persistent SQLite and settings |
| `PORT` | `7373` | Listen port |
| `OPTIMIZARR_SECRET` | generated in `/config/.secret` | AES key for Arr API keys and player tokens at rest |
| `OPTIMIZARR_TRUST_PROXY` | unset | Set to `1` only behind a trusted reverse proxy so `X-Forwarded-For` can drive local-address login |
