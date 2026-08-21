# Main Branch Review Remediation

Review date: 2026-08-21. Baseline: `main` at `d57e82f`.

The full-main review reported 18 unique findings. This document records the implemented behavior and its regression evidence. Tests exercise HTTP responses, public service methods, optimizer arguments, persistence, and rendered React behavior.

## Security and Trust Boundaries

| Finding | Implemented behavior | Regression evidence |
| --- | --- | --- |
| Forwarded-address authentication bypass | Local login bypass reads the Node connection address. Forwarding headers apply only when `OPTIMIZARR_TRUST_PROXY=1`; `X-Real-IP` is never a peer-address source. | `app.test.ts`: spoofed local headers receive `401`. |
| Arr key sent to an external poster host | Arr-hosted poster paths are preferred. The proxy adds `X-Api-Key` only when the resolved poster origin matches the configured Arr origin. | `arr.test.ts` and `app.test.ts`: local path selection and external-host header check. |
| Plex token in refresh URL | Plex refresh uses the `X-Plex-Token` request header. | `promote.test.ts`: URL and header assertion. |
| Review path checked against title folders | Sync stores `/api/v3/rootfolder` paths per Arr instance. Settings and sync reject review paths that contain, equal, or sit inside a stored root. | `app.test.ts`: a sibling of a title inside the Arr root is rejected. |

## Input, Paging, and Mutation Behavior

Settings now pass through one parser for HTTP updates and persisted JSON. Invalid numbers, booleans, times, enums, and nested values return `400` without changing saved settings. Store adapters map integration, media, job, review, and history values into closed TypeScript unions. Missing suggestion and job mutations return `404`; Run now rejects terminal jobs with `409`.

`usePagedList` restores its mounted state during React Strict Mode effect replay. The hook and the library helpers share one first-page refresh function. A rendered Strict Mode test proves the first page leaves its loading state.

## Queue and Output Safety

Bulk queue jobs convert their suggestion into an executable plan at enqueue time and persist the global sidecar or direct-write policy. Changing only the output policy does not make an empty media plan valid. Removing every subtitle emits `mkvmerge --no-subtitles`.

Startup returns persisted `running` jobs to `queued` with a recovery message. The optimizer checks free space on the review volume before starting media tools. Its estimate reserves the larger of source or planned output plus 256 MiB. Queue rows show suggestion warnings and post-Keep Arr or player warnings.

## Library Synchronization

`LibrarySync` owns startup, interval, and manual refresh. Its default interval is 15 minutes. Concurrent triggers share one in-flight refresh, so opening the app while the timer or Refresh button fires does not duplicate Arr requests. Metadata is stored before background inspection starts.

## Suggestions and Exclusions

Suggestions supports typed filters for media type, 1080p or 4K, HDR or SDR, codec, over-cap state, extra tracks, size exemptions, and warnings. The same store query drives paged results and Queue filtered. Movie and TV bulk work use the media-type filter.

Settings provides exclusion management for path prefixes, quality profiles, tags, and titles. Adding or removing a rule recomputes suggestions from saved inspections. Suggestion rows show current tracks and the tracks that remain. Track-only work leaves After size and GB/hour blank.

## Verification Gate

The completed delivery gate passed:

- `npm test`: 127 tests across 22 files.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm audit --omit=dev`: zero production vulnerabilities.
- `git diff --check`: passed.

The spec review found no remaining break from the 18-finding plan or PRD stories 20, 41, 42, 63, 64, 118, 120, 123, 137, and 138. The standards review passed the ENG-14 checklist. Authentication, secrets, filesystem safety, public-behavior tests, domain types, module boundaries, and tool argument arrays remain explicit.
