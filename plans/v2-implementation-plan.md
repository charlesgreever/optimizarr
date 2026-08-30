# Polisharr v2 Implementation Plan

This plan turns [v2 prd.md](../docs/v2%20prd.md) into bounded implementation tasks for an AI coding agent. The agent must also read [prd.md](../docs/prd.md), [ENGINEERING_STANDARDS.md](../ENGINEERING_STANDARDS.md), and [CODING_STANDARDS.md](../CODING_STANDARDS.md) before changing code or user-facing copy. The v2 PRD wins where it conflicts with v1.

The implementation has shipped this plan, including issues #24, #25, #26, #33, and #38. [open-issues.md](open-issues.md) records the 2026-08-21 audit and closure evidence. Remaining work after the 2026-08-29 review, including GitHub issues #42 and #43, lives in [review-follow-up.md](review-follow-up.md).

## Delivery rules

- Complete tasks in order unless a task explicitly says it can run in parallel.
- Keep each task small enough for one focused change and its tests.
- Add tests with each behavior change. Do not defer tests to a cleanup phase.
- Test public behavior: parsed inspection reports, validated plans, HTTP payloads, filesystem outcomes, Arr requests, and rendered user-visible text. Do not assert SQL layout, private React state, or ffmpeg argument order unless the order changes observable behavior (ENG-04).
- Keep ffmpeg, ffprobe, and `mkvmerge` calls as executable plus argument arrays (ENG-08).
- Preserve the original library file on every failure and cancellation path. Direct write is the named ENG-09 exception and must remain off by default.
- Do not add CPU video encoding. A missing hardware encoder must fail a video transcode (ENG-05).
- Run `npm test`, `npm run typecheck`, and `npm run build` at every phase gate.

## Target module boundaries

| Module | Responsibility |
| --- | --- |
| `types.ts` | Shared domain values and API-safe shapes |
| `inspect.ts` | Convert ffprobe or ffmpeg listing output into one inspection report |
| `suggest.ts` | Build automatic bulk suggestions only |
| `custom-plan.ts` | Validate operator choices and return a complete custom plan or errors |
| `optimize.ts` | Execute a validated plan; never invent track policy |
| `promote.ts` | Integrity-gated library replacement, Arr refresh/profile assignment, and player notification |
| `arr.ts` | Parse Arr payloads and perform Arr profile HTTP operations |
| `store.ts` | Persist settings, inspections, plans, jobs, review items, and sync metadata |
| `jobs.ts` | Lock, schedule, run, cancel, review, and direct-write jobs |
| `app.ts` | Authenticate and expose HTTP operations |
| Web pages/components | Render API values and collect custom-plan drafts |

`promote.ts` is a planned extraction from the current Keep logic in `jobs.ts`. This keeps encoding, orchestration, and promotion independently testable (ENG-10).

## Phase 0 — Baseline and fixtures

### V2-001: Record the starting contract

Files: no production changes.

1. Run the current test, typecheck, and build commands.
2. Record any existing failures before v2 work begins.
3. Confirm the working tree does not contain unrelated changes that overlap the planned files.

Done when the agent can distinguish a v2 regression from a pre-existing failure.

### V2-002: Add reusable v2 inspection fixtures

Files: test fixture directory beside existing inspector tests, `src/server/inspect.test.ts`.

1. Add a normal MKV ffprobe fixture with video, chapters, attachments, several audio layouts, and subtitles.
2. Add an ffmpeg ISO listing fixture with video, multiple audio tracks, and subtitles.
3. Add an ISO listing failure fixture or fake-process result.
4. Add a 4K 10-bit HDR fixture for estimate, warning, and downscale tests.

Done when later tests can use recorded documents without a NAS, ISO image, GPU, or installed media tool.

## Phase 1 — Domain model and persistence

### V2-010: Separate automatic suggestions from executable plans

Files: `src/server/types.ts`, `src/server/suggest.ts`, affected tests.

1. Keep `Suggestion` as the automatic recommendation model.
2. Introduce an executable plan union with an explicit origin: `bulk` or `custom`.
3. Model video intent as `copy`, size-mode transcode, or quality-mode transcode so size and quality cannot coexist in a valid plan.
4. Model audio operations as keep, remove, same-layout AAC replacement, downmix replacement, or additional downmix.
5. Model subtitle operations as keep or remove.
6. Store output container, optional 4K-to-1080p downscale, write mode, warning text, human-readable reasons, and estimated output bytes.
7. Add a plan predicate that answers whether the job contains a video transcode; promotion will use this instead of inferring from text.

