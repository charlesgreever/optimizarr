# Plan: Optimizarr

> Source PRD: https://github.com/charlesgreever/optimizarr/issues/1

## Architectural decisions

Durable decisions that apply across all phases:

- **App shape**: Portable companion container. Radarr/Sonarr remain the library of record. Optimizarr syncs over their APIs and uses the same network paths they report. No path-mapping layer in v1. First test host is ubuntuserver (NVIDIA/CUDA); VAAPI stays a supported backend when that device is passed in.
- **Routes (UI)**:
  - `/login`
  - `/first-run`
  - `/movies`
  - `/series`
  - `/suggestions`
  - `/queue`
  - `/review`
  - `/history`
  - `/settings`
- **Routes (API)**:
  - `/api/auth/*` — login, logout, session
  - `/api/settings` — caps, language, schedule, encode options
  - `/api/instances` — Radarr, Sonarr, and player connections
  - `/api/library/movies` and `/api/library/series`
  - `/api/suggestions`
  - `/api/queue` and `/api/jobs`
  - `/api/review` — list, keep, discard, requeue
- **Key models**:
  - `User` — single admin, password hash, session
  - `Settings` — preferred language + confirmed flag, size-per-hour caps, target codec (HEVC default, AV1 opt-in), concurrency, multi-segment, off-peak window, NAS vs local-copy, auto-optimize, review path
  - `ArrInstance` — kind (`radarr` | `sonarr`), URL, API key, enabled
  - `PlayerInstance` — kind (`plex` | `jellyfin` | other), URL, token, enabled
  - `LibraryItem` — Arr external id, instance, type (`movie` | `episode`), title, path, quality/resolution/HDR, recorded media info
  - `InspectionReport` — codec, bit depth, HDR/DV, duration, size and size/hour, audio layouts, subtitle languages, untagged tracks
  - `Suggestion` — type (transcode, remux tracks, add stereo), warnings, estimated savings, dismissed flag
  - `Job` — plan, status, progress, error, schedule hold
  - `SidecarReview` — source path, sidecar path, compare stats, flagged-missed-target, pending lock
- **Schema shape**: Persistent app volume holds users, settings, instances, synced library rows, suggestions, jobs, and reviews. Secrets stored hashed or encrypted at rest; never echoed back after save.
- **Auth**: Arr-style local login with a modern password hash and server sessions. Optional local-address auth bypass.
- **Size policy**: GB (or MB) per hour. Defaults — Movie 1080p 2.5, Movie 4K SDR 6, Movie 4K HDR 8, TV 1080p 1.0, TV 4K 4.0. Encodes aim at the category target.
- **Track policy**: Keep all preferred-language audio/subs (including SDH, forced, commentary). Strip other languages. Drop untagged tracks except the only audio. A lone untagged dialogue track is kept so remux cannot silence the file. When a file needs track cleanup and a codec or size encode, remux extras first, then transcode that remuxed working file. The library file stays untouched until Keep. Original surround stays when AAC stereo is added.
- **Output policy**: Sidecar on a configurable NAS review path outside Arr library roots. Original untouched until Keep. Keep replaces, deletes the original, asks the Arr to rename/refresh, notifies all configured players. Missed target or larger-than-source: keep sidecar and flag for review.
- **Execution policy**: Default one job, multi-segment off, work on the NAS. Honor user concurrency. Optional local copy-before-encode. Optional off-peak window with run-now override. Hardware encode only (CUDA/VAAPI). Hardware failure fails the job and is shown; no software fallback.
- **Third-party boundaries**: Radarr API, Sonarr API, Plex API, Jellyfin API, ffprobe/ffmpeg (and remux tooling) for inspect/optimize. Players and Arrs are notified after Keep; notify/rename failure does not roll back a successful replace.
- **UI**: Arr-like sidebar (library, suggestions, queue, review, settings) with a more modern Tailwind look, usable on a phone on the LAN.
- **Tests**: Every phase ships tests for the modules it touches, asserting public behavior only.

---

## Phase 1: Secure app shell and first-run

**User stories**: 1, 2, 4, 5, 6, 7, 8, 9, 10, 30, 85, 86, 95, 101, 102, 103

