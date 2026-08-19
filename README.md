# Optimizarr

Optimizarr is a companion container for Radarr and Sonarr. It inspects the same library those apps already know, suggests smaller HEVC (or AV1) files and cleaner tracks, and writes a sidecar you Keep or Discard before the library file changes. Custom title plans, ISO remux, and optional direct write are also supported.

This tree is a greenfield rewrite. Do not import the previous application code.

**PRD:** [docs/v2 prd.md](docs/v2%20prd.md) (v2). The rewrite PRD is [docs/prd.md](docs/prd.md).
**Plan:** [plans/v2-implementation-plan.md](plans/v2-implementation-plan.md)
**Engineering standard:** [ENGINEERING_STANDARDS.md](ENGINEERING_STANDARDS.md)
**Prose standard:** [CODING_STANDARDS.md](CODING_STANDARDS.md)

## What it does

- Syncs movies from Radarr and episodes from Sonarr over their APIs
- Opens the network path each Arr reports
- Inspects MKV with ffprobe and ISO disc images with ffmpeg
- Flags files over the GB-per-hour cap, extra languages, and missing AAC stereo
- Lets you queue a custom plan from a title page: track edits, remux, size mode, or encoder quality
- Muxes tracks with MKVtoolnix and encodes video with the GPU you pass in
- Writes a sidecar for Review by default, or replaces the library file after an integrity check
- Can create named Arr quality profiles from the current size caps without starting a search

## Run locally

```bash
npm install
npm test
npm run dev
```

The API listens on `http://127.0.0.1:7373`. The Vite UI listens on `http://127.0.0.1:5173`.

```bash
npm run build
CONFIG_DIR=./config npm start
```

## Deploy on ubuntuserver

`compose.yaml` matches the Arr stack on that host: Docker network `arr_net`, NAS bind `/mnt/nas:/mnt/nas`, and config under the Arr appdata folder. Host paths belong in compose, not in application code.

```bash
docker compose up -d --build
```

Open `http://192.168.1.10:7373`. In Settings, add Radarr at `http://radarr:7878` and Sonarr at `http://sonarr:8989`, set a review folder outside the library roots, and confirm your preferred language.

The shipped `compose.yaml` passes the host NVIDIA GPU the same way Frigate does: `runtime: nvidia`, `NVIDIA_VISIBLE_DEVICES=all`, and `NVIDIA_DRIVER_CAPABILITIES=compute,utility,video`. `utility` provides `nvidia-smi`. `video` provides NVENC. Recreate the container after changing those values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | Owner of `/config` and files Optimizarr writes |
| `TZ` | `America/New_York` | Container timezone |
| `CONFIG_DIR` | `/config` | Persistent SQLite and settings |
| `PORT` | `7373` | Listen port |
| `OPTIMIZARR_WIDGET_KEY` | unset | Optional Homepage widget key |
| `OPTIMIZARR_TRUST_PROXY` | unset | Set to `1` only behind a trusted reverse proxy |

## Homepage

Optimizarr exposes `GET /api/widget` for a Homepage `customapi` tile. Example YAML: [docs/homepage.md](docs/homepage.md).
