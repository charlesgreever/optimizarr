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

## Deploy with Docker

Sample compose files have no household paths. Copy one, set the media bind to the same path Radarr and Sonarr use, then start it. Host paths belong in compose, not in application code.

NVIDIA GPU:

```bash
docker compose -f compose.nvidia.yaml up -d --build
```

Intel GPU (VAAPI, the Video Acceleration API ffmpeg uses on Intel):

```bash
docker compose -f compose.intel.yaml up -d --build
```

Open `http://localhost:7373`. In Settings, add Radarr and Sonarr, set a review folder outside the library roots, and confirm your preferred language.

The media bind must match the file paths those apps already report. If they share a Docker network, attach Optimizarr to that network so Settings can use `http://radarr:7878`.

The NVIDIA sample uses `runtime: nvidia` and `NVIDIA_DRIVER_CAPABILITIES=compute,utility,video`. `utility` provides `nvidia-smi`. `video` provides NVENC. The host needs the NVIDIA container toolkit. Recreate the container after changing those values.

The Intel sample passes `/dev/dri`. ffmpeg uses `/dev/dri/renderD128`. The container user (`PUID`) must be allowed to open that device; on the host, `getent group render` shows the group id to put in `group_add` if encode cannot open it.

This household still uses `compose.yaml` on ubuntuserver (NVIDIA, `/mnt/nas`, Docker network `arr_net`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | Owner of `/config` and files Optimizarr writes |
| `TZ` | `America/New_York` | Container timezone |
| `CONFIG_DIR` | `/config` | Persistent SQLite and settings |
| `PORT` | `7373` | Listen port |
| `OPTIMIZARR_WIDGET_KEY` | unset | Optional Homepage widget key |
| `OPTIMIZARR_TRUST_PROXY` | unset | Set to `1` only behind a trusted reverse proxy |

## Report a bug

Signed-in pages keep a **Report** control on screen. **Bug** and **Change request** open a GitHub issue on this repository with the current route, inspect leftovers, and a running job if there is one. The prefill never includes file paths, API keys, tokens, or passwords. Attach a screenshot on GitHub yourself if one would help.

## Homepage

Optimizarr exposes `GET /api/widget` for a Homepage `customapi` tile. Example YAML: [docs/homepage.md](docs/homepage.md).