Done when TypeScript makes contradictory executable plans difficult to construct and existing bulk suggestions still compile.

### V2-011: Represent ISO inspection outcomes

Files: `src/server/types.ts`, `src/server/inspect.ts`.

1. Extend the inspection report with its source method (`ffprobe` or ISO ffmpeg listing) and stream-listing state.
2. Represent ISO listing failure as a distinct bounded state, not a fabricated ffprobe error and not invented empty streams.
3. Preserve the report fields consumed by `suggest.ts` for successfully listed ISOs.
4. Add helpers for `isIsoPath` and whether track editing is available.

Done when callers can distinguish a normal report, a listed ISO, and an ISO whose streams could not be listed.

### V2-012: Add direct-write settings

Files: `src/server/types.ts`, `src/server/store.ts`, `src/server/store.test.ts`, settings API tests.

1. Add a global write mode with `sidecar` as the default and `direct` as the opt-in value.
2. Migrate existing settings rows without changing their effective behavior.
3. Ensure settings serialization exposes the mode but never exposes secrets.
4. Test default, save, reload, and migration behavior.

Done when an existing installation remains sidecar-first and a saved direct-write choice survives restart.

### V2-013: Persist custom plans and job write mode

Files: `src/server/store.ts`, `src/server/store.test.ts`, `src/server/types.ts`.

1. Store the full validated executable plan on a job, including plan origin and effective write mode.
2. Preserve the nullable automatic suggestion link for bulk jobs; custom jobs must not need a suggestion id.
3. Add persistence for promotion warnings/errors that occur after the output file has replaced the source.
4. Verify old persisted bulk plans still load or add an explicit migration.

Done when a process restart does not lose the operator’s custom choices or direct-write decision.

### V2-014: Store Arr identifiers needed for profile assignment

Files: `src/server/types.ts`, `src/server/arr.ts`, `src/server/store.ts`, sync tests.

1. Preserve the Radarr movie id for movies.
2. Preserve both Sonarr series id and episode/file identity for episodes.
3. Do not overload one ambiguous `arrId` when promotion needs different resources.
4. Migrate existing rows and verify refresh behavior still targets the same resource as v1.

Done when promotion can assign a Radarr movie profile or a Sonarr series profile without reparsing a title string.

### Phase 1 gate

- All existing v1 tests pass.
- New types express size/quality XOR, plan origin, write mode, and ISO listing state.
- Existing databases load with sidecar mode and valid library rows.

## Phase 2 — ISO inspection and bulk suggestions

### V2-020: Parse ffmpeg stream listings

Files: `src/server/inspect.ts`, `src/server/inspect.test.ts`.

1. Add a parser that maps the recorded ffmpeg listing to `InspectionReport`.
2. Normalize language, codec, channel count/layout, subtitle flags, video size, duration, bit depth, and HDR where the listing provides them.
3. Leave unavailable facts unknown; do not copy invented values from the library row.
4. Return a distinct listing-failed result when ffmpeg cannot enumerate streams.

Done when MKV and successfully listed ISO fixtures produce the same public report shape.

### V2-021: Route ISO inspection around ffprobe

Files: `src/server/app.ts` or a new inspector service, `src/server/inspect.ts`, app/inspect tests.

1. Detect `.iso` case-insensitively.
2. Invoke ffmpeg listing for ISO paths and never invoke ffprobe for them.
3. Keep ffprobe unchanged for MKV, MP4, and other existing inputs.
4. Bound ISO listing failure so the background inspector does not retry forever.
5. Store the distinct ISO listing state and remove stale ffprobe-style errors for that item.

Done when tests prove ffprobe call count is zero for `.iso` and `.ISO`, and unchanged for `.mkv`.

### V2-022: Feed listed ISOs into automatic suggestions

Files: `src/server/suggest.ts`, `src/server/suggest.test.ts`, refresh/inspection orchestration tests.

1. Allow a successfully listed ISO report through existing size-cap, preferred-language, and stereo rules.
2. Preserve all v1 suggestion behavior for non-ISO files.
3. Keep an unlisted ISO out of automatic Suggestions without classifying it as an ffprobe failure.
4. Ensure its title remains addressable for custom remux or encode later.

Done when a listed ISO can receive size, track, and stereo reasons and an unlisted ISO remains a library item without a false ffprobe error.

### Phase 2 gate

- Inspector tests cover listed ISO, failed ISO listing, uppercase extension, and unchanged MKV probing.
- Suggestion tests show listed ISO parity with normal reports.

## Phase 3 — Custom-plan deep module

### V2-030: Define the custom-plan draft and result API