### What to build

A runnable container with persistent config, Arr-style login (secure password hash and sessions, optional local-address bypass), and a first-run flow that creates the admin user and requires preferred-language confirmation before any optimize action. After login the user sees an empty but navigable shell: movies, series, suggestions, queue, review, settings. Optimize APIs stay blocked until first-run is complete. Settings never echo secrets after save.

### Acceptance criteria

- [x] Container starts with a persistent data volume and writes files as the configured PUID/PGID and timezone.
- [x] First visit with no admin walks through first-run (account + preferred language) before the main app is usable.
- [x] Login, logout, bad password, and session expiry behave correctly; optional local-address bypass can be enabled or disabled.
- [x] Changing username/password works; stored secrets are not returned by the settings API after save.
- [x] Empty library / suggestions / queue states explain what to do next.
- [x] Sidebar matches the Arr information architecture and the layout works on a small viewport.
- [x] Tests cover auth, first-run gating, and “optimize blocked until language confirmed.”

---

## Phase 2: Sync a Radarr library

**User stories**: 11, 14, 15, 16, 21, 23, 31, 32, 94, 104

### What to build

Connect a single Radarr instance (URL, API key, enabled flag, test-connection). Sync movies over the API on a background interval and on demand. The movies page lists titles with the metadata Radarr already has and the **same network path** Radarr reports. Bad credentials and unreadable paths are explicit errors, not an empty list with no explanation.

### Acceptance criteria

- [x] Saving a Radarr instance and testing the connection succeeds or shows a clear API/URL error.
- [x] Synced movies show title, path, quality/codec info from Radarr, and which instance they came from.
- [x] Optimizarr opens the path Radarr reported (no rewritten mount prefix).
- [x] An unreadable path is surfaced as a volume/mount problem on that item.
- [x] Library refresh happens on an interval and from a manual refresh action.
- [x] Tests cover one-instance sync, auth failure, and path-not-readable against fake Radarr HTTP.

---

## Phase 3: Inspect and suggest

**User stories**: 17, 18, 24, 26, 28, 29, 33, 34, 35, 36, 37, 46, 47, 48, 49, 89, 90, 96, 97, 98, 105, 106, 107, 112, 113, 114

### What to build

Inspect each library file (plus Arr metadata) into an `InspectionReport`, then run the suggestion engine against settings. The suggestions page lists only items with work: over size cap, extra/non-preferred/untagged tracks, remux-only when video is already good, transcode toward HEVC, DV/HDR warnings as informational for later phases. Users can filter, search, dismiss, and force a suggestion on a healthy file. No encodes run in this phase. Size caps are the shipped defaults and are tunable in settings.

### Acceptance criteria

- [x] New and existing items are inspected; healthy files do not appear on the suggestions list.
- [x] Size-per-hour uses the correct category (movie vs later TV type, 1080p vs 4K, HDR vs SDR) and the shipped defaults unless the user changed them.
- [x] Preferred-language tracks are kept in the plan; other languages are suggested for strip; untagged tracks are suggested for drop.
- [x] Already-HEVC (or AV1) under-cap files with messy tracks get remux-only suggestions, not a re-encode.
- [x] AV1 sources are not suggested back to HEVC.
- [x] User can dismiss a suggestion and force work on a file that is under the cap.
- [x] Filters and title search narrow the suggestions list.
- [x] Estimated space savings appear on size-related suggestions.
- [x] Tests are table-driven on the suggestion engine and fixture-based on the inspector; no real NAS required.

---

## Phase 4: Remux to review and Keep

**User stories**: 54, 63, 65, 66, 67, 68, 69, 70, 71, 72, 73, 83, 93, 108, 110, 111, 117, 119, 120

### What to build

The first complete optimize loop, remux-only: approve a track-cleanup suggestion onto the queue (single job). Work on the NAS, write a sidecar to the configurable review path (never an Arr library folder), leave the original playing. Review UI compares source vs sidecar (size, codec, duration, tracks, size/hour). Keep replaces the library file, deletes the original, asks Radarr to rename/refresh, and notifies every configured player (Plex and Jellyfin). Discard deletes only the sidecar. Failed jobs and crashed runs never delete the only copy. A title with a pending sidecar cannot be queued again.

