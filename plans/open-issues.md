# Open-Issue Audit and Implementation Plan

Audit date: 2026-08-21. Baseline: `main` at `e045d76`.

Remaining work after the 2026-08-29 full-tree review lives in [review-follow-up.md](review-follow-up.md). Do not treat the 2026-08-21 rows below as the current queue.

## Current remaining work (2026-08-29)

Review baseline: `main` at `5545611`. Open GitHub issues from `gh issue list --state open` that day:

| Issue | Status | Remaining gap |
| --- | --- | --- |
| [#42: Show the running Polisharr version in the app](https://github.com/charlesgreever/polisharr/issues/42) | Open | Sidebar, `GET /api/health`, and Report prefill do not show `package.json` version. Phase 6 of the follow-up plan. |
| [#43: Login doesn't advertise as username and password on mobile](https://github.com/charlesgreever/polisharr/issues/43) | Open | Login fields have autocomplete tokens but no `name`/`id`/`method="post"`, so mobile password managers often ignore them. Phase 6 of the follow-up plan. |

The 2026-08-29 review also found spec and standards gaps that are not GitHub issues yet. Those are phases 1–5 of [review-follow-up.md](review-follow-up.md): Keep/direct-write original-file safety, custom queue that still leaves the bulk suggestion, first-run as a Settings banner, Identify language hiding a missing `WHISPER_LID`, unlabeled size exemption, and type/fixture cleanups.

Re-run `gh issue list --state open` before closing #42 or #43 so a newer report is not hidden.

## Full-Main Review Follow-Up (2026-08-21)

The 2026-08-21 full-main review produced an 18-finding remediation plan. All seven phases of that plan are implemented: request and secret security, domain parsing, Strict Mode paging, queue and output safety, automatic library sync, Suggestions completion, and documentation. [Main Branch Review Remediation](../docs/main-review-remediation.md) maps each behavior to its public regression evidence. Later Keep-crash and cancel gaps are in [review-follow-up.md](review-follow-up.md), not that document.

This section covers every GitHub issue that was open during the 2026-08-21 audit. The audit compared each acceptance list with the public HTTP behavior, server modules, web pages, tests, and commit history. Passing tests support a classification; they do not replace a missing acceptance behavior.

## Status

| Issue | Status | Evidence or Remaining Gap |
| --- | --- | --- |
| [#22: Transcode ISO files with ffmpeg; skip ffprobe](https://github.com/charlesgreever/polisharr/issues/22) | Fixed; ready to close | Commits `782bba3`, `a8f1a2c`, and `4d81bf8` implement the superseding v2 ISO contract. ISO paths bypass ffprobe, ffmpeg listings populate inspection reports, unlisted ISOs remain custom-queueable, remux writes MKV, transcodes use the feature duration, and the output receives an integrity probe. Focused inspector, suggestion, and runner tests pass. |
| [#24: Make library rows denser](https://github.com/charlesgreever/polisharr/issues/24) | Fixed; ready to close | Movies and Series share ordered dense cells, normalized audio/subtitle labels, every plan reason, and explicit waiting/unreadable/none/healthy states. Public HTTP and row-helper tests cover the acceptance states. |
| [#25: Assign a GB/hr-matched Arr profile](https://github.com/charlesgreever/polisharr/issues/25) | Fixed; ready to close | Auto-assign defaults on but can be disabled. One predicate restricts assignment to successful, non-exempt video transcodes. Explicit sync creates or repairs only Polisharr profiles. Fake Radarr/Sonarr tests cover assignment, skip cases, no search, and visible follow-up failures. |
| [#26: PRD: Polisharr v2](https://github.com/charlesgreever/polisharr/issues/26) | Fixed; later gaps | Dense-row, profile, and progressive-Series work shipped. The 2026-08-21 [v2 verification matrix](../docs/v2-verification.md) closed the epic at that date. The 2026-08-29 review found stories 45, 61, 54j, and 67 still incomplete; those are [review-follow-up.md](review-follow-up.md), not a reopen of this issue. |
| [#33: Queue bulk cancel and finished-row removal](https://github.com/charlesgreever/polisharr/issues/33) | Fixed; ready to close | Authenticated Cancel all, Remove, and Clear finished flows now pass through HTTP and Queue UI. Active removal returns a conflict. Removed Queue rows retain the job data required by Review while History, sidecars, suggestions, and media remain intact. |
| [#34: Track real Queue encode progress](https://github.com/charlesgreever/polisharr/issues/34) | Fixed; ready to close | Commit `4c82334` makes ffmpeg emit machine-readable elapsed time. The runner maps it against media duration, progress stays below completion during encode, and the integrity phase precedes 100%. ISO remux progress uses the listed feature duration. Parser and phase-scaling tests pass. |
| [#38: Heavy screens load slowly](https://github.com/charlesgreever/polisharr/issues/38) | Fixed; closed | Batched bounded reads replace the per-row query path. Movies, Suggestions, Queue, Review, Errors, and History return progressive pages; Series returns paged headers first and fetches bounded episode pages only on expansion. Queue and Review suppress overlapping polls while retaining loaded pages. Home and the widget use aggregate counts. The 5,000-episode benchmark reduced the first Series payload from 3,787,645 bytes to 7,023 bytes. |
| [#39: Concurrent jobs will not save](https://github.com/charlesgreever/polisharr/issues/39) | Fixed; ready to close | This issue was filed after the initial audit. The persistence API was already correct; Encode lacked a local Save control. Encode now has an explicit Save encode settings action with a focused rendered-component regression test. |
| [#40: Remux MP4 to MKV from suggestion defaults](https://github.com/charlesgreever/polisharr/issues/40) | Fixed; published | Settings persists an off-by-default MP4 conversion choice. Automatic MP4 suggestions carry an explicit remux action, and the executable plan runs `mkvmerge` before hardware encoding. Under-cap MP4 files can produce remux-only work. The runner accepts MKVToolNix warning exit code 1, probes the output, and preserves stdout diagnostics for exit code 2. Unedited track groups use `mkvmerge` defaults. Filtered groups translate ffprobe selections to MKVToolNix track IDs, so MP4 data streams cannot shift a kept caption ID; the final probe rejects missing planned tracks. Tests cover enabled MP4, MKV, disabled behavior, warning exits, and embedded-caption preservation with track cleanup. |

The focused issue-audit run passed 58 tests across `inspect`, `inspection-runner`, `suggest`, `optimize`, `arr-profiles`, and `app`. The full baseline passed 103 tests, typecheck, and the production build. After the issue #40 caption fix, the current gate passes 142 tests across 25 files, typecheck, the production build, and the diff whitespace check. The latest production dependency audit, run before this dependency-free change, also passed.

## Execution Results

- OI-038: complete. Batched read-model queries, bounded HTTP contracts, progressive browser loading, poll suppression, deep-link paging, global Movies sorting, refresh invalidation, and large-fixture evidence are in place across every primary list page.
- OI-024: complete. A shared dense-row component and presentation helper now preserve every reason and distinguish waiting, unreadable, no-subtitle, healthy, and planned states.
- OI-025: complete. Profile policy, opt-out settings, named-profile repair, both Arr assignment paths, skip rules, and non-fatal warning behavior are covered.
- OI-033: complete. Queue lifecycle operations are transactional and authenticated. Queue hiding preserves promotion data needed by Review instead of physically deleting it.
- OI-026: complete. [All v2 stories 1–92 map to evidence](../docs/v2-verification.md), including the revised summary-first Series contract.
- OI-039: complete. The post-audit issue is included so the audit remains exhaustive as of the final GitHub query.
- OI-040: complete and verified in the working tree. MP4 conversion is an explicit suggestion and job-plan intent, so the runner uses the same mux stage for remux-only and remux-then-transcode jobs.

## Delivery Order

Implement #38 first because it affects every large-library visit and changes the library response contract. Complete #24 on the new read model, then complete #25 and #33. Close #26 after the integrated v2 verification gate.

Each change set must pass `npm test`, `npm run typecheck`, and `npm run build`. Tests assert HTTP responses, queue state, filesystem outcomes, and remote Arr requests instead of SQL statements or React state (ENG-04).

## OI-038: Bound Large-Library Reads

### OI-038-1: Build a Batched Library Read Model

Files: a focused server read-model module, `store.ts`, `app.ts`, tests.

1. Add store queries that return a page of library items with inspection, open suggestion, and error state in batches.
2. Move API-safe row presentation out of the per-route `presentItem` closure into the read-model boundary.
3. Preserve the existing public fields used by Movies, title pages, global search, and row actions.
4. Add indexes only after query-plan evidence identifies a missing index.

Done when response work grows by page size instead of issuing inspection, suggestion, and full-error-list reads for every item.

### OI-038-2: Add Progressive Library Contracts

Files: `app.ts`, `types.ts`, `web/api.ts`, handler tests.

1. Add a bounded Movies endpoint with a stable cursor or page token and a server-enforced maximum page size.
2. Make the first Series response return show identity, Arr instance, episode count, and Optimize-all identity without episode rows.
3. Add an authenticated endpoint that returns a bounded episode page for one Arr instance and series id.
4. Reject ambiguous title-only series keys; use the stored Arr series id plus instance id.
5. Keep title-detail and search endpoints independent of whether a library page is loaded.

Done when a seeded large library produces a bounded first Movies payload and a Series response with zero episode rows.

### OI-038-3: Load and Retain Pages in the Browser

Files: `Movies.tsx`, `Series.tsx`, `api.ts`, shared hooks/components, CSS, focused pure-helper tests.

1. Render the first Movies page, then load more through an explicit control or intersection trigger with one in-flight request.
2. Render Series headers immediately and fetch episodes only when a header opens.
3. Retain loaded episode pages while the operator remains on Series.
4. Expand the focused show when a legacy `?focus=` link is present, then fetch the matching page.
5. Clear retained pages after Refresh and show a row-level retry when one page fails.

Done when opening Series does not request episode rows until expansion and one failed expansion does not blank other shows.

### OI-038-4: Verify the Performance Outcome

1. Seed enough movies, shows, episodes, inspections, suggestions, and errors to exercise paging.
2. Assert maximum response cardinality and continuation metadata through authenticated HTTP.
3. Assert Series summary, one-show expansion, refresh invalidation, and concurrent-request suppression.
4. Record before/after payload bytes and response time on the same seeded fixture as issue-closure evidence; use cardinality and payload bounds as the regression gate.

Done when the first useful response is bounded independently of total episode count.

## OI-024: Finish Dense Library Rows

### OI-024-1: Normalize Public Row Labels

Files: library read model from OI-038, `types.ts`, handler tests.

1. Format audio layouts as `Mono`, `2.0`, `5.1`, or `7.1` instead of raw channel counts.
2. Include subtitle language plus `Forced` and `SDH` from the inspection report.
3. Return an explicit presentation state for uninspected, unreadable, inspected-with-none, healthy, and planned rows.
4. Keep every suggestion reason in order.

Done when public payload tests cover mixed audio/subtitle tracks, two reasons, no subtitles, waiting for inspect, unreadable, and healthy.

### OI-024-2: Share Dense Cells Across Movies and Series

Files: shared web components, `Movies.tsx`, `Series.tsx`, CSS.

1. Render Quality, Codec, Size, Audio, Subtitles, Plan, and Actions with the same component semantics on both pages.
2. Render every reason on its own line.
3. Render `None` only for an inspected file with no subtitles; render an em dash before inspect or on unreadable rows.
4. Preserve the smaller poster, tight padding, Arr instance, title links, and row actions.

Done when Movies and an expanded Series group show the same facts and all plan changes without hiding Actions at a typical desktop width.

## OI-025: Complete Arr Profile Sync and Assignment

### OI-025-1: Model Profile Policy Explicitly

Files: `types.ts`, settings persistence/API, `Settings.tsx`, tests.

1. Add an off/on profile auto-assign setting with a documented default for existing installations.
2. Keep preview and explicit profile sync available when auto-assign is off.
3. Centralize eligibility in one predicate: replacement succeeded, auto-assign enabled, plan contains a video transcode, and the title is not size-exempt.

Done when ISO remux-only, tracks-only, stereo-only, audio-only, exempt, and disabled-setting cases all return ineligible.

### OI-025-2: Create or Repair Only Polisharr Profiles

Files: `arr-profiles.ts`, fake HTTP tests.

1. Define allowed qualities, cutoff, and upgrade behavior for each stable Polisharr profile name.
2. POST missing profiles and PUT drifted Polisharr-named profiles during explicit sync.
3. Report created, updated, unchanged, and failed names accurately.
4. Preserve unrelated profiles and global quality-size definitions.

Done when a cap preview changes locally without remote HTTP and explicit sync repairs one drifted named profile without touching an unrelated profile.

### OI-025-3: Cover Both Arr Promotion Paths

Files: `jobs.ts` or the promotion boundary, `arr-profiles.test.ts`, promote/job tests.

1. Assign a Radarr movie after eligible sidecar Keep and direct write.
2. Assign the Sonarr series after an eligible episode transcode and surface the whole-series warning.
3. Issue no search command.
4. Keep the replacement successful and append a visible warning when profile list, create, or assign returns an error.

Done when fake Radarr and Sonarr tests cover assign, every skip case, and HTTP 500 after a successful replacement.

## OI-033: Add Queue Bulk Lifecycle Operations

### OI-033-1: Add Guarded Queue Operations

Files: `store.ts`, `jobs.ts`, queue tests.

1. Add a transaction that marks every queued, held, paused, and running job cancelled and returns the affected ids.
2. After commit, signal each in-memory runner to stop and let existing cleanup remove partial output.
3. Add guarded removal for one terminal job and one transaction that removes all terminal jobs.
4. Reject removal of active jobs with a conflict.
5. Remove terminal jobs from the Queue view only. Preserve job data needed by Review, History, sidecars, suggestions, and library files.

Done when mixed-status tests prove Cancel all changes every active status, Clear finished leaves active rows, and removal preserves externally visible records and files.

### OI-033-2: Expose Authenticated HTTP and Queue Controls

Files: `app.ts`, `web/api.ts`, `Queue.tsx`, handler tests.

1. Add `POST /api/jobs/cancel-all`.
2. Add `DELETE /api/jobs/:id` for one terminal row.
3. Add `DELETE /api/jobs/finished` for all terminal rows.
4. Show Cancel all only when active rows exist, Remove on terminal rows, and Clear finished when terminal rows exist.
5. Keep rows visible and show the server error when a bulk request fails.

Done when unauthenticated requests return 401 and the authenticated mixed-status flow passes through the HTTP API.

## OI-026: Close the v2 Epic

1. Complete OI-024 and OI-025.
2. Complete the progressive Series contract from OI-038 because issue #38 supersedes the expanded-by-default v2 story.
3. Run the full test suite, typecheck, and production build.
4. Record a story-to-test matrix for v2 stories 1–92, noting the revised Series default and profile auto-assign setting.
5. Review the result separately against the PRD and ENG-14.

Done when every v2 story has passing evidence and #24, #25, and #38 no longer leave a v2 acceptance gap.

## OI-039: Save Encode Settings

Files: `EncodeSettings.tsx`, `Settings.tsx`, focused rendered-component test, v1 PRD.

1. Keep the existing settings persistence boundary.
2. Put an explicit Save encode settings action beside concurrency, target, conservative mode, and off-peak controls.
3. Render-test the section so concurrent-job edits cannot again be presented without a save action.

Done: the button calls the shared Settings save path, and the focused test verifies it is visible beside Concurrent jobs.

## OI-040: Convert MP4 Inputs to MKV

Files: `types.ts`, `settings.ts`, `suggest.ts`, `optimize.ts`, `Settings.tsx`, API types, tests, README, and v1 PRD.

1. Add `convertMp4ToMkv` to `suggestionDefaults`, default it off, validate stored and HTTP values, and show **Convert MP4 to MKV** in Settings.
2. Add a remux action only when the automatic setting is enabled and the library path ends in `.mp4`, ignoring letter case.
3. Carry the action into the executable plan as an explicit input-remux intent.
4. Run the existing `mkvmerge` stage before ffmpeg. Combine track removal and stereo insertion with this mux when those operations also apply.
5. Create remux-only suggestions for under-cap MP4 files. Leave MKV inputs and disabled MP4 behavior unchanged.
6. Cover persisted settings, enabled MP4, remux-only MP4, MKV, and disabled MP4 behavior with public module tests.

Done when an enabled MP4 transcode has `mux` before `encode`, an enabled under-cap MP4 has only `mux`, and the same plans omit `mux` for MKV or a disabled setting.

## Closure Actions (2026-08-21)

- #22, #24, #25, #26, #33, #34, #38, #39, and #40 were ready to close after their changes were committed and published.
- The final `gh issue list --state open` query on 2026-08-21 found #39, which was filed after the audit and is included above.
- A 2026-08-29 query found #42 and #43. Those, plus the later review findings, are the current queue in [review-follow-up.md](review-follow-up.md).