Files: new `src/server/custom-plan.ts`, new `src/server/custom-plan.test.ts`, `src/server/types.ts`.

1. Define a serializable draft that contains only operator choices, not derived ffmpeg flags.
2. Define a result union: `{ plan }` or `{ errors }` with field-specific, user-readable errors.
3. Accept an inspection report, library item, settings, hardware capability, and draft.
4. Keep this module pure: no database, filesystem, HTTP, or process execution.

Done when a fixture inspection plus a draft is sufficient to test every validation rule.

### V2-031: Validate do-nothing, track removal, and ISO remux

Files: `src/server/custom-plan.ts`, `src/server/custom-plan.test.ts`.

1. Reject an already-MKV plan with no track, audio, video, container, or write-mode work.
2. Allow individual audio and subtitle removal when streams are listed.
3. Reject removal of every usable audio stream.
4. Hide or reject track operations when ISO stream listing failed.
5. Treat ISO-to-MKV with video copy and no size/quality mode as real remux work.
6. Always select Matroska output for ISO work.

Done when empty MKV cannot queue, listed ISO supports track edits, and unlisted ISO can still remux.

### V2-032: Validate AAC replacement and downmix

Files: `src/server/custom-plan.ts`, `src/server/custom-plan.test.ts`.

1. Allow AAC codec replacement only from an existing audio track and at the same channel layout.
2. Ensure replacement removes the source audio track from the output plan.
3. Do not allow same-layout AAC as an additional track.
4. Offer only smaller valid downmix layouts, including 5.1 and stereo when the source is wider.
5. Allow a downmix as either replacement or additional audio.
6. Reject references to streams absent from the inspection report.

Done when tests distinguish codec replacement, replacement downmix, and additional downmix.

### V2-033: Validate video modes and downscale

Files: `src/server/custom-plan.ts`, `src/server/custom-plan.test.ts`.

1. Model target file size and encoder quality as mutually exclusive modes.
2. Reject non-positive or unreasonable target sizes and out-of-range quality values with field errors.
3. Default custom video transcodes to HEVC.
4. Allow AV1 only when hardware capability reports AV1 encode support.
5. Allow 4K-to-1080p only for a 4K source and only with a video transcode mode.
6. Carry source bit depth into the executable plan.
7. Add the existing Dolby Vision/HDR10+ metadata warning to custom transcodes.

Done when tests cover both XOR directions, AV1 gating, downscale rejection on remux, bit-depth preservation, and HDR warning text.

### V2-034: Calculate quick size estimates

Files: `src/server/custom-plan.ts` or new `src/server/estimate.ts`, corresponding tests.

1. Return the entered target file size exactly in size mode.
2. Create a documented heuristic for quality mode using source size, duration, resolution, downscale, codec, and quality value.
3. Keep the estimate deterministic and fast; do not run a sample encode.
4. Clamp or reject nonsensical results and label the value as an estimate.
5. Table-test monotonic behavior: a more aggressive quality setting or downscale must not estimate a larger output under otherwise identical inputs.

Done when the UI can request or compute a stable estimate without duplicating plan rules.

### V2-035: Produce complete plan details and reasons

Files: `src/server/custom-plan.ts`, `src/server/custom-plan.test.ts`, shared presentation helper if needed.

1. Generate one reason line per video, audio, subtitle, remux, and write-mode change.
2. Name size mode versus encoder-quality mode explicitly.
3. Record effective write mode after applying the per-job override to the global default.
4. Mark whether the plan is a video transcode for later profile assignment.
5. Keep prose understandable without unexplained codec or Arr shorthand.

Done when callers do not need to inspect private plan fields to explain the work.

### Phase 3 gate

- `custom-plan.ts` has no side effects.
- Its tests cover stories 20–50 and developer story 87 at the domain level.
- The runner can treat its result as authoritative policy.

## Phase 4 — Optimize runner

### V2-040: Make the runner consume executable plans

Files: `src/server/optimize.ts`, `src/server/optimize.test.ts`, `src/server/jobs.ts`.

1. Change `OptimizeRequest` to carry the executable plan rather than only an automatic suggestion.
2. Adapt bulk suggestions into executable bulk plans before enqueue or at one named boundary.
3. Keep plan interpretation in one dispatcher; the runner must not re-decide which tracks to keep.
4. Preserve current progress callbacks, cancellation checks, bounded errors, and temp cleanup.

Done when existing bulk jobs pass through the new plan shape without behavior changes.

### V2-041: Implement ISO remux

Files: `src/server/optimize.ts`, `src/server/optimize.test.ts`.