### Acceptance criteria

- [x] A remux job writes only to the review path; the library folder still has exactly the original until Keep.
- [x] Review shows side-by-side metadata (and playback or a clear compare if playback is not ready).
- [x] Keep replaces the original, deletes the old file, and requests Arr rename/media-info refresh.
- [x] Keep notifies all configured players; a player or Arr outage is reported and does not undo the replace.
- [x] Discard deletes the sidecar and leaves the original.
- [x] Permission errors on Keep leave both files and show the error.
- [x] Duration/integrity failure does not present a truncated file as success; temps are cleaned up.
- [x] A second job cannot start while a sidecar for that title is pending.
- [x] Tests cover Keep, Discard, Arr/player fakes, pending lock, and “original survives failure.”

---

## Phase 5: HEVC transcode to size target

**User stories**: 3, 38, 39, 40, 43, 44, 45, 78, 79, 80, 87, 88

### What to build

Approve a transcode suggestion. The runner uses hardware encode (CUDA or VAAPI from the device passed into the container), targets HEVC, aims at the category GB/hour cap, and preserves bit depth. Dolby Vision / HDR10+ items still get the suggestion, with an explicit warning that that metadata may be lost. Detected backends are visible in the UI. If hardware encode fails, the job fails and the user is told; there is no software fallback. Review/Keep from Phase 4 still applies.

### Acceptance criteria

- [x] H.264 (and other less efficient video) can be queued to HEVC aimed at the size cap.
- [x] Output bit depth matches the source.
- [x] DV/HDR10+ transcodes show a metadata-loss warning before and on the job.
- [x] UI shows which backends were detected (CUDA, VAAPI, AV1 capability reserved for a later phase).
- [x] Hardware failure fails the job, keeps the original, and shows a hardware error (no CPU encode).
- [x] Successful output goes through the same sidecar + Keep/Discard path as remux.
- [x] A file that needs extra-track cleanup and a codec or size encode remuxes first, then transcodes, in one job. The library file is unchanged until Keep.
- [x] Tests cover target-aim behavior, bit-depth preservation on fixtures, DV warning, and hardware-failure → failed job.

---

## Phase 6: Add AAC stereo

**User stories**: 50, 51, 52, 53, 109

### What to build

Suggest adding AAC stereo when the file has Atmos or more than 5.1, and always offer it as a manual action when the file is not already stereo. The original surround/Atmos track stays. Chapters and attachments are copied. Stereo-add-only jobs use the same review and Keep path.

### Acceptance criteria

- [x] Atmos or >5.1 produces a stereo-add suggestion; stereo files do not.
- [x] User can add stereo to any non-stereo file from the UI even when it was not auto-suggested.
- [x] Result contains original audio plus one AAC 2.0. The surround/Atmos track is not duplicated.
- [x] Chapters and attachments survive the job.
- [x] Stereo-add-only still requires Keep before the library file changes.
- [x] Tests cover suggest vs manual, “original audio retained,” and remux of chapters/attachments.

---

## Phase 7: Sonarr and multiple instances

**User stories**: 12, 13, 22, 104, 105, 128, 129, 130

### What to build

Multiple Radarr and Sonarr instances, each with URL, API key, and enable flag. Series/episode library view. TV vs movie size rules come from the Arr type. A 4K copy and a 1080p copy from different instances stay distinct and show their source instance. Suggestions and jobs work for episodes the same way as movies.

### Acceptance criteria

- [x] Two Radarrs and one Sonarr can be enabled at once; disabling one stops syncing it without affecting others.
- [x] Series suggestions, queue, review, and history show show title / season / episode title, and search matches the show name.
- [x] Series page lists shows and episodes with Arr metadata and paths.
- [x] Episode files use TV size caps; movies use movie caps.
- [x] Each item shows which instance it came from.
- [x] Suggestions, queue, and Keep work for a Sonarr episode.
- [x] Tests cover multi-instance sync, enable/disable, and movie vs TV category selection.

---

## Phase 8: Queue, schedule, and concurrency

