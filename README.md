# Polisharr

Polisharr is a companion container for Radarr and Sonarr. It inspects the same library those apps already know, suggests smaller HEVC (or AV1) files and cleaner tracks, and writes a sidecar you Keep or Discard before the library file changes. Custom title plans, ISO remux, and optional direct write are also supported.

This tree is a greenfield rewrite. Do not import the previous application code.

**PRD:** [docs/v2 prd.md](docs/v2%20prd.md) (v2). The rewrite PRD is [docs/prd.md](docs/prd.md).
**Plan:** [plans/v2-implementation-plan.md](plans/v2-implementation-plan.md). Review-gap work: [plans/review-gap-remediation.md](plans/review-gap-remediation.md). Home and Settings restyle: [plans/home-settings-title-ui.md](plans/home-settings-title-ui.md).
**Engineering standard:** [ENGINEERING_STANDARDS.md](ENGINEERING_STANDARDS.md)
**Prose standard:** [CODING_STANDARDS.md](CODING_STANDARDS.md)

## What it does

- Syncs movies from Radarr and episodes from Sonarr over their APIs
- Refreshes Arr libraries at startup, every 15 minutes, on request, and when Radarr or Sonarr posts a webhook after import
- Opens the network path each Arr reports
- Inspects MKV with ffprobe and ISO disc images with ffmpeg. Blu-ray remux copies the feature video and usable audio, copies playlist languages onto the Matroska file, ignores dummy AC3 decode errors, and skips audio-only menu listings. A BR-DISK image is opened with the bluray protocol, not as a raw file. A stale ISO listing (the file treated as a lone AC3 stream) is listed again before the next remux. Titles with no file yet stay off Errors. Optional Suggestions can convert ISO to MKV. A title whose only audio is not your preferred language can ask Radarr or Sonarr to search again after you confirm.
- Flags files over the GB-per-hour cap, extra languages, and missing AAC stereo
- Can suggest converting MP4 files to MKV before a hardware encode, or as remux-only work
- Filters Suggestions by media facts or warning state and manages path, profile, tag, and title exclusions
- Lets you queue a custom plan from a title page: track edits, remux, size mode, or encoder quality. The title page shows file name and path. Queue stays off until the plan differs from the source. AV1 appears only when the GPU can encode it. Untagged audio can **Identify language** from a 45-second clip when `WHISPER_LID` is set. Untagged text subtitles can identify language from a few minutes of words (no extra install). Image subtitles (PGS) cannot. A weak sample stays untagged and offers another start time. The library file does not change until Keep.
- Optional language identification: the image ships `/usr/local/bin/whisper-lid` (faster-whisper, tiny model). Set `WHISPER_LID` to that path. The first listen downloads the model into `/config/whisper`. CUDA is used when an NVIDIA device is present; otherwise the clip is identified on CPU. If `WHISPER_LID` is unset, the title page does not offer audio Identify language.
- Home shows a Status strip, large files-optimized and space-saved tiles, and links into Suggestions, Queue, Review, and Errors. Direct write counts in the tallies the same way Keep does.
- Settings uses stacked labels and everyday size-cap names. Title-page audio actions keep a fixed-width dropdown so Keep and Replace with downmix do not jump.
- Series headers show episode total, how many are healthy, and how many still have suggestions. Movies shows the same three counts for the whole Radarr library, not just the loaded page.
- Suggestion, Errors, and Queue titles open the same detail page as Movies and Series
- Size-mode encode reserves room for copied audio. A file within 5% of its GB-per-hour cap counts as meeting it.
- Muxes tracks with MKVtoolnix and encodes video with the GPU you pass in. mkvmerge and ffmpeg run with a UTF-8 locale so titles such as 烧烤 are not truncated.
- Writes a sidecar for Review by default, or replaces the library file after an integrity check
- Lets you Keep one sidecar, Keep selected, or Keep all waiting sidecars after a confirm. Flagged results can queue a smaller encode. Review shows duration and GB per hour. Keep selected reports how many were skipped.
- Checks review-volume free space before work. After restart, interrupted jobs return to the queue. Interrupted Keep cards return to Review so you can retry or discard them. A Keep that already replaced the library file counts as kept.
- Can create named Arr quality profiles from the current size caps without starting a search

## Installation

Polisharr runs as a Docker container next to Radarr and Sonarr. It reads the same library files those apps already know, so the media bind in compose must be that path on both sides. Video encode needs a GPU: NVIDIA (NVENC) or Intel (VAAPI, the Video Acceleration API). There is no CPU encode fallback.