1. Use ffmpeg to read ISO and write MKV.
2. Copy video when neither size nor quality mode is active.
3. Apply listed track selections when available.
4. Do not use `mkvmerge` as the ISO demuxer.
5. Probe the completed normal video output with ffprobe for integrity.

Done when the fake-tool test proves ISO remux invokes no video encoder and produces an integrity-checked MKV.

### V2-042: Implement custom audio transforms

Files: `src/server/optimize.ts`, `src/server/optimize.test.ts`.

1. Generate AAC only from the selected existing source stream.
2. Preserve channel layout for codec replacement.
3. Generate the selected smaller layout for downmix.
4. Omit the source stream for replacement operations.
5. Retain the source stream for additional downmix.
6. Permit audio-only work without a GPU.

Done when fake ffmpeg and `mkvmerge` tests prove replace versus additional output behavior.

### V2-043: Implement size-mode video transcode

Files: `src/server/optimize.ts`, `src/server/optimize.test.ts`.

1. Derive the video budget from total target bytes after reserving space for planned audio and container overhead.
2. Use the selected hardware HEVC or AV1 encoder only.
3. Preserve source bit depth.
4. Apply 1080p downscale when selected.
5. Fail when the target cannot accommodate a valid audio/video output.
6. Include target-size variance in the finished-job flag calculation without blocking Keep.

Done when tests distinguish custom total-file-size mode from bulk GB/hour mode.

### V2-044: Implement quality-mode video transcode

Files: `src/server/optimize.ts`, `src/server/optimize.test.ts`.

1. Map the validated quality value to the active CUDA or VAAPI encoder.
2. Apply optional 1080p downscale and source bit depth.
3. Never add a bitrate target from the bulk size cap.
4. Fail on missing hardware; do not fall back to CPU.

Done when fake-tool tests prove quality mode and size mode choose distinct encoder controls and hardware failure stays closed.

### V2-045: Verify output integrity and cleanup

Files: `src/server/optimize.ts`, `src/server/optimize.test.ts`.

1. Probe every completed MKV, including ISO remux and audio-only output.
2. Require a present, credible duration from the output itself.
3. Remove partial output on failure or cancellation.
4. Return inspection data for the actual output; never copy source duration onto it.

Done when truncated or unprobeable output fails and leaves no success artifact.

### Phase 4 gate

- Fake-tool tests cover ISO remux, audio replace, downmix add/replace, size mode, quality mode, and downscale.
- Bulk optimization behavior remains covered.
- No test requires real media tools or hardware.

## Phase 5 — Promotion and direct write

### V2-050: Extract a promotion service

Files: new `src/server/promote.ts`, new `src/server/promote.test.ts`, `src/server/jobs.ts`, notifier tests.

1. Move library replacement, history accounting, Arr refresh, and player notification behind one service.
2. Accept a completed, integrity-checked output and its executable plan.
3. Return separate replacement success and post-replacement warning/error information.
4. Keep notification or Arr failures from rolling back a successful replacement.

Done when sidecar Keep calls the service and preserves v1 observable behavior.

### V2-051: Implement atomic direct write

Files: `src/server/jobs.ts`, `src/server/promote.ts`, related tests.

1. Always encode or remux to a separate temp path.
2. Integrity-check the temp output before replacement.
3. Replace the source only after successful inspection.
4. Prefer a rename strategy that preserves the original until the new file is ready; handle extension changes deliberately.
5. Remove partial temp output on failure or cancellation.
6. Do not create a Review row for successful direct-write jobs.
7. Do not delete or overwrite the original when execution or integrity fails.

Done when byte-level tests prove original preservation on every pre-replacement failure and direct success skips Review.

### V2-052: Unify accounting and post-promote actions

Files: `src/server/promote.ts`, `src/server/store.ts`, Home/history tests.

1. Count successful sidecar Keep and successful direct write as optimized files.
2. Calculate saved bytes from actual source and output sizes.
3. Run the same Arr refresh and player notification after either path.
4. Surface post-replacement failures without changing the successful file outcome.

Done when Home and History report direct writes and Keeps consistently.

### V2-053: Apply queue semantics to custom jobs

Files: `src/server/jobs.ts`, `src/server/jobs.*.test.ts`, `src/server/store.ts`.

1. Use the existing active-job and pending-review locks for custom jobs.
2. Apply concurrency, off-peak holding, pause, reorder, run-now, restart, and cancel behavior unchanged.
3. Store and display effective write mode in job details.
4. Ensure cancel cannot leave a half-written library file.

Done when custom and bulk jobs share one queue and a second job for the same title returns a conflict.