**User stories**: 25, 27, 55, 56, 57, 58, 60, 61, 62, 81, 82, 84, 99, 115, 121, 122, 123, 124, 125, 126, 127

### What to build

A real queue: reorder, pause, remove, bulk-approve a movie, series, or filtered list. Default concurrency is one; a setting allows more and is honored as set. Off-peak window holds jobs until the window; a job can be forced to run now. Running jobs show progress and ETA. Cancel leaves the original. Container restart resumes or re-queues without half-writing a library file. Per-job logs are available.

### Acceptance criteria

- [x] Default is one active job; raising concurrency runs that many; lowering waits for extras to finish.
- [x] Off-peak holds work until the window; run-now starts immediately.
- [x] Bulk-approve from a movie, a series, or the current filter adds those plans to the queue.
- [x] Pause, reorder, and cancel work; cancel never replaces the original.
- [x] Queue shows Cancel on queued, held, and running jobs; a stalled running job can be cancelled and does not promote a sidecar.
- [x] Restart does not lose queued work or leave a partial library file.
- [x] Progress/ETA and per-job logs are visible.
- [x] Tests use a fake clock for the schedule and fake runners for concurrency/cancel/restart.

---

## Phase 9: AV1, local copy, multi-segment, missed-target retry

**User stories**: 41, 42, 59, 64, 75, 76, 77

### What to build

AV1 is selectable only when hardware encode for AV1 is present; otherwise it is hidden/disabled. Optional copy-to-local-disk before convert, then sidecar still lands on the NAS review path. Optional multi-segment parallel encode, off by default. If the result misses the GB/hour cap or is larger than the source, keep the sidecar, flag it for review, and let the user re-queue more aggressively. Integrity/duration checks still apply.

### Acceptance criteria

- [x] AV1 appears only when the capability probe says the hardware can encode it.
- [x] Local-copy mode copies in, encodes, and publishes the sidecar to the NAS review path.
- [x] NAS-in-place remains the default when local copy is off.
- [x] Multi-segment can be enabled per settings or job and is off by default.
- [x] Over-cap or larger-than-source outputs stay in review with a flag, not auto-deleted.
- [x] User can re-queue a flagged item with a more aggressive target.
- [x] Tests cover capability gating, both work modes, missed-target flag, and requeue.

---

## Phase 10: Auto-optimize new imports and exclusions

**User stories**: 19, 20, 91, 92, 116, 118

### What to build

When auto-optimize is on, a newly imported Arr item is inspected and queued with the full plan (transcode, remux, stereo) without approval; the result is still a sidecar awaiting Keep/Discard. Later Arr upgrades are re-inspected. Users can exclude a path, quality profile, tag, or title. Jobs preflight disk space on the review path (and local scratch if enabled). Activity history lists finished, flagged, discarded, and kept work.

### Acceptance criteria

- [x] With auto-optimize off, new imports become suggestions only.
- [x] With auto-optimize on, new imports are queued with the full plan and still require Keep to replace the library file.
- [x] A later Arr upgrade is inspected again and can generate new suggestions.
- [x] Excluded path/tag/profile/title items are not suggested or auto-queued.
- [x] A job does not start if review (or scratch) space is insufficient; the user sees why.
- [x] History shows kept, discarded, flagged, and failed outcomes.
- [x] Tests cover auto vs manual, upgrade re-inspect, exclusions, and disk preflight.

---

## Phase order and demo checkpoints

| Phase | Demo you should be able to do |
| --- | --- |
| 1 | Log in on ubuntuserver, confirm English, click around an empty app |
| 2 | See your real Radarr movies and paths |
| 3 | See which titles are too big or have extra languages — no files written |
| 4 | Clean tracks on one movie, review the sidecar, Keep, watch Radarr/Plex update |
| 5 | HEVC-encode one oversized H.264 movie to the size cap |
| 6 | Add stereo to an Atmos title, confirm surround is still there |
| 7 | Turn on Sonarr + a second Radarr |
| 8 | Park encodes overnight, bump concurrency, cancel a job |
| 9 | Try AV1 if the GPU allows; flag a miss and retry |
| 10 | Import a movie in Radarr and have Optimizarr queue it by itself |