### 1. Get the files

```bash
git clone https://github.com/charlesgreever/optimizarr.git polisharr
cd polisharr
```

### 2. Copy and edit compose

Copy [compose.example.yaml](compose.example.yaml) to `compose.yaml`. Change these values:

- **Media bind.** `/path/to/media:/path/to/media` must match the file path Radarr and Sonarr report. If they see `/mnt/media/Movies/Title.mkv`, both sides of the bind are `/mnt/media`.
- **`PUID` / `PGID`.** Owner of `/config` and files Polisharr writes. Use the same ids as your Arr containers.
- **`TZ`.** Container timezone.

NVIDIA is already selected (`runtime: nvidia` and the `NVIDIA_*` variables). The host needs the NVIDIA container toolkit. `utility` provides `nvidia-smi`. `video` provides NVENC.

For an Intel GPU, comment out `runtime: nvidia` and the `NVIDIA_*` variables, then uncomment `devices: /dev/dri`. ffmpeg uses `/dev/dri/renderD128`. Set `group_add` to the host `render` and `video` group ids (`getent group render video`). The entrypoint keeps those groups after it drops root; otherwise VAAPI fails with `Device creation failed: -22`.

If Radarr and Sonarr already share a Docker network, attach Polisharr to that network so Settings can use `http://radarr:7878`.

### 3. Start

```bash
docker compose up -d --build
```

Recreate the container after you change GPU settings.

### 4. First run

Open `http://localhost:7373` (or the host address you published). Create the admin account. In Settings, add Radarr and Sonarr, set a review folder that sits outside the movie and show libraries, and confirm your preferred language. Optional: add a webhook so new imports show up immediately ([Webhooks from Radarr and Sonarr](#webhooks-from-radarr-and-sonarr)).

Under **Default suggestion operations**, **Convert MP4 to MKV** is off by default. When enabled, Polisharr uses `mkvmerge` to create an MKV before any hardware encode. An MP4 that needs no other work gets a remux-only suggestion.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | Owner of `/config` and files Polisharr writes |
| `TZ` | `UTC` | Container timezone |
| `CONFIG_DIR` | `/config` | Persistent SQLite and settings |
| `PORT` | `7373` | Listen port |
| `POLISHARR_WIDGET_KEY` | unset | Optional Homepage widget key |
| `POLISHARR_TRUST_PROXY` | unset | Set to `1` only behind a trusted reverse proxy |

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

## Webhooks from Radarr and Sonarr

Polisharr already syncs Radarr and Sonarr every 15 minutes. A Connect webhook tells it about a finished import right away so the new file is inspected without waiting. The webhook itself does not start an encode. Optional: **Queue new Arr imports automatically** in suggestion defaults queues a sidecar when inspect produces a suggestion. Keep still replaces the library file.

### 1. Generate a token in Polisharr

In Settings, open **Radarr and Sonarr webhooks** and generate a token. Copy it now. Polisharr stores a hash and will not show the raw token again. Rotate the token if it leaks; the old one stops working.

### 2. Add a Connect webhook in each Arr

In Radarr and in Sonarr: **Settings → Connect → Add → Webhook**.

| Field | Value |
| --- | --- |
| URL | `http://polisharr:7373/api/hooks/arr` on the Arr Docker network, or `http://<host>:7373/api/hooks/arr` from another machine |
| Method | POST |
| On Import | on |
| On Upgrade | on |
| On Rename | on |
| Token | Header `X-Api-Key` with the generated token, **or** the Connect **Password** field (HTTP Basic). Username can be `polisharr`. |

Prefer the header or the password field. A URL with `?apikey=` also works if the form only has a URL box; that puts the token in access logs.

Use **Test**. Polisharr answers 200 when the token is correct.

### 3. What happens on import

Radarr or Sonarr posts after it imports, upgrades, or renames a file. Polisharr syncs that title (or the whole library if the payload has no id), then inspects it. Suggestions appear when inspect finishes. Grab events (download started, file not on disk yet) are ignored.

## Report a bug

Signed-in pages keep a **Report** control on screen. **Bug** and **Change request** open a GitHub issue on this repository with the current route, inspect leftovers, and a running job if there is one. The prefill never includes file paths, API keys, tokens, or passwords. Attach a screenshot on GitHub yourself if one would help.

## Homepage

Polisharr exposes `GET /api/widget` for a Homepage `customapi` tile. Example YAML: [docs/homepage.md](docs/homepage.md).