### Phase 5 gate

- Sidecar remains the default.
- Direct write is integrity-gated, skips Review, and preserves the original on failure.
- Accounting, Arr refresh, player notification, scheduling, and cancellation work for both paths.

## Phase 6 — Arr quality profiles

### V2-060: Define suggested profile previews

Files: new `src/server/arr-profiles.ts` or `src/server/arr.ts`, tests, `src/server/types.ts`.

1. Define one stable Polisharr-prefixed profile name per size category.
2. Derive preview GB/hour and equivalent MB/min from current settings.
3. Keep movie categories separate from TV categories.
4. Describe that Arr size limits attach globally to quality names; profile assignment does not silently rewrite those definitions.

Done when changing a size cap changes only the local preview until explicit sync.

### V2-061: Add Radarr and Sonarr profile HTTP clients

Files: `src/server/arr.ts` or `src/server/arr-profiles.ts`, fake HTTP tests.

1. List quality profiles for an enabled Arr instance.
2. Create missing Polisharr-named profiles.
3. Update only profiles identified by stable Polisharr names.
4. Never delete or overwrite unrelated operator profiles.
5. Assign the matching profile to a Radarr movie without issuing a search.
6. Assign the matching profile to a Sonarr series without issuing a search.
7. Parse all remote JSON from `unknown` at the boundary (ENG-03).

Done when fake HTTP tests cover GET/POST/PUT, existing profiles, rejected requests, and absence of search commands.

### V2-062: Add explicit profile sync API

Files: `src/server/app.ts`, `src/server/store.ts`, app tests.

1. Expose profile previews with Settings.
2. Add an authenticated mutation that syncs profiles to each enabled Radarr and Sonarr.
3. Return per-instance created, updated, unchanged, and failed results.
4. Do not sync when the operator merely saves a GB/hour cap.

Done when tests prove profile creation/update requires the explicit action.

### V2-063: Assign profiles after eligible promotion

Files: `src/server/promote.ts`, `src/server/promote.test.ts`.

1. Add an off/on profile auto-assign setting and assign after a successful video-transcode Keep or direct write only when it is on.
2. Select the plan’s size category and matching profile.
3. Assign a Radarr movie directly.
4. Assign the whole Sonarr series and return a warning that the profile affects future episodes.
5. Skip assignment for tracks-only, stereo-only, audio-only, and ISO-remux-only plans.
6. Skip assignment for size-exempt titles.
7. Keep the replacement successful when the profile is missing or Arr rejects assignment; surface the Arr error.

Done when promotion tests cover every assign and skip condition for both write modes, including disabled auto-assign and ISO remux without a video transcode.

### Phase 6 gate

- Operators can preview and explicitly sync stable profiles.
- Only eligible promoted transcodes trigger assignment.
- No profile operation deletes unrelated profiles, rewrites global quality definitions, or starts a search.

## Phase 7 — HTTP API and dense library payloads

### V2-070: Build public inspection summaries

Files: `src/server/app.ts` or a presentation module, app tests, `src/web/api.ts`.

1. Add codec, compact audio summary, compact subtitle summary, inspection state, error reason, and every plan reason to library-list payloads.
2. Render no subtitles as `None`.
3. Return em dashes or explicit null values for codec/audio/subtitles before inspection; do not invent streams.
4. Return the path error for unreadable files and no invented media facts.
5. Return `Healthy` for a probed file with no automatic or custom work.
6. Prefer a queued custom plan’s reasons over the automatic suggestion’s reasons.

Done when HTTP tests assert two simultaneous reasons, healthy, uninspected, unreadable, and no-subtitle cases.

### V2-071: Add title detail endpoints

Files: `src/server/app.ts`, app tests, `src/web/api.ts`.

1. Add stable detail reads for a movie id and episode id, or one typed endpoint if routes remain stable and unambiguous.
2. Return identity, poster URL, instance, path, quality, codec, size, duration, HDR, bit depth, audio, subtitles, inspection state, current locks, hardware choices, global write mode, and existing custom-plan state.
3. Return 404 with `That title is not in the library.` for a stale id.
4. Keep excluded and size-exempt titles readable.

Done when authenticated endpoint tests cover movie, episode, excluded, uninspected, unreadable, and missing ids.

### V2-072: Add validate/preview custom-plan endpoint

Files: `src/server/app.ts`, `src/server/custom-plan.ts`, app tests, `src/web/api.ts`.

1. Accept a draft for one title and validate it through the pure module.
2. Return field errors, normalized choices, reasons, warnings, estimate, and effective write mode.
3. Reject optimize controls for unreadable or pending-inspection non-ISO titles.
4. Permit the specified unlisted-ISO remux/encode escape path.
5. Enforce authentication and first-run/language gates server-side.

Done when the browser does not need to duplicate validation or estimate policy.

### V2-073: Queue custom plans and negate automatic suggestions

Files: `src/server/app.ts`, `src/server/jobs.ts`, `src/server/store.ts`, app/job tests.

1. Add an authenticated custom queue mutation.
2. Revalidate the submitted draft against the current inspection, settings, and hardware immediately before enqueue.
3. Reject do-nothing and locked titles.
4. Atomically enqueue the custom plan and dismiss or otherwise negate its automatic suggestion.
5. Remove the title from Suggestions immediately.
6. Make dense-row Plan text reflect the custom job.
7. Keep size-exempt and excluded titles eligible for intentional custom work.

Done when tests prove suggestion negation, locking, exclusions, exemptions, and stale-draft revalidation.

### V2-074: Update search destinations

Files: `src/server/app.ts`, search tests, `src/web/components/Shell.tsx` if needed.

1. Return `/movies/:id` for movie hits.
2. Return `/series/episodes/:id` for episode hits.
3. Preserve display identity and Arr instance in search results.

Done when global search opens a stable title route instead of a table focus query.

### Phase 7 gate

- API contracts expose public presentation fields; the web does not scrape stored inspection internals.
- Custom queue validation and suggestion negation are atomic from the user’s perspective.
- Auth and first-run gates still protect all optimize mutations.

## Phase 8 — Dense Movies and Series tables

### V2-080: Create shared dense-row presentation components

Files: new components under `src/web/components/`, `src/web/api.ts`, web tests if the current setup supports them.

1. Share cells for quality, codec, size, audio, subtitles, and multiline plan reasons.
2. Show `None`, em dashes, `Healthy`, waiting-for-inspect copy, and unreadable errors exactly from API state.
3. Keep Arr instance visible.
4. Preserve Queue, Force, Stereo, and Exempt actions.
5. Stop row navigation when an action button handles the click.

Done when Movies and episode rows use one semantics-preserving presenter.

### V2-081: Densify Movies

Files: `src/web/pages/Movies.tsx`, `src/web/index.css`, relevant tests.

1. Add the required columns in PRD order.
2. Render each plan reason on its own line.
3. Tighten row padding and poster size while retaining readable actions.
4. Make clicking the row or title navigate to `/movies/:id`.
5. Preserve v1 empty-state copy.

Done when a desktop viewport shows the dense fields without hiding Plan or Actions.

### V2-082: Densify Series episodes

Files: `src/web/pages/Series.tsx`, shared components, CSS, tests.

1. Match the Movies columns with episode identity replacing movie title.
2. Render every plan reason and preserve all row actions.
3. Navigate episode clicks to `/series/episodes/:id`.
4. Preserve v1 empty-state copy.

Done when episode rows have data and action parity with Movies.

### V2-083: Add collapsible series headers

Files: `src/web/pages/Series.tsx`, optional focused hook/helper and tests.

1. Key collapse state by series plus Arr instance.
2. Return show summaries before episode rows and default every series to collapsed.
3. Fetch one show’s episodes on expansion and retain them while the component remains mounted.
4. Refresh show summaries and invalidate retained episode rows after an explicit library refresh.
5. Keep title, instance, episode count, and Optimize all episodes visible when collapsed.
6. Prevent Optimize all episodes from toggling collapse.
7. Do not add server persistence, session persistence, collapse-all, or season collapse.

Done when Series renders bounded show summaries first, expansion fetches only one show, and a full browser reload restores collapsed defaults.

### Phase 8 gate

- Movies and Series show honest dense media facts and all reason lines.
- Existing row actions still work.
- Collapse behavior matches stories 11–16 without adding out-of-scope persistence.

## Phase 9 — Title pages and custom editor

### V2-090: Add stable title routes and page shell

Files: `src/web/App.tsx`, new `src/web/pages/Title.tsx` or separate movie/episode wrappers, `src/web/api.ts`.

1. Register `/movies/:id` and `/series/episodes/:id`.
2. Fetch the title-detail endpoint by id.
3. Render not-found, loading, unreadable, and uninspected states.
4. Add Back navigation that returns to Movies or Series.
5. Show poster and all required source facts before controls.

Done when bookmarked movie and episode URLs survive refresh and stale ids show clear copy.

### V2-091: Build track controls

Files: title page and focused editor components.

1. Start every visit with a do-nothing draft unless a product-approved persisted draft exists.
2. Add remove controls for each audio and subtitle track.
3. Add same-layout AAC replacement for eligible audio tracks.
4. Add smaller-layout AAC downmix choices with replace/add selection.
5. Hide track editing when ISO streams could not be listed.
6. Disable all optimize controls for unreadable or still-uninspected normal files and show the reason.

Done when the controls serialize only a draft and the server remains authoritative for validity.

### V2-092: Build video and remux controls

Files: title page and focused editor components.

1. Show ISO-to-MKV remux as a selectable change.
2. Add target file size and encoder quality controls.
3. Clear quality when size changes and clear size when quality changes.
4. Default codec to HEVC; show AV1 only when hardware supports it.
5. Show 4K-to-1080p only for eligible sources and require a transcode mode.
6. Display HDR metadata-loss warning from preview response.

Done when the UI cannot visibly hold both video modes at once and invalid combinations receive field-level feedback.

### V2-093: Show plan preview, estimate, and write mode

Files: title page, API client, CSS.

1. Debounce preview requests or compute only after meaningful draft changes.
2. Show every normalized plan reason.
3. Show exact target size in size mode and heuristic estimate in quality mode.
4. Label the estimate as approximate.
5. Show global sidecar/direct default and a per-job override with the resulting effective mode.
6. Explain that sidecar jobs go to Review and direct jobs replace after integrity checking.

Done when the operator can tell what changes, estimated output size, and whether Review will receive the result before queueing.

### V2-094: Queue custom work

Files: title page, API client, navigation/status components.

1. Disable Queue until preview returns a non-empty valid plan.
2. Submit the draft to the custom queue endpoint.
3. Handle a lock or stale-validation conflict without claiming success.
4. On success, show job identity/status and prevent a second submission.
5. Ensure Suggestions loses the negated automatic card on its next read.

Done when do-nothing cannot queue and one title cannot stack competing jobs.

### V2-095: Add title-page help and mobile layout

Files: title page components, `src/web/index.css`, user-facing copy tests where practical.

1. Define sidecar, direct write, codec replacement, downmix, size mode, and quality mode next to their controls.
2. State that a Sonarr profile assignment affects the whole series where relevant.
3. Stack facts, tracks, video controls, preview, and Queue into a usable phone layout.
4. Keep primary controls reachable without horizontal scrolling.

Done when a narrow mobile viewport supports the complete custom-plan workflow.

### Phase 9 gate

- A user can open, refresh, edit, preview, and queue a movie or episode from a stable URL.
- The editor begins with no work selected and never duplicates server plan policy.
- The page works for listed ISO, unlisted ISO, excluded, exempt, unreadable, and missing-title cases.

## Phase 10 — Settings and operational UI

### V2-100: Add global direct-write control

Files: `src/web/pages/Settings.tsx`, `src/web/api.ts`, settings/app tests, CSS.

1. Add an off-by-default switch with explicit destructive-risk copy.
2. Explain integrity-check-then-replace behavior and that successful direct jobs skip Review.
3. Persist through the existing settings endpoint.
4. Keep first-run and secret handling unchanged.

Done when existing users remain in sidecar mode and direct mode requires an explicit save.

### V2-101: Add profile preview and explicit sync

Files: `src/web/pages/Settings.tsx`, `src/web/api.ts`, app tests.

1. Show each suggested profile name, GB/hour cap, and MB/min equivalent.
2. Explain global Arr quality-size definitions and that Polisharr does not silently rewrite them.
3. Add a Sync profiles action separate from Save settings.
4. Display per-instance create/update/unchanged/failure results.
5. Update preview immediately when local cap fields change, without remote writes.

Done when an operator can understand and control every remote profile mutation.

### V2-102: Show write and plan details across Queue, Review, and History

Files: relevant web pages and API presenters.

1. Name size mode or quality mode in job details.
2. Show effective sidecar/direct mode for active jobs.
3. Keep direct-write successes out of Review.
4. Show post-promote Arr/profile warnings without presenting the file replacement as failed.
5. Keep flagged results Keepable.

Done when operational pages describe custom jobs without reducing them to bulk GB/hour language.

### Phase 10 gate

- Settings make dangerous and remote actions explicit.
- Queue, Review, Home, and History report direct/custom outcomes consistently.

## Phase 11 — Cross-cutting regression and release

### V2-110: Complete the v2 behavior matrix

Files: tests across server and web modules.

Add any missing public-behavior cases from PRD developer stories 87–92:

- custom-plan fixture and draft tests;
- ISO inspect success/failure with zero ffprobe calls;
- runner fake-tool tests for every custom transform;
- sidecar versus direct promotion and original preservation;
- fake Radarr/Sonarr profile create and assign;
- dense library payloads with multiple reasons.

Done when each developer story maps to at least one named test.

### V2-111: Run security and standards regression checks

Files: tests and fixes only where failures reveal regressions.

1. Verify every new mutation enforces authentication, first-run completion, and language confirmation (ENG-07).
2. Verify settings and title payloads contain no API keys, player tokens, password hashes, or decrypted secrets (ENG-06).
3. Verify every media-tool invocation uses argument arrays (ENG-08).
4. Verify no code path adds CPU video fallback (ENG-05).
5. Verify failure and cancellation preserve original bytes, except successful opted-in direct replacement (ENG-09 named break).
6. Verify new boundary JSON is narrowed from `unknown`, with no `any` (ENG-02/03).

Done when the ENG-14 checklist has an explicit pass or named break for the complete diff.

### V2-112: Verify responsive and accessible UI behavior

Files: web tests, CSS, components.

1. Test keyboard activation and focus for clickable rows and collapse headers.
2. Give icon buttons accessible names and do not rely on color alone for state.
3. Verify table and title editor behavior at desktop and phone widths.
4. Confirm action clicks do not also trigger row navigation or collapse.
5. Confirm no overlapping preview requests can apply stale results to a newer draft.

Done when mouse, keyboard, and narrow-screen users can complete the primary workflows.

### V2-113: Update operator documentation

Files: `README.md`, optional focused document under `docs/`.

1. Document title URLs and the custom-plan workflow.
2. Explain sidecar versus direct write and the failure guarantee.
3. Explain ISO support and its limits.
4. Explain suggested Arr profiles, Sonarr series scope, explicit sync, and no-search behavior.
5. State that HEVC/AV1 video work requires CUDA or VAAPI and has no CPU fallback.

Done when a junior operator can configure and use v2 without inferring Arr or media-tool jargon.

### V2-114: Final verification and issue closure evidence

Files: no production changes unless verification finds a defect.

1. Run full tests, typecheck, and production build.
2. Perform a focused manual smoke test: dense tables, series collapse, movie title page, episode title page, custom sidecar queue, direct-write test fixture, ISO remux fixture, profile preview, and explicit sync against fake Arr endpoints.
3. Review the diff separately against the v2 PRD and engineering/prose standards.
4. Record evidence for stories 1–92 and issues #22–#25.
5. Close #22–#25 only after their acceptance behavior passes in the integrated build.

Done when the integrated v2 behavior passes and each issue closure cites its verification evidence.

## Suggested change-set sequence

Use these as reviewable milestones. Do not combine them into one large implementation change.

1. Domain types, persistence migrations, and fixtures (`V2-001`–`V2-014`).
2. ISO inspection and bulk suggestion support (`V2-020`–`V2-022`).
3. Pure custom-plan module and estimates (`V2-030`–`V2-035`).
4. Runner support for validated custom plans (`V2-040`–`V2-045`).
5. Promotion extraction and direct write (`V2-050`–`V2-053`).
6. Arr profile preview, sync, and assignment (`V2-060`–`V2-063`).
7. Dense/title/custom-plan HTTP contracts (`V2-070`–`V2-074`).
8. Dense Movies and Series tables (`V2-080`–`V2-083`).
9. Stable title pages and custom editor (`V2-090`–`V2-095`).
10. Settings and operational presentation (`V2-100`–`V2-102`).
11. Integrated regressions, documentation, and release evidence (`V2-110`–`V2-114`).

## Definition of done

v2 is complete only when:

- v1 bulk Suggestions still use GB/hour caps, preferred language, and Atmos stereo rules;
- Movies and Series show dense, honest inspection facts and all plan reasons;
- Series returns bounded show summaries first, loads episodes on expansion, and defaults to collapsed after a browser reload;
- stable movie and episode pages begin with a do-nothing custom draft;
- custom audio, subtitle, ISO remux, size, quality, and downscale plans validate and execute as specified;
- custom queueing negates the automatic suggestion and shares existing job locks;
- sidecar remains default, direct write is explicit and integrity-gated, and failures preserve the original;
- eligible promoted transcodes assign an explicitly synced Polisharr profile without starting an Arr search;
- tests require no live NAS, GPU, ISO image, Radarr, Sonarr, Plex, or Jellyfin;
- `npm test`, `npm run typecheck`, and `npm run build` pass;
- the spec and standards review axes both pass, with the direct-write ENG-09 exception named.
